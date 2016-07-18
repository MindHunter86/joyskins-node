var fs = require('fs');
var crypto = require('crypto');
var console = process.console;
var config  = require('./config/config.js');
var Steam = require('steam');
var SteamWebLogOn = require('steam-weblogon');
var getSteamAPIKey = require('steam-web-api-key');
var SteamTradeOffers = require('steam-tradeoffers');
var domain = require('domain');
var SteamTotp = require('steam-totp');
var SteamCommunity = require('steamcommunity');
var confirmations = new SteamCommunity();

var redisClient, requestify;
module.exports.init = function(redis, requestifyCore) {
    redisClient = redis.createClient();
    requestify = requestifyCore;
}

var logOnOptions = {
    account_name: config.shopBot.username,
    password: config.shopBot.password
};

var authCode = ''; // code received by email

try {
    logOnOptions.two_factor_code = SteamTotp.getAuthCode(config.shopBot.sharedSecret);
} catch (e) {
    if (authCode !== '') {
        logOnOptions.auth_code = authCode;
    }
}
console.log('Код магазин:', logOnOptions.two_factor_code);
function getSHA1(bytes) {
    var shasum = crypto.createHash('sha1');
    shasum.end(bytes);
    return shasum.read();
}
// if we've saved a server list, use it

var steamClient = new Steam.SteamClient();
var steamUser = new Steam.SteamUser(steamClient);
var steamFriends = new Steam.SteamFriends(steamClient);
var steamWebLogOn = new SteamWebLogOn(steamClient, steamUser);
var offers = new SteamTradeOffers();

var checkingOffers = [],
    WebSession = false,
    globalSession;

const redisChannels = {
    itemsToSale: 'items.to.sale',
    itemsToGive: 'items.to.give'
}

function steamBotLogger(log){
    console.tag('SteamBotShop').log(log);
}
steamClient.connect();
steamClient.on('debug', steamBotLogger);
steamClient.on('connected', function() {
    steamUser.logOn(logOnOptions);
});
steamClient.on('error', function(error) {
    console.log(error);
});
steamClient.on('logOnResponse', function(logonResp) {
    if (logonResp.eresult === Steam.EResult.OK) {
        steamBotLogger('Logged in!');
        steamFriends.setPersonaState(Steam.EPersonaState.Online);

        steamWebLogOn.webLogOn(function(sessionID, newCookie) {
            getSteamAPIKey({
                sessionID: sessionID,
                webCookie: newCookie
            }, function(err, APIKey) {
                console.log('getSteamAPIKey');
                offers.setup({
                    sessionID: sessionID,
                    webCookie: newCookie,
                    APIKey: APIKey
                });
                WebSession = true;
                globalSession = sessionID;
                redisClient.lrange(redisChannels.tradeoffersList, 0, -1, function(err, offers){
                    offers.forEach(function(offer) {
                        checkingOffers.push(offer);
                    });
                    handleOffers();
                });
                console.log('shop:',APIKey);
                //redisClient.del(redisChannels.itemsToGive);
                confirmations.setCookies(newCookie);
                redisClient.del(redisChannels.itemsToSale);
                confirmations.startConfirmationChecker(10000, config.shopBot.identitySecret);
                steamBotLogger('Setup Offers!');
            });
        });
    }
});

steamClient.on('loggedOff', function() {
    steamClient.connect();
});
steamUser.on('updateMachineAuth', function(sentry, callback) {
    fs.writeFileSync('sentry_shop', sentry.bytes);
    callback({ sha_file: getSHA1(sentry.bytes) });
});

function handleOffers() {
    offers.getOffers({
        get_received_offers: 1,
        active_only: 1,
        time_historical_cutoff: Math.round(Date.now() / 1000)
    }, function(error, body) {
        if (
            body
            && body.response
            && body.response.trade_offers_received
        ) {
            body.response.trade_offers_received.forEach(function(offer) {
                if (offer.trade_offer_state == 2) {
                    if(config.admins.indexOf(offer.steamid_other) != -1){
                        offers.acceptOffer({
                            tradeOfferId: offer.tradeofferid
                        }, function(error, traderesponse) {
                            if(!error) {
                                if ('undefined' != typeof traderesponse.tradeid) {
                                    offers.getItems({
                                        tradeId: traderesponse.tradeid
                                    }, function (error, recieved_items) {
                                        if (!error) {
                                            var itemsForParse = [], itemsForSale = [], i = 0;
                                            recieved_items.forEach(function(item){
                                                itemsForParse[i++] = item.id;
                                            })
                                            offers.loadMyInventory({appId: 730, contextId: 2}, function(error, botItems){
                                                if(!error){
                                                    i = 0;
                                                    botItems.forEach(function(item){
                                                        if(itemsForParse.indexOf(item.id) != -1){
                                                            var tags = [];
                                                            var parse = item.tags;
                                                            parse.forEach(function(i) {
                                                                tags[i.category] = i.name;
                                                            });

                                                            itemsForSale[i++] = {
                                                                inventoryId: item.id,
                                                                classId: item.classid,
                                                                name: item.name,
                                                                market_hash_name: item.market_hash_name,
                                                                rarity: tags['Rarity'],
                                                                quality: tags['Exterior'],
                                                                type: tags['Type']
                                                            }
                                                        }
                                                    });
                                                }
                                                redisClient.rpush(redisChannels.itemsToSale, JSON.stringify(itemsForSale));
                                                return;
                                            });
                                        }
                                        return;
                                    });
                                }
                            }
                            return;
                        });
                    }else{
                        offers.declineOffer({tradeOfferId: offer.tradeofferid});
                    }
                    return;
                }
            });
        }
    });
}

steamUser.on('tradeOffers', function(number) {
    console.log('Offers: ' + number);
    if (number > 0) {
        handleOffers();
    }
});
function relogin() {
    steamWebLogOn.webLogOn(function(sessionID, newCookie) {
        getSteamAPIKey({
            sessionID: sessionID,
            webCookie: newCookie
        }, function(err, APIKey) {
            offers.setup({
                sessionID: sessionID,
                webCookie: newCookie,
                APIKey: APIKey
            });
            WebSession = true;
            globalSession = sessionID;
            confirmations.setCookies(newCookie);
            confirmations.startConfirmationChecker(10000, config.shopBot.identitySecret);
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
var sendTradeOffer = function(offerJson){
    var d = domain.create();
    d.on('error', function(err) {
        console.log(err.stack);
        console.tag('SteamBotShop').error('Error to send the item');
        sendProcceed = false;
    });
    var offer = JSON.parse(offerJson);
    d.run(function () {
        offers.loadMyInventory({
            appId: 730,
            contextId: 2
        }, function (err, items) {
            if(err) {
                console.log(err);
                console.tag('SteamBotShop', 'SendPrize').log('LoadMyInventory error!');
                relogin();
                sendProcceed = false;
                return;
            }
            var itemsFromMe = [];

            items.forEach(function(item){
                if(item.id == offer.itemId){
                    itemsFromMe[0] = {
                        appid: 730,
                        contextid: 2,
                        amount: item.amount,
                        assetid: item.id
                    };
                }
            });

            if (itemsFromMe.length > 0) {
                offers.makeOffer({
                    partnerSteamId: offer.partnerSteamId,
                    accessToken: offer.accessToken,
                    itemsFromMe: itemsFromMe,
                    itemsFromThem: [],
                    message: 'Покупка в магазине '+ config.domain
                }, function (err, response) {
                    if (err) {
                        getErrorCode(err.message, function(errCode) {
                            if(errCode == 15 || errCode == 25 || err.message.indexOf('an error sending your trade offer.  Please try again later.')) {
                                redisClient.lrem(redisChannels.itemsToGive, 0, offerJson, function(err, data){
                                    setItemStatus(offer.id, 4);
                                    sendProcceed = false;
                                });  
                            }
                        });
                        sendProcceed = false;
                        return;
                    }
                    redisClient.lrem(redisChannels.itemsToGive, 0, offerJson, function(err, data){
                        sendProcceed = false;
                        setItemStatus(offer.id, 3);
                        console.tag('SteamBotShop', 'SendItem').log('TradeOffer #' + response.tradeofferid +' send!');
                    });
                });
            }else{
                redisClient.lrem(redisChannels.itemsToGive, 0, offerJson, function(err, data){
                    console.tag('SteamBotShop', 'SendItem').log('Items not found!');
                    setItemStatus(offer.id, 2);
                    sendProcceed = false;
                });
            }
        });
    });
};


var setItemStatus = function(item, status){
    requestify.post(config.domain+'/api/shop/setItemStatus', {
        secretKey: config.secretKey,
        id: item,
        status: status
    })
        .then(function(response) {
        },function(response){
            console.tag('SteamBotShop').error('Something wrong with setItemStatus. Retry...');
            setTimeout(function(){setItemStatus()}, 1000);
        });
}

var addNewItems = function(){
    requestify.post(config.domain+'/api/shop/newItems', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            var answer = JSON.parse(response.body);
            if(answer.success){
                itemsToSaleProcced = false;
            }
        },function(response){
            console.tag('SteamBotShop').error('Something wrong with newItems. Retry...');
            setTimeout(function(){addNewItems()}, 1000);
        });
}


var queueProceed = function(){
    redisClient.llen(redisChannels.itemsToSale, function(err, length) {
        if (length > 0 && !itemsToSaleProcced) {
            console.tag('SteamBotShop','Queues').info('New items to sale:' + length);
            itemsToSaleProcced = true;
            addNewItems();
        }
    });
    redisClient.llen(redisChannels.itemsToGive, function(err, length) {
        if (length > 0 && !sendProcceed && WebSession) {
            console.tag('SteamBotShop','Queues').info('Send items:' + length);
            sendProcceed = true;
            redisClient.lindex(redisChannels.itemsToGive, 0,function (err, offerJson) {
                sendTradeOffer(offerJson);
            });
        }
    });
}
var itemsToSaleProcced = false;
var sendProcceed = false;
var checkProcceed = false;
setInterval(queueProceed, 1500);
