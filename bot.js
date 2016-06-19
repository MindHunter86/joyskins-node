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

var logOnOptions = {
    account_name: config.bot.username,
    password: config.bot.password
};

var authCode = ''; // code received by email

try {
    logOnOptions.two_factor_code = SteamTotp.getAuthCode(config.bot.sharedSecret);
} catch (e) {
    if (authCode !== '') {
        logOnOptions.auth_code = authCode;
    }
}
console.tag('info').info('Код рулетка:', logOnOptions.two_factor_code);
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
process.exit(0);
var checkingOffers = [],
    WebSession = false,
    countRetries = [],
    comission = [],
    globalSession;

const redisChannels = {
    checkItemsList: config.prefix + 'checkItems.list',
    checkList:      config.prefix + 'check.list',
    checkedList:    config.prefix + 'checked.list',
    betsList:       config.prefix + 'bets.list',
    sendOffersList: config.prefix + 'send.offers.list',
    sendOffersListLottery: config.prefix + 'send.offers.list.lottery',
    tradeoffersList: config.prefix + 'tradeoffers.list',
    declineList:    config.prefix + 'decline.list',
    usersQueue:     config.prefix + 'usersQueue.list'
}

function steamBotLogger(log){
    console.tag('SteamBot').log(log);
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
                redisClient.lrange(redisChannels.tradeoffersList, 0, -1, function(err, offers){
                    offers.forEach(function(offer) {
                        checkingOffers.push(offer);
                    });
                    handleOffers();
                });
                redisClient.del(redisChannels.usersQueue);
                redisClient.del(redisChannels.sendOffersListLottery);
                confirmations.setCookies(newCookie);
                confirmations.startConfirmationChecker(10000, 'qkiz6mE/i6ZZnXNS8lc0zkMdD5E=');
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
/*function reWebLogOn(callback) {
    steamWebLogOn.webLogOn(function(sessionID, newCookie){
        offers.setup({
            sessionID: globalSession,
            webCookie: newCookie
        }, function() {
            if (typeof callback == "function") {
                callback();
            }
        });
    });
}*/
function addQueue(steamid, count) {
    counts = 0;
    responses = [];
    var send = function() { 
        requestify.post('https://'+config.domain+'/api/userqueue', {
            secretKey: config.secretKey,
            action: 'queueUser',
            id: steamid[counts]
        }).then(function(response) {
            responses[counts] = JSON.parse(response.body);
            responses[counts].steamid = steamid[counts];

            counts++;
            if(counts == count) {
                console.log(responses);
                io.sockets.emit('queue', responses);
            }
            else
                send();
        },function(response){
            io.sockets.emit('queue', responses);
        });
    }
    send();
}
function handleOffers() {
    console.tag('SteamBot', 'handleOffers').log('handleOffers check starting');
    var start = new Date();
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
                    if(is_checkingOfferExists(offer.tradeofferid)) return;

                    if(offer.items_to_give != null && config.admins.indexOf(offer.steamid_other) != -1) {
                        console.tag('SteamBot', 'TradeOffer').log('TRADE OFFER #' + offer.tradeofferid + ' FROM: Admin ' + offer.steamid_other);
                        offers.acceptOffer({tradeOfferId: offer.tradeofferid});
                        return;
                    }
                    if(offer.items_to_give != null) {
                        console.log('no items to give');
                        offers.declineOffer({tradeOfferId: offer.tradeofferid});
                        return;
                    }
                    offers.getTradeHoldDuration({
                        tradeOfferId: offer.tradeofferid
                    }, function(err, response) {
                        if(response === undefined) {
                            console.log('error escrow');
                            offers.declineOffer({tradeOfferId: offer.tradeofferid}); //ESCROW не подключен
                            return;    
                        }
                        if(response.their != 0) {
                            console.log('escrow disable decline offer');
                            offers.declineOffer({tradeOfferId: offer.tradeofferid}); //ESCROW не подключен
                            return;
                        }
                        if (offer.items_to_receive != null && offer.items_to_give == null) {
                            checkingOffers.push(offer.tradeofferid);
                            var end = new Date();
                            console.log('Скорость ' + (end.getTime()-start.getTime()) + ' мс');
                            console.tag('SteamBot', 'TradeOffer').log('TRADE OFFER #' + offer.tradeofferid + ' FROM: ' + offer.steamid_other);
                            redisClient.multi([
                                ['rpush', redisChannels.tradeoffersList, offer.tradeofferid],
                                ['rpush', redisChannels.checkItemsList, JSON.stringify(offer)],
                                ['rpush', redisChannels.usersQueue, offer.steamid_other]
                            ]).exec(function(){
                                redisClient.lrange(redisChannels.usersQueue, 0, -1, function(err, queues) {
                                    io.sockets.emit('queue', queues);
                                });
                            });
                            return;
                        }
                    });
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
var parseOffer = function(offer, offerJson) {
    offers.loadPartnerInventory({partnerSteamId: offer.steamid_other, appId: 730, contextId: 2, tradeOfferId: offer.tradeofferid/*,language: "russian"*/}, function(err, hitems) {
        if (err) {
            //reWebLogOn(function() {
                console.tag('SteamBot').error('parseOffer error, ReWebLogon');
                if(countRetries[offerJson.tradeofferid] > 4) {
                    console.tag('SteamBot').error('Error to load inventory: '+err);
                    redisClient.multi([
                        ["lrem", redisChannels.usersQueue, 0, offer.steamid_other],
                        ['lrem', redisChannels.checkItemsList, 0, offerJson]
                    ])
                    .exec(function (err, replies) {
                        redisClient.lrange(redisChannels.usersQueue, 0, -1, function(err, queues) {
                            io.sockets.emit('queue', queues);
                        });
                        countRetries[offerJson.tradeofferid] = 0;
                        offers.declineOffer({tradeOfferId: offer.tradeofferid});
                        parseItemsProcceed = false;
                    });
                    return;
                }
                countRetries[offerJson.tradeofferid]++;
                parseOffer(offer, offerJson);
            //});
            return;
        }
        var items = offer.items_to_receive;
        var items_to_check = [], num = 0;
        for (var i = 0; i < items.length; i++) {
            for (var j = 0; j < hitems.length; j++) {
                if (items[i].assetid == hitems[j].id) {
                    items_to_check[num] = {
                        appid:hitems[j].appid,
                        name:hitems[j].market_name,
                        market_hash_name:hitems[j].market_hash_name,
                        classid:hitems[j].classid
                    };
                    //var type = hitems[j].type;
                    var rarity = '';
                    //var types = ["StatTrak™ "," Pistol", " SMG", " Rifle", " Shotgun", " Sniper Rifle", " Machinegun", " Container", " Knife", " Sticker", " Music Kit", " Key", " Pass", " Gift", " Tag", " Tool"];
                    //var typesrep = ["","", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
                    //type = str_replace(types,typesrep,type);

                    var tags = [];
                    var parse = hitems[j].tags;
                    parse.forEach(function(i) {
                        tags[i.category] = i.name;
                    });

                    console.log(tags['Rarity']);
                    switch (tags['Rarity']) {
                        case 'Mil-Spec Grade':      rarity = 'milspec'; break;
                        case 'Restricted':             rarity = 'restricted'; break;
                        case 'Classified':           rarity = 'classified'; break;
                        case 'Covert':                  rarity = 'covert'; break;
                        case 'Consumer Grade':               rarity = 'common'; break;
                        case 'Industrial Grade':   rarity = 'common'; break;
                        case '★':                       rarity = 'rare'; break;
                    }
                    items_to_check[num].rarity = rarity;
                    num++;
                    break;
                }
            }
        }
        var value = {
            offerid: offer.tradeofferid,
            accountid: offer.steamid_other,
            items: JSON.stringify(items_to_check)
        };
        countRetries[offerJson.tradeofferid] = 0;
        console.tag('SteamBot', 'Offer #' + value.offerid).log(value);
        redisClient.multi([
            ['rpush', redisChannels.checkList, JSON.stringify(value)],
            ['lrem', redisChannels.checkItemsList, 0, offerJson]
        ])
            .exec(function (err, replies) {
                parseItemsProcceed = false;
            });

    });
}

var checkOfferPrice = function(){
    requestify.post('https://'+config.domain+'/api/checkOffer', {
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

var checkNewBet = function(){
    requestify.post('https://'+config.domain+'/api/newBet', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            var answer = JSON.parse(response.body);
            if(answer.success){
                betsProcceed = false;
                //handleOffers();
            }
        },function(response){
            console.tag('SteamBot').error('Something wrong with send a new bet. Retry...');
            setTimeout(function(){checkNewBet()}, 1000);
        });
}

var checkArrGlobal = [];
var checkArrGlobalLottery = [];
var sendTradeOfferLottery = function(appId, partnerSteamId, accessToken, sendItems, message, game, offerJson) {
    var d = domain.create();
    d.on('error', function(err) {
        console.log(err.stack);
        console.tag('SteamBot').error('Error to send the bet');
        //setPrizeStatus(game, 2);
        sendProcceedLottery = false;
    });
    d.run(function () {
        if(offer.items.length <= 0) {
            console.tag('SteamBot', 'SendPrize').log(offer.items.length + ' remove trade');
            redisClient.lrem(redisChannels.sendOffersListLottery, 0, offerJson, function(err, data){
                //setPrizeStatus(game, 1);
                sendProcceedLottery = false;
            });
            return;
        }
        offers.loadMyInventory({
            appId: appId,
            contextId: 2
        }, function (err, items) {
            if(err) {
                //reWebLogOn(function() {
                    //setPrizeStatus(game, 1);
                    sendProcceedLottery = false;
                //});
                console.tag('SteamBot', 'SendPrize').log('LoadMyInventory error. Reset offers! Error: '+err);
                return;
            }
            var itemsFromMe = [],
                checkArr = [],
                num = 0;
            sendItems = JSON.parse(sendItems);
            console.log(sendItems);
            console.log(sendItems.classid);
            for (var j = 0; j < items.length; j++) {
                if (items[j].tradable && (items[j].classid == sendItems.classid)) {
                    itemsFromMe[0] = {
                        appid: 730,
                        contextid: 2,
                        amount: items[j].amount,
                        assetid: items[j].id
                    };
                    num++;
                    break;
                }
            }
            if (num > 0) {
                offers.makeOffer({
                    partnerSteamId: partnerSteamId,
                    accessToken: accessToken,
                    itemsFromMe: itemsFromMe,
                    itemsFromThem: [],
                    message: message
                }, function (err, response) {
                    if (err) {
                        console.log(err);
                        if((err.toString().indexOf('(50)') != -1) || (err.toString().indexOf('available') != -1) || (err.toString().indexOf('(15)') != -1)) {
                            console.log('true');
                            redisClient.lrem(redisChannels.sendOffersListLottery, 0, offerJson, function(err, data){
                                //setPrizeStatus(game, 2);
                                sendProcceedLottery = false;
                            });
                            return;
                        }
                        console.tag('SteamBot', 'SendPrize').error('Error to send offer.'+game+':'+ err);

                        //setPrizeStatus(game, 1);
                        sendProcceedLottery = false;
                        return;
                    }
                    checkArrGlobalLottery = checkArrGlobalLottery.concat(checkArr);
                    console.log(checkArrGlobalLottery);
                    console.log(checkArr);
                    redisClient.lrem(redisChannels.sendOffersListLottery, 0, offerJson, function(err, data){
                        //setPrizeStatus(game, 1);
                        sendProcceedLottery = false;
                    });
                    //SteamCommunity.checkConfirmations();
                    console.tag('SteamBot', 'SendPrize').log('TradeOffer #' + response.tradeofferid +' send!');
                });
            }else{
                console.tag('SteamBot', 'SendPrize').log('Items not found!');
                //setPrizeStatus(game, 2);
                //sendProcceedLottery = false;
                redisClient.lrem(redisChannels.sendOffersListLottery, 0, offerJson, function(err, data){
                    //setPrizeStatus(game, 2);
                    sendProcceedLottery = false;
                });
            }
        });

    });
};
var sendTradeOffer = function(appId, partnerSteamId, accessToken, sendItems, message, game, offerJson) {
    var d = domain.create();
    d.on('error', function(err) {
        console.log(err.stack);
        console.tag('SteamBot').error('Error to send the bet');
        setPrizeStatus(game, 2);
        sendProcceed = false;
    });
    d.run(function () {
        if(offer.items.length <= 0) {
            console.tag('SteamBot', 'SendPrize').log(offer.items.length + ' remove trade');
            redisClient.lrem(redisChannels.sendOffersList, 0, offerJson, function(err, data){
                setPrizeStatus(game, 1);
                sendProcceed = false;
            });
            return;
        }
        offers.loadMyInventory({
            appId: appId,
            contextId: 2
        }, function (err, items) {
            if(err) {
                //reWebLogOn(function() {
                    setPrizeStatus(game, 1);
                    sendProcceed = false;
                //});
                console.tag('SteamBot', 'SendPrize').log('LoadMyInventory error. Reset offers!');
                return;
            }
            var itemsFromMe = [],
                checkArr = [],
                num = 0;
            var i = 0;
            for (var i = 0; i < sendItems.length; i++) {
                for (var j = 0; j < items.length; j++) {
                    if (items[j].tradable && (items[j].classid == sendItems[i])) {
                        if ((checkArr.indexOf(items[j].id) == -1) && (checkArrGlobal.indexOf(items[j].id) == -1)) {
                            checkArr[i] = items[j].id;
                            itemsFromMe[num] = {
                                appid: 730,
                                contextid: 2,
                                amount: items[j].amount,
                                assetid: items[j].id
                            };
                            num++;
                            break;
                        }
                    }
                }
            }
            if (num > 0) {
                offers.makeOffer({
                    partnerSteamId: partnerSteamId,
                    accessToken: accessToken,
                    itemsFromMe: itemsFromMe,
                    itemsFromThem: [],
                    message: message
                }, function (err, response) {
                    if (err) {
                        console.log(err);
                        if((err.toString().indexOf('(50)') != -1) || (err.toString().indexOf('(20)') != -1)  ||(err.toString().indexOf('(15)') != -1) || (err.toString().indexOf('available') != -1)) {
                            console.log('true');
                            redisClient.lrem(redisChannels.sendOffersList, 0, offerJson, function(err, data){
                                setPrizeStatus(game, 2);
                                sendProcceed = false;
                            });
                            return;
                        }
                        console.tag('SteamBot', 'SendPrize').error('Error to send offer.' + err);
                        setPrizeStatus(game, 1);
                        sendProcceed = false;
                        return;
                    }
                    checkArrGlobal = checkArrGlobal.concat(checkArr);
                    console.log('checkArrGlobal:',checkArrGlobal);
                    console.log('checkArr:',checkArr);
                    redisClient.lrem(redisChannels.sendOffersList, 0, offerJson, function(err, data){
                        setPrizeStatus(game, 1);
                        sendProcceed = false;
                    });
                    //SteamCommunity.checkConfirmations();
                    console.tag('SteamBot', 'SendPrize').log('TradeOffer #' + response.tradeofferid +' send!');
                });
            }else{
                console.tag('SteamBot', 'SendPrize').log('Items not found!');
                //setPrizeStatus(game, 2);
                //sendProcceed = false;
                redisClient.lrem(redisChannels.sendOffersList, 0, offerJson, function(err, data){
                    setPrizeStatus(game, 2);
                    sendProcceed = false;
                });
            }
        });

    });
};

var setPrizeStatus = function(game, status){
    requestify.post('https://'+config.domain+'/api/setPrizeStatus', {
        secretKey: config.secretKey,
        game: game,
        status: status
    })
        .then(function(response) {

        },function(response){
            console.tag('SteamBot').log('Something wrong with set prize status. Retry...');
            setTimeout(function(){setPrizeStatus()}, 1000);
        });
}

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

var checkedOffersProcceed = function(offerJson){
    var d = domain.create();
    d.on('error', function(err) {
        console.tag('SteamBot').log(err.stack);
    });

    d.run(function () {
        var offer = JSON.parse(offerJson);
        if (offer.success) {
            console.tag('SteamBot').log('Procceding accept: #' + offer.offerid);
            offers.acceptOffer({tradeOfferId: offer.offerid}, function (err, body) {
                if (!err) {
                    redisClient.multi([
                        ["lrem", redisChannels.tradeoffersList, 0, offer.offerid],
                        ["lrem", redisChannels.usersQueue, 0, offer.steamid64],
                        ["rpush", redisChannels.betsList, offerJson],
                        ["lrem", redisChannels.checkedList, 0, offerJson]
                    ])
                        .exec(function (err, replies) {
                            redisClient.lrange(redisChannels.usersQueue, 0, -1, function(err, queues) {
                                io.sockets.emit('queue', queues);
                                console.tag('SteamBot').log("New bet Accepted!");
                                checkedProcceed = false;
                            });
                        });

                } else {
                    console.tag('SteamBot').error('Error. With accept tradeoffer #' + offer.offerid);
                    console.tag('SteamBot').log(err);
                    offers.getOffer({tradeOfferId: offer.offerid}, function (err, body){
                        if(err) {
                            checkedProcceed = false;
                            return;
                        }
                        if(body.response.offer){
                            var offerCheck = body.response.offer;
                            if(offerCheck.trade_offer_state == 2) {
                                redisClient.multi([
                                    ["lrem", redisChannels.tradeoffersList, 0, offer.offerid],
                                    ["lrem", redisChannels.usersQueue, 0, offer.steamid64],
                                    ["lrem", redisChannels.checkedList, 0, offerJson]
                                ])
                                    .exec(function (err, replies) {
                                        redisClient.lrange(redisChannels.usersQueue, 0, -1, function(err, queues) {
                                            io.sockets.emit('queue', queues);

                                            checkedProcceed = false;
                                        });
                                    });
                                return;
                            }
                            if(offerCheck.trade_offer_state == 3){
                                redisClient.multi([
                                    ["lrem", redisChannels.tradeoffersList, 0, offer.offerid],
                                    ["lrem", redisChannels.usersQueue, 0, offer.steamid64],
                                    ["rpush", redisChannels.betsList, offerJson],
                                    ["lrem", redisChannels.checkedList, 0, offerJson]
                                ])
                                    .exec(function (err, replies) {
                                        redisClient.lrange(redisChannels.usersQueue, 0, -1, function(err, queues) {
                                            io.sockets.emit('queue', queues);
                                            checkedProcceed = false;
                                        });
                                    });
                            }else {
                                redisClient.multi([
                                    ["lrem", redisChannels.tradeoffersList, 0, offer.offerid],
                                    ["lrem", redisChannels.usersQueue, 0, offer.steamid64],
                                    ["lrem", redisChannels.checkedList, 0, offerJson]
                                ])
                                    .exec(function (err, replies) {
                                        redisClient.lrange(redisChannels.usersQueue, 0, -1, function(err, queues) {
                                            io.sockets.emit('queue', queues);
 
                                            checkedProcceed = false;
                                        });
                                    });
                            }
                        }
                    })
                }
            });
        }
    });
}

var declineOffersProcceed = function(offerid){
    console.tag('SteamBot').log('Procceding decline: #' + offerid);
    offers.declineOffer({tradeOfferId: offerid}, function (err, body) {
        if (!err) {
            console.tag('SteamBot').log('Offer #' + offerid + ' Decline!');
            redisClient.lrem(redisChannels.declineList, 0, offerid);
            declineProcceed = false;
        } else {
            console.tag('SteamBot').error('Error. With decline tradeoffer #' + offer.offerid)
                .tag('SteamBot').log(err);
            declineProcceed = false;
        }
    });
}

var queueProceed = function() {
    redisClient.llen(redisChannels.checkList, function(err, length) {
        if (length > 0 && !checkProcceed) {
            console.tag('SteamBot','Queues').info('CheckOffers:' + length);
            checkProcceed = true;
            checkOfferPrice();
        }
    });
    redisClient.llen(redisChannels.checkedList, function(err, length) {
        if(length > 0 && !checkedProcceed && WebSession) {
            console.tag('SteamBot','Queues').info('CheckedOffers:' + length);
            checkedProcceed = true;
            redisClient.lindex(redisChannels.checkedList, 0,function (err, offer) {
                checkedOffersProcceed(offer);
            });
        }
    });
    redisClient.llen(redisChannels.declineList, function(err, length) {
        if(length > 0 && !declineProcceed && WebSession) {
            console.tag('SteamBot','Queues').info('DeclineOffers:' + length);
            declineProcceed = true;
            redisClient.lindex(redisChannels.declineList, 0,function (err, offer) {
                declineOffersProcceed(offer);
            });
        }
    });
    redisClient.llen(redisChannels.betsList, function(err, length) {
        if (length > 0 && !betsProcceed && !delayForNewGame) {
            console.tag('SteamBot','Queues').info('Bets:' + length);
            betsProcceed = true;
            checkNewBet();
        }
    });
    redisClient.llen(redisChannels.sendOffersList, function(err, length) {
        if (length > 0 && !sendProcceed && WebSession) {
            console.tag('SteamBot','Queues').info('Send winner offers:' + length);
            sendProcceed = true;
            redisClient.lindex(redisChannels.sendOffersList, 0,function (err, offerJson) {
                offer = JSON.parse(offerJson);
                sendTradeOffer(offer.appId, offer.steamid, offer.accessToken, offer.items, '', offer.game, offerJson);
            });
        }
    });
    redisClient.llen(redisChannels.sendOffersListLottery, function(err, length) {
        if (length > 0 && !sendProcceedLottery && WebSession) {
            console.tag('SteamBot','Queues').info('Send lottery winner offers:' + length);
            sendProcceedLottery = true;
            redisClient.lindex(redisChannels.sendOffersListLottery, 0,function (err, offerJson) {
                offer = JSON.parse(offerJson);
                sendTradeOfferLottery(offer.appId, offer.steamid, offer.accessToken, offer.items, '', offer.game, offerJson);
            });
        }
    });
    redisClient.llen(redisChannels.checkItemsList, function(err, length) {
        if (length > 0 && !parseItemsProcceed && WebSession) {
            console.tag('SteamBot','Queues').info('Parse items:' + length);
            parseItemsProcceed = true;
            redisClient.lindex(redisChannels.checkItemsList, 0, function (err, offerJson) {
                offer = JSON.parse(offerJson);
                countRetries[offerJson.tradeofferid] = 0;
                parseOffer(offer, offerJson);
            });
        }
    });
}
var parseItemsProcceed = false;
var checkProcceed = false;
var checkedProcceed = false;
var declineProcceed = false;
var betsProcceed = false;
var sendProcceed = false;
var sendProcceedLottery = false;
var delayForNewGame = false;
setInterval(queueProceed, 1500);

module.exports.handleOffers = handleOffers;
module.exports.delayForNewGame = function(value){
    delayForNewGame = value;
};

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