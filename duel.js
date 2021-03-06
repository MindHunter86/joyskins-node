var fs = require('fs');
var crypto = require('crypto');
var console = process.console;
var config  = require('./config/config.js');
var Steam = require('steam');
var SteamWebLogOn = require('steam-weblogon');
var getSteamAPIKey = require('steam-web-api-key');
var SteamTradeOffers = require('steam-tradeoffers');
var SteamTotp = require('steam-totp');
var SteamCommunity = require('steamcommunity');
var confirmations = new SteamCommunity();
var domain = require('domain');
var redisClient, io, requestify;
module.exports.init = function(redis, ioSocket, requestifyCore) {
    io = ioSocket;
    redisClient = redis.createClient(config.redisPort,config.redisIp);
    requestify = requestifyCore;
};

var logOnOptions = {
    account_name: config.duelsBot.username,
    password: config.duelsBot.password
};

var authCode = ''; // code received by email

try {
    logOnOptions.two_factor_code = SteamTotp.getAuthCode(config.duelsBot.sharedSecret);
} catch (e) {
    if (authCode !== '') {
        logOnOptions.auth_code = authCode;
    }
}
steamBotLogger('Код дуэль бота:'+ logOnOptions.two_factor_code);
function getSHA1(bytes) {
    var shasum = crypto.createHash('sha1');
    shasum.end(bytes);
    return shasum.read();
}
var steamClient = new Steam.SteamClient();
var steamUser = new Steam.SteamUser(steamClient);
var steamFriends = new Steam.SteamFriends(steamClient);
var steamWebLogOn = new SteamWebLogOn(steamClient, steamUser);
var offers = new SteamTradeOffers();

var checkingOffers = [],
    WebSession = false,
    globalSession,
    sendTradeRetries = 0;

const redisChannels = {
    receiveBetItems: config.prefix + 'receiveBetItems.list',
    sendWinnerPrizeList: config.prefix + 'sendWinnerPrizeDuel.list',
    checkOfferStateList: config.prefix + 'checkOfferState.list'
};

function steamBotLogger(log){
    console.tag('SteamBotDuel').log(log);
}

steamClient.connect();
steamClient
    .on('debug', steamBotLogger)
    .on('connected', function() {
        steamUser.logOn(logOnOptions);
    })
    .on('loggedOff',function(result){
        steamBotLogger('SteamClientLoggedOff');
        steamBotLogger(result);
    })
    .on('error',function(error){
        steamBotLogger('SteamClientError:');
        console.tag('SteamDuelBot').error(error.message);
    })
    .on('logOnResponse', function(logonResp) {
        if (logonResp.eresult === Steam.EResult.OK) {
        steamBotLogger('Logged in!');
        steamFriends.setPersonaState(Steam.EPersonaState.Online);

        steamWebLogOn.webLogOn(function(sessionID, newCookie) {
            steamBotLogger('steamWebLogOn');
            getSteamAPIKey({
                sessionID: sessionID,
                webCookie: newCookie
            }, function(err, APIKey) {
                steamBotLogger('getSteamAPIKey');
                if(err) {
                    console.tag('SteamDuelBot').error(err.message);
                }
                offers.setup({
                    sessionID: sessionID,
                    webCookie: newCookie,
                    APIKey: APIKey
                });
                steamBotLogger(APIKey);
                WebSession = true;
                globalSession = sessionID;
                confirmations.setCookies(newCookie);
                confirmations.startConfirmationChecker(10000, config.duelsBot.identitySecret);
                steamBotLogger('Setup Offers!');
            });
        });
    }
    })
    .on('servers', function(servers) {
    //fs.writeFile('./config/servers', JSON.stringify(servers));
});
steamUser.on('updateMachineAuth', function(sentry, callback) {
    fs.writeFileSync('sentry_duel', sentry.bytes);
    callback({ sha_file: getSHA1(sentry.bytes) });
});

function handleOffers() {
    offers.getOffers({
        get_received_offers: 1,
        active_only: 1,
        time_historical_cutoff: Math.round(Date.now() / 1000)
    }, function(error, body) {
        if(error)
            console.log(error);
        if (
            body
            && body.response
            && body.response.trade_offers_received
        ) {
            body.response.trade_offers_received.forEach(function(offer) {
                if (offer.trade_offer_state == 2) {
                    if(offer.items_to_give != null && config.admins.indexOf(offer.steamid_other) != -1) {
                        steamBotLogger('TRADE OFFER #' + offer.tradeofferid + ' FROM: Admin ' + offer.steamid_other);
                        offers.acceptOffer({tradeOfferId: offer.tradeofferid});
                        return;
                    }
                    offers.declineOffer({tradeOfferId: offer.tradeofferid});
                }
            });
        }
    });
}

steamUser.on('tradeOffers', function(number) {
    if (number > 0) {
        handleOffers();
    }
});

var checkArrGlobal = {},  checkArrPrize = {}, checkArrReceive = {};

function relogin() {
    steamFriends.setPersonaState(Steam.EPersonaState.Online);
    steamWebLogOn.webLogOn(function(sessionID, newCookie) {
        steamBotLogger('Relogin state');
        getSteamAPIKey({
            sessionID: sessionID,
            webCookie: newCookie
        }, function(err, APIKey) {
            steamBotLogger('getSteamApiKey');
            if(err) {
                console.tag('SteamDuelBot').error(err.message);
            }
            offers.setup({
                sessionID: sessionID,
                webCookie: newCookie,
                APIKey: APIKey
            });
            steamBotLogger(APIKey);
            WebSession = true;
            globalSession = sessionID;
            confirmations.setCookies(newCookie);
            confirmations.startConfirmationChecker(10000, config.duelsBot.identitySecret);
            steamBotLogger('Setup Offers!');
        });
    });
}

function getErrorCode(err, callback){
    var errCode = 0;
    var match = err.match(/\(([^()]*)\)/);
    if(match != null && match.length == 2) errCode = match[1];
    callback(errCode);
}

var send_trade_offer = function(partnerSteamID,accessToken,itemsFromMe,itemsFromThem,message,optional_id,count_retries,timeout,callback) {
    if(count_retries > 0){
        offers.makeOffer({
            partnerSteamId: partnerSteamID.toString(),
            accessToken: accessToken.toString(),
            itemsFromMe: itemsFromMe,
            itemsFromThem: itemsFromThem,
            message: message
        },function(err,response){
            if(err){
                getErrorCode(err.message,function(errCode){
                    if(errCode == 20 || errCode == 28) {
                        console.tag('send_trade_offer','id:'+optional_id).error('Received 20 or 28 errCode try again');
                        setTimeout(function(){send_trade_offer(partnerSteamID,accessToken,itemsFromMe,itemsFromThem,message,optional_id,count_retries,timeout,callback)},timeout);
                        return;
                    } else if (errCode == 26 || errCode == 15 || errCode == 25){
                        callback(err);
                    } else {
                        console.tag('send_trade_offer','id:'+optional_id).error(err.message,'Try AGAIN 15 sec');
                        setTimeout(function(){send_trade_offer(partnerSteamID,accessToken,itemsFromMe,itemsFromThem,message,optional_id,--count_retries,timeout*1.5,callback)},timeout*1.5);
                        return;
                    }
                });
                return;
            } else
                return callback(null,response.tradeofferid);
        });
    } else if(count_retries!=-1) {
        return callback(new Error('Cant send offer'));
    }
};

var setPrizeStatus = function(item, status){
    requestify.post(config.protocol+config.domain+'/api/duel/setPrizeStatus', {
            secretKey: config.secretKey,
            id: item,
            status: status
        })
        .then(function(response) {
        },function(response){
            console.tag('SteamBotDuel').error('Something wrong with setPrizeStatus. Retry...');
            steamBotLogger(response);
            setTimeout(setPrizeStatus(item,status), 1000);
        });
};
var sendPrizeOffer = function(offerJson) {
    var d = domain.create();
    var offer = JSON.parse(offerJson);
    if(checkArrPrize[offer.id] === true)
        return;
    checkArrPrize[offer.id] = true;
    d.on('error', function(err) {
        console.tag('SteamBotDuel').error('Error to send prize offer',err.stack);
        checkArrPrize[offer.id] = false;
    });
    d.run(function () {
        if(offer.typeSend) {
            steamBotLogger('SendWinnerPrize with checking inventory:'+offer.id)
            offers.loadMyInventory({
                appId: 730,
                contextId: 2
            }, function (err, items) {
                if(err) {
                    console.tag('SteamBotDuel', 'SendTrade').error('LoadMyInventory error: ',err.message);
                    WebSession = false;
                    relogin();
                    checkArrPrize[offer.id] = false;
                    return;
                }
                var itemsFromMe = [];
                offer.items.forEach(function (item) {
                    for(var i=0; i < items.length; i++)
                    {
                        if(items[i].id == item.id)
                        {
                            itemsFromMe.push({
                                appid: 730,
                                contextid: 2,
                                amount: items[i].amount,
                                assetid: items[i].id
                            });
                            return;
                        }
                    }
                });
                if(offer.items.length > itemsFromMe.length+2 && offer.typeSend) {
                    console.tag('SteamBotDuel','SendTrade').error('Items ERROR try again');
                    if(sendTradeRetries > 5) {
                        redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                            setPrizeStatus(offer.id, 2);
                            sendWinnerProcceed = false;
                        });
                        return;
                    } else {
                        sendTradeRetries++;
                        checkArrPrize[offer.id] = false;
                        return;
                    }
                }
                if (itemsFromMe.length > 0) {
                    send_trade_offer(offer.partnerSteamId,offer.accessToken,itemsFromMe,[],'Поздравляем с победой в раунде:  ' + offer.id,offer.id,5,5,
                        function(err,tradeId) {
                            if(err){
                                console.tag('sendPrize','SteamBotDuel').error(err.message);
                                redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                                    setPrizeStatus(offer.id, 2);
                                    checkArrPrize[offer.id] = false;
                                });
                            } else {
                                redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                                    setPrizeStatus(offer.id, 1);
                                    console.tag('SteamBotDuel', 'sendPrize').log('TradeOffer #' + tradeId + ' send!');
                                    checkArrPrize[offer.id] = false;
                                });
                            }
                        }
                    );
                } else {
                    redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                        console.tag('SteamBotDuel', 'sendPrize').log('Items not found!');
                        setPrizeStatus(offer.id, 2);
                        checkArrPrize[offer.id] = false;
                    });
                }
            });
        } else {
            steamBotLogger('SendWinnerPrize:'+offer.id);
            var itemsFromMe = [];
            offer.items.forEach(function(item) {
                itemsFromMe.push({
                    appid: '730',
                    contextid: '2',
                    amount: '1',
                    assetid: item.id.toString()
                });
            });
            send_trade_offer(offer.partnerSteamId,offer.accessToken,itemsFromMe,[],'Поздравляем с победой в раунде:  ' + offer.id,offer.id,5,5,
                function(err,tradeId) {
                    if(err){
                        console.tag('sendPrize','SteamBotDuel').error(err.stack);
                        redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                            setPrizeStatus(offer.id, 2);
                            checkArrPrize[offer.id] = false;
                        });
                    } else {
                        redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                            setPrizeStatus(offer.id, 1);
                            console.tag('SteamBotDuel', 'sendPrize').log('TradeOffer #' + tradeId + ' send!');
                            checkArrPrize[offer.id] = false;
                        });
                    }
                }
            );
        }
    });
};

var setReceiveStatus = function(item,status,items){
    requestify.post(config.protocol+config.domain+'/api/duel/setReceiveStatus', {
            secretKey: config.secretKey,
            id: item,
            status: status,
            items: encodeURIComponent(JSON.stringify(items))
        })
        .then(function(response) {
            console.log(JSON.stringify(items));
        },function(response){
            console.tag('SteamBotDuel').error('Something wrong with setReceiveStats. Retry...');
            console.log(response);
            setTimeout(setPrizeStatus(item,status,items), 1000);
        });
};
var checkOffer = function(offerJson){
    var offer = JSON.parse(offerJson);
    if(checkArrGlobal[offer.tradeId])
        return;
    checkArrGlobal[offer.tradeId] = 1;

    offers.getOffer({
        tradeofferid: offer.tradeId
    },function(err,response){
        if(err) {
            console.tag('SteamBotDuel').error('Error on getOffer:',err.message);
            checkArrGlobal[offer.tradeId] = 0;
            return;
        }
        if(response.response && response.response.offer) {
            if(response.response.offer.trade_offer_state == 3) {
                offers.getItems({tradeId:response.response.offer.tradeid},function (err,items) {
                    if(err) {
                        console.tag('SteamDuelBot','CheckOffer').error('Error getItems: ',err.message);
                        checkArrGlobal[offer.tradeId] = 0;
                        return;
                    } else if(items.length == 0)
                    {
                        console.tag('SteamDuelBot','CheckOffer').error('GetItems LAG');
                        checkArrGlobal[offer.tradeId] = 0;
                        return
                    } else
                    redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                        var acceptedItems = [];
                        steamBotLogger('BetId:'+offer.betId+':accepted');
                        items.forEach(function (item) {
                            acceptedItems.push({
                                market_hash_name: item.market_hash_name,
                                classId: item.classid,
                                id: item.id
                            });
                        });
                        setReceiveStatus(offer.betId,1,acceptedItems);
                        checkArrGlobal[offer.tradeId] = 0;
                        return;
                    });
                });
            } else if(response.response.offer.trade_offer_state != 2) {
                redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                    steamBotLogger('BetId:'+offer.betId+':declineState');
                    setReceiveStatus(offer.betId,4,[]);
                    if(response.response.offer.trade_offer_state != 6 && response.response.offer.trade_offer_state != 7) {
                        offers.cancelOffer({tradeOfferId: offer.tradeofferid},function(err,res){
                            checkArrGlobal[offer.tradeId] = 0;
                        });
                    } else
                     checkArrGlobal[offer.tradeId] = 0;
                });
            } else {
                var unix = Math.round(+new Date()/1000);
                if(unix-offer.time > 90)
                {
                    offers.cancelOffer({tradeOfferId: offer.tradeId},function(err,res){
                        console.tag('SteamBotDuel').error('timeout try canceloffer');
                        checkArrGlobal[offer.tradeId] = 0;
                        return;
                       /*
                        redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                            steamBotLogger('BetId:'+offer.betId+':timeout');
                            setReceiveStatus(offer.betId,4,[]);
                            checkArrGlobal[offer.tradeId] = 0;
                        });*/
                    });
                    return;
                } else checkArrGlobal[offer.tradeId] = 0;
                return;
            }
        } else {
            console.tag('SteamBotDuel').log('Error on get offer response: ',offer.betId);
            checkArrGlobal[offer.tradeId] = 0;
            return;
          /*  redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                //setReceiveStatus(offer.betId,3,[]);

            });
            */
        }
    });
};

var sendTradeOffer = function(offerJson){
    var offer = JSON.parse(offerJson);
    if(checkArrReceive[offer.id]===true)
        return;
    checkArrReceive[offer.id] = true;
    var d = domain.create();
    d.on('error', function(err) {
        console.tag('SteamBotDuel').error('Error to sendTradeOffer: ',err.stack);
        checkArrReceive[offer.id] = false;
    });
    d.run(function(){

            var itemsFromPartner = [];
            offer.items.forEach(function(item){
                itemsFromPartner.push(
                    {
                        appid: 730,
                        contextid: 2,
                        amount: 1,
                        assetid: item.id.toString()
                    }
                );
            });

            if (itemsFromPartner.length > 0) {
                send_trade_offer(offer.partnerSteamId,offer.accessToken,[],itemsFromPartner,'Создание/Вступление номер ставки: ' + offer.id+' hash(дуэли): '+offer.hash,offer.id,5,1,function(err,tradeId){
                    if(err){
                        redisClient.lrem(redisChannels.receiveBetItems, 0, offerJson, function (err1, data) {
                            setReceiveStatus(offer.id, 3,[]);
                            checkArrReceive[offer.id] = false;
                            console.tag('SteamBotDuel','receiveOffer').error('Error receive offer: ',offer.id,':',err.message);
                            io.sockets.emit('duelMsg',{
                                steamid: offer.partnerSteamId,
                                title: 'Ошибка создания торгого предложения!',
                                text: 'Ошибка создания оффера: '+err.message
                            });
                        });
                    }else{
                        redisClient.lrem(redisChannels.receiveBetItems, 0, offerJson, function (err, data) {
                            checkArrReceive[offer.id] = false;
                            setReceiveStatus(offer.id, 2,[]);
                            console.tag('SteamBotDuel', 'receiveOffer').log('TradeOffer #' + tradeId + ' send!');
                            var unix = Math.round(+new Date()/1000);
                            redisClient.rpush(redisChannels.checkOfferStateList,JSON.stringify({tradeId:tradeId,betId: offer.id,time: unix}));
                            io.sockets.emit('duelMsg',{steamid: offer.partnerSteamId,title: 'Оффер отправлен успешно!',text: 'Предложение успешно отправлено, примите оффер: <a target="_blank" href="https://steamcommunity.com/tradeoffer/' + tradeId + '/"><b>Принять</b></a>'});
                        });
                        redisClient.set('duel_bet_to_'+offer.id,tradeId);
                        redisClient.expireat('duel_bet_to_'+offer.id, parseInt((+new Date)/1000) + 86400);
                    }
                });
            } else {
                redisClient.lrem(redisChannels.receiveBetItems, 0, offerJson, function (err, data) {
                    console.tag('SteamBotDuel', 'receiveOffer').log('Items not found!');
                    setReceiveStatus(offer.id, 3,[]);
                    checkArrReceive[offer.id] = false;
                    io.sockets.emit('duelMsg',{
                        steamid: offer.partnerSteamId,
                        title: 'Ошибка создания торгого предложения!',
                        text: 'Таких предметов у вас нет!'
                    });
                });
            }
    });
};

var queueProceed = function(){
    //Выдача выигрыша
    redisClient.llen(redisChannels.sendWinnerPrizeList, function(err, length) {
        if (length > 0 && WebSession) {
            for(var i = 0;i<length;i++)
                redisClient.lindex(redisChannels.sendWinnerPrizeList, i,function (err, offerJson) {
                    sendPrizeOffer(offerJson);
                });
        }
    });
    //Отправка предметов на вход в игру.
    redisClient.llen(redisChannels.receiveBetItems, function(err, length) {
        if (length > 0 && WebSession) {
            console.tag('SteamBotDuel','Receive').info('receiveItemsList:' + length);
            for(var i=0; i<length;i++)
                redisClient.lindex(redisChannels.receiveBetItems, i,function (err, offerJson) {
                 sendTradeOffer(offerJson);
                });
        }
    });
    //Проверка принятия офферов
    redisClient.llen(redisChannels.checkOfferStateList,function (err,length) {
        if(length > 0  && WebSession) {
            checkProcceed = true;
            for(var i = 0; i < length; i++)
                redisClient.lindex(redisChannels.checkOfferStateList,i,function(err,offerJson){
                    if(err){
                        console.tag('SteamBotDuel').error(err.stack);
                        return;
                    }
                    checkOffer(offerJson);
                });
        }
    });
}
var receiveProcceed = false;
var sendWinnerProcceed = false;
var checkProcceed = false;
setInterval(queueProceed, 1500);
function str_replace ( search, replace, subject ) {
    if(!(replace instanceof Array)){
        replace=new Array(replace);
        if(search instanceof Array){
            while(search.length>replace.length){
                replace[replace.length]=replace[0];
            }
        }
    }

    if(!(search instanceof Array))search=new Array(search);
    while(search.length>replace.length){
        replace[replace.length]='';
    }

    if(subject instanceof Array){
        for(k in subject){
            subject[k]=str_replace(search,replace,subject[k]);
        }
        return subject;
    }

    for(var k=0; k<search.length; k++){
        var i = subject.indexOf(search[k]);
        while(i>-1){
            subject = subject.replace(search[k], replace[k]);
            i = subject.indexOf(search[k],i);
        }
    }

    return subject;

}