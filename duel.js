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
    redisClient = redis.createClient();
    requestify = requestifyCore;
}
module.exports.restart = function(){
    steamBotLogger('RELOAD from admin panel');
    relogin();
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
console.tag('info').info('Код дуэль бота:', logOnOptions.two_factor_code);
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
    countRetries = [],
    comission = [],
    globalSession;

const redisChannels = {
    receiveBetItems: config.prefix + 'receiveBetItems.list',
    sendWinnerPrizeList: config.prefix + 'sendWinnerPrizeDuel.list',
    checkOfferStateList: config.prefix + 'checkOfferState.list'
};

function steamBotLogger(log){
    console.tag('SteamBotDuel').log(log);
}
steamClient.connect();
steamClient.on('debug', steamBotLogger);
steamClient.on('connected', function() {
    steamUser.logOn(logOnOptions);
});

steamClient.on('logOnResponse', function(logonResp) {
    if (logonResp.eresult === Steam.EResult.OK) {
        steamBotLogger('Logged in!');
        steamFriends.setPersonaState(Steam.EPersonaState.Online);

        steamWebLogOn.webLogOn(function(sessionID, newCookie) {
            console.log('steamWebLogOn');
            getSteamAPIKey({
                sessionID: sessionID,
                webCookie: newCookie
            }, function(err, APIKey) {
                console.log('getSteamAPIKey');
                if(err) {
                    steamBotLogger(err);
                }
                offers.setup({
                    sessionID: sessionID,
                    webCookie: newCookie,
                    APIKey: APIKey
                });
                console.log(APIKey);
                WebSession = true;
                globalSession = sessionID;
                confirmations.setCookies(newCookie);
                confirmations.startConfirmationChecker(10000, config.duelsBot.identitySecret);
                steamBotLogger('Setup Offers!');
            });
        });
    }
});

steamClient.on('servers', function(servers) {
    //fs.writeFile('./config/servers', JSON.stringify(servers));
});
steamClient.on('error', function(error) {
    console.log(error);
});
steamClient.on('loggedOff', function() {
    steamClient.connect();
});
steamUser.on('updateMachineAuth', function(sentry, callback) {
    fs.writeFileSync('sentry', sentry.bytes);
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
                        console.tag('SteamBot', 'TradeOffer').log('TRADE OFFER #' + offer.tradeofferid + ' FROM: Admin ' + offer.steamid_other);
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

var checkOfferPrice = function(){
    requestify.post(config.domain+'/api/checkOffer', {
            secretKey: config.secretKey
        })
        .then(function(response) {
            var answer = JSON.parse(response.body);

            if(answer.success){
                checkProcceed = false;
            }
        },function(response){
            console.tag('SteamBot').error('Something wrong with check offers. Retry...');
            setTimeout(function(){checkOfferPrice()}, 1000);
        });

}

var checkArrGlobal = {};
var checkArrGlobalLottery = [];

function relogin() {
    steamWebLogOn.webLogOn(function(sessionID, newCookie) {
        console.log('steamWebLogOn');
        getSteamAPIKey({
            sessionID: sessionID,
            webCookie: newCookie
        }, function(err, APIKey) {
            console.log('getSteamAPIKey');
            if(err) {
                steamBotLogger(err);
            }
            offers.setup({
                sessionID: sessionID,
                webCookie: newCookie,
                APIKey: APIKey
            });
            console.log(APIKey);
            WebSession = true;
            globalSession = sessionID;
            confirmations.setCookies(newCookie);
            confirmations.startConfirmationChecker(10000, config.duelsBot.identitySecret);
            steamBotLogger('Setup Offers! RELOGIN');
        });
    });
}

function getErrorCode(err, callback){
    var errCode = 0;
    var match = err.match(/\(([^()]*)\)/);
    if(match != null && match.length == 2) errCode = match[1];
    callback(errCode);
}

var setPrizeStatus = function(item, status){
    requestify.post(config.domain+'/api/duel/setPrizeStatus', {
            secretKey: config.secretKey,
            id: item,
            status: status
        })
        .then(function(response) {
        },function(response){
            console.tag('SteamBotDuel').error('Something wrong with setItemStatus. Retry...');
            setTimeout(function(){setPrizeStatus()}, 1000);
        });
};
var sendPrizeOffer = function(offerJson) {
    var d = domain.create();
    d.on('error', function(err) {
        console.log(err.stack);
        console.tag('SteamBotDuel').error('Error to send prize offer');
        sendWinnerProcceed = false;
    });
    var offer = JSON.parse(offerJson);
    d.run(function () {
        offers.loadMyInventory({
            appId: 730,
            contextId: 2
        }, function (err, items) {
            if(err) {
                console.log(err);
                console.tag('SteamBotDuel', 'SendTrade').log('LoadMyInventory error!');
                relogin();
                sendWinnerProcceed = false;
                return;
            }
            console.log(offerJson);
            var itemsFromMe = [];
            offer.items.forEach(function (item) {
                for(var i=0; i < items.length; i++)
                {
                    if(!items[i].ss && items[i].id == item.id)
                    {
                        items[i].ss = 1;
                        itemsFromMe.push({
                            appid: 730,
                            contextid: 2,
                            amount: items[i].amount,
                            assetid: items[i].id
                        });
                        break;
                    }
                }
            });


            if (itemsFromMe.length > 0) {
                offers.makeOffer({
                    partnerSteamId: offer.partnerSteamId,
                    accessToken: offer.accessToken,
                    itemsFromMe: itemsFromMe,
                    itemsFromThem: [],
                    message: 'Поздравляем с победой в раунде:  ' + offer.id
                    }, function (err, response) {
                        if (err) {
                            getErrorCode(err.message, function (errCode) {
                                if (errCode == 15 || errCode == 25 || err.message.indexOf('an error sending your trade offer.  Please try again later.')) {
                                    redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                                        setPrizeStatus(offer.id, 2);
                                        console.log(err);
                                        sendWinnerProcceed = false;
                                    });
                                }
                            });
                            sendWinnerProcceed = false;
                            return;
                        }
                        redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                            sendWinnerProcceed = false;
                            setPrizeStatus(offer.id, 1);
                            console.tag('SteamBotDuel', 'SendItem').log('TradeOffer #' + response.tradeofferid + ' send!');
                        });
                    });
                } else {
                    redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                        console.tag('SteamBotDuel', 'SendItem').log('Items not found!');
                        setPrizeStatus(offer.id, 2);
                        sendWinnerProcceed = false;
                    });
                }

        });

    });
};

var setReceiveStatus = function(item,status,items){
    requestify.post(config.domain+'/api/duel/setReceiveStatus', {
            secretKey: config.secretKey,
            id: item,
            status: status,
            items: JSON.stringify(items)
        })
        .then(function(response) {
            console.log(JSON.stringify(items));
        },function(response){
            console.tag('SteamBotDuel').error('Something wrong with setItemStatus. Retry...');
            setTimeout(function(){setPrizeStatus()}, 1000);
        });
};
var checkOffer = function(offerJson){
    var offer = JSON.parse(offerJson);
    if(checkArrGlobal[offer.tradeId])
        return;
    checkArrGlobal[offer.tradeId] = 1;
    var unix = Math.round(+new Date()/1000);
    if(unix-offer.time > 90)
    {
        redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
            steamBotLogger('timeout for '+offer.tradeId);
            setReceiveStatus(offer.betId,4,[]);
            offers.cancelOffer({tradeOfferId: offer.tradeId},function(err,res){
                checkArrGlobal[offer.tradeId] = 0;
            });
        });
        return;
    }
    offers.getOffer({
        tradeofferid: offer.tradeId
    },function(err,response){
        if(err) {
            steamBotLogger('Error on getOffer:');
            console.log(err);
            checkArrGlobal[offer.tradeId] = 0;
            return;
        }
        if(response.response && response.response.offer) {
            if(response.response.offer.trade_offer_state == 3) {
                steamBotLogger('acceptedOffer state');
                offers.getItems({tradeId:response.response.offer.tradeid},function (err,items) {
                    if(err) {
                        steamBotLogger('Error getItems: '+err);
                        checkArrGlobal[offer.tradeId] = 0;
                        return;
                    }
                    redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                        var acceptedItems = [];
                        items.forEach(function (item) {
                            acceptedItems.push({
                                market_hash_name: item.market_hash_name,
                                classId: item.classid,
                                id: item.id
                            });
                        });
                        setReceiveStatus(offer.betId,1,acceptedItems);
                        checkArrGlobal[offer.tradeId] = 0;
                    });
                });
            } else if(response.response.offer.trade_offer_state != 2) {
                redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                    steamBotLogger('declineOffer state');
                    setReceiveStatus(offer.betId,4,[]);
                    if(response.response.offer.trade_offer_state != 6 && response.response.offer.trade_offer_state != 7) {
                        offers.cancelOffer({tradeOfferId: offer.tradeofferid},function(err,res){
                            checkArrGlobal[offer.tradeId] = 0;
                        });
                    } else
                     checkArrGlobal[offer.tradeId] = 0;
                });
            }

        } else {
            console.log('Error on get offer response');
            redisClient.lrem(redisChannels.checkOfferStateList,0,offerJson,function (err,data) {
                setReceiveStatus(offer.betId,3,[]);
                checkArrGlobal[offer.tradeId] = 0;
            });
        }
    });
};

var sendTradeOffer = function(offerJson){
    var d = domain.create();
    d.on('error', function(err) {
        console.log(err.stack);
        console.tag('SteamBotDuel').error('Error to send offer');
        receiveProcceed = false;
    });
    var offer = JSON.parse(offerJson);
        offers.loadPartnerInventory({
            partnerSteamId: offer.partnerSteamId,
            contextId: 2,
            appId: 730
        }, function (err, items) {
            if(err) {
                console.log(err);
                console.tag('SteamBotDuel', 'SendTrade').log('LoadPartnerInventory error!');
                redisClient.lrem(redisChannels.sendWinnerPrizeList, 0, offerJson, function (err, data) {
                    setReceiveStatus(offer.id, 3,[]);
                    receiveProcceed = false;
                });

                return;
            }

            var itemsFromPartner = [];
            offer.items.forEach(function (item) {
                for(var i = 0; i<items.length; i++) {
                    if (!items[i].ss && items[i].classid == item.classId) {
                        items[i].ss = 1;
                        itemsFromPartner.push(
                            {
                                appid: 730,
                                contextid: 2,
                                amount: items[i].amount,
                                assetid: items[i].id
                            }
                        );
                        break;
                    }
                }
            });


            if (itemsFromPartner.length > 0) {
                offers.makeOffer({
                    partnerSteamId: offer.partnerSteamId,
                    accessToken: offer.accessToken,
                    itemsFromMe: [],
                    itemsFromThem: itemsFromPartner,
                    message: 'Пополнение дуэлей: ' + config.domain
                }, function (err, response) {
                    if (err) {
                            getErrorCode(err.message, function (errCode) {
                                if (errCode == 15 || errCode == 25 || err.message.indexOf('an error sending your trade offer.  Please try again later.')) {
                                    redisClient.lrem(redisChannels.receiveBetItems, 0, offerJson, function (err, data) {
                                        setReceiveStatus(offer.id, 3,[]);
                                        receiveProcceed = false;
                                    });
                                }
                            });
                            receiveProcceed = false;
                            return;
                        }
                        redisClient.lrem(redisChannels.receiveBetItems, 0, offerJson, function (err, data) {
                            receiveProcceed = false;
                            setReceiveStatus(offer.id, 2,[]);
                            console.tag('SteamBotDuel', 'SendItem').log('TradeOffer #' + response.tradeofferid + ' send!');
                            var unix = Math.round(+new Date()/1000);
                            redisClient.rpush(redisChannels.checkOfferStateList,JSON.stringify({tradeId:response.tradeofferid,betId: offer.id,time: unix}));
                        });
                    });
                } else {
                    redisClient.lrem(redisChannels.receiveBetItems, 0, offerJson, function (err, data) {
                        console.tag('SteamBotDuel', 'SendItem').log('Items not found!');
                        setReceiveStatus(offer.id, 3,[]);
                        receiveProcceed = false;
                    });
                }
        });

};



var is_checkingOfferExists = function(tradeofferid){
    for(var i = 0, len = checkingOffers.length; i<len; ++i ){
        var offer = checkingOffers[i];
        if(offer == tradeofferid){
            return true;
            break;
        }
    }
    return false;
}

var queueProceed = function(){
    //Выдача выигрыша
    redisClient.llen(redisChannels.sendWinnerPrizeList, function(err, length) {
        if (length > 0 && !sendWinnerProcceed && WebSession) {
            console.tag('SteamBotDuel','SendWinnerProcceed').info('SendWinnerList:' + length);
            sendWinnerProcceed = true;
            redisClient.lindex(redisChannels.sendWinnerPrizeList, 0,function (err, offerJson) {
                sendPrizeOffer(offerJson);
            });
        }
    });
    //Отправка предметов на вход в игру.
    redisClient.llen(redisChannels.receiveBetItems, function(err, length) {
        if (length > 0 && !receiveProcceed && WebSession) {
            console.tag('SteamBotDuel','Receive').info('receiveItemsList:' + length);
            receiveProcceed = true;
            redisClient.lindex(redisChannels.receiveBetItems, 0,function (err, offerJson) {
                sendTradeOffer(offerJson);
            });
        }
    });
    //Проверка принятия офферов
    redisClient.llen(redisChannels.checkOfferStateList,function (err,length) {
        if(length > 0  && WebSession) {
            steamBotLogger('checkOfferList: ' + length);
            checkProcceed = true;
            for(var i = 0; i < length; i++)
                redisClient.lindex(redisChannels.checkOfferStateList,i,function(err,offerJson){
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