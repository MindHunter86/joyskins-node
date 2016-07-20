var fs = require('fs');
var auth = require('http-auth'),
    scribe = require('scribe-js')(),
    console = process.console,
    config  = require('./config/config.js'),
    app     = require('express')(),
    server  = require('http').createServer(app),
    io      = require('socket.io')(server),
    redis   = require('redis'),
    requestify   = require('requestify'),
    bot     = require('./bot.js'),
    shop     = require('./shop.js'),
    duel = require('./duel.js');

var redisClient = redis.createClient(),
    client = redis.createClient();

bot.init(redis, io, requestify);
shop.init(redis, requestify);
duel.init(redis, io, requestify);

server.listen(8080);

console.log('Server started on ' + config.domain + ':8080');

var basicAuth = auth.basic({ //basic auth config
    realm: "WebPanel",
    file: __dirname + "/config/users.htpasswd"
});
app.use('/logs', auth.connect(basicAuth), scribe.webPanel());

redisClient.subscribe(config.prefix + 'refresh.bot');
redisClient.subscribe(config.prefix + 'show.winners');
redisClient.subscribe(config.prefix + 'queue');
redisClient.subscribe(config.prefix + 'newDeposit');
redisClient.subscribe(config.prefix + 'newPlayer');
redisClient.subscribe(config.prefix + 'depositDecline');
redisClient.subscribe(config.prefix + 'show.lottery.winners');
redisClient.subscribe(config.prefix + 'newRoom');
redisClient.subscribe(config.prefix + 'newJoin');
redisClient.subscribe(config.prefix + 'show.duel.winner');
redisClient.subscribe(config.prefix + 'pre.finish.duel');

redisClient.setMaxListeners(0);
redisClient.on("message", function(channel, message) {
    if(channel == config.prefix + 'depositDecline' || channel == config.prefix + 'queue'){
        io.sockets.emit(channel, message);
    }
    if(channel == config.prefix + 'refresh.bot'){
        console.tag('Admin').log('HARD RESTART APP.JS');
        process.exit(0);
    }
    if(channel == config.prefix + 'show.winners'){
        clearInterval(timer);
        timerStatus = false;
        console.log('Force Stop');
        game.status = 3;
        showSliderWinners();
    }
    if(channel == 'show.lottery.winners') {
        console.log('Start Winner Lottery');
        showSliderWinnersLottery();
    }
    if(channel == config.prefix + 'newPlayer'){
        io.sockets.emit(channel, message);
    }
    if(channel == config.prefix + 'show.duel.winner')
    {
        io.sockets.emit(channel,message);
    }
    if(channel == config.prefix + 'pre.finish.duel')
    {
        io.sockets.emit(channel,message);
        setTimeout(function(){
            message = JSON.parse(message);
            console.log('Finish duel room: ',message.roomId);
            finishDuelRoom(message.roomId);
        },10000);
    }
    if(channel == config.prefix + 'newRoom') {
        io.sockets.emit(channel, message);
    }
    if(channel == config.prefix + 'newJoin') {
        io.sockets.emit(channel,message);
    }
    if(channel == config.preft + 'userLeftRoom') {
        io.sockets.emit(channel,message);
    }
    if(channel == config.prefix + 'newDeposit'){
        io.sockets.emit(channel, message);

        message = JSON.parse(message);
        if(!timerStatus && message.gameStatus == 1){
            game.status = 1;
            startTimer(io.sockets);
        }
    }
});

io.sockets.on('connection', function(socket) {

    updateOnline();
    socket.on('disconnect', function(){
        updateOnline();
    })
});

function updateOnline(){
    io.sockets.emit('online', Object.keys(io.sockets.adapter.rooms).length);
   // console.info('Connected ' + Object.keys(io.sockets.adapter.rooms).length + ' clients');
}

var steamStatus = [],
    game,
    timer,
    ngtimer,
    timerStatus = false,
    timerTime = 120,
    preFinishingTime = 2;

getCurrentGame();
//checkSteamInventoryStatus();

var preFinish = false;
function startTimer(){
    var time = timerTime;
    timerStatus = true;
    clearInterval(timer);
    console.tag('Game').log('Game start.');
    timer = setInterval(function(){
       // console.tag('Game').log('Timer:' + time);
        io.sockets.emit('timer', time--);
        if((game.status == 1) && (time <= preFinishingTime)){
            if(!preFinish){
                preFinish = true;
                setGameStatus(2);
            }
        }
        if(time <= 0){
            clearInterval(timer);
            timerStatus = false;
            console.tag('Game').log('Game end.');
            showSliderWinners();
        }
    }, 1000);
}

function startNGTimer(winners){
    var time = 18;
    data = JSON.parse(winners);
    data.showSlider = true;
    clearInterval(ngtimer);
    ngtimer = setInterval(function(){
        bot.delayForNewGame(true);
        if(time <= 10) data.showSlider = false;
       // console.tag('Game').log('NewGame Timer:' + time);
        data.time = time--;
        io.sockets.emit('slider', data);
        if(time <= 0){
            clearInterval(ngtimer);
            newGame();
            bot.delayForNewGame(false);
        }
    }, 1000);
}
function finishDuelRoom(item){
    requestify.post(config.domain+'/api/duel/finishRoom', {
            id: item,
            secretKey: config.secretKey
        })
        .then(function(response) {
        },function(response){
            console.tag('Game').log('Something wrong [finishDuelRoom]',response);
            setTimeout(finishDuelRoom(item), 1000);
        });
}
function getCurrentGame(){
    requestify.post(config.domain+'/api/getCurrentGame', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            console.log(response.body);
            game = JSON.parse(response.body);
            console.tag('Game').log('Current Game #' + game.id);
            if(game.status == 1) startTimer();
            if(game.status == 2) startTimer();
            if(game.status == 3) newGame();
        },function(response){
            console.tag('Game').log('Something wrong [getCurrentGame]');
            setTimeout(getCurrentGame, 1000);
        });
}
function newLottery(){
    requestify.post(config.domain+'/api/newLottery', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            game = JSON.parse(response.body);
            console.tag('Lottery').log('New lottery! #' + game.id);
            io.sockets.emit('newLottery', game);
            bot.handleOffers();
            //redisClient.del('usersQueue.list');
        },function(response){
            console.tag('Lottery').error('Something wrong [newLottery]');
            setTimeout(newLottery, 1000);
        });
}
function newGame(){
    requestify.post(config.domain+'/api/newGame', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            game = JSON.parse(response.body);
            console.tag('Game').log('New game! #' + game.id);
            io.sockets.emit('newGame', game);
            bot.handleOffers();
            preFinish = false;
            requestify.post(config.domain+'/api/bonusBet', {
                secretKey: config.secretKey
            })
            .then(function(response) {
                console.log('bonus');
            }, function(response) {
                console.log('error bonus');
            });
            //redisClient.del('usersQueue.list');
        },function(response){
            console.tag('Game').error('Something wrong [newGame]');
            setTimeout(newGame, 1000);
        });
}

function showSliderWinnersLottery(){
    requestify.post(config.domain+'/api/getWinnersLottery', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            var winners = response.body;
            data = JSON.parse(winners);
            io.sockets.emit('sliderLottery', data);
            setTimeout(newLottery, 10000);
            console.tag('Lottery').log('Show slider!');
        },function(response){
            console.tag('Lottery').error('Something wrong [showSlider]');
            setTimeout(showSliderWinnersLottery, 1000);
        });
}
function showSliderWinners(){
    requestify.post(config.domain+'/api/getWinners', {
        secretKey: config.secretKey
    })
        .then(function(response) {
            var winners = response.body;
            console.tag('Game').log('Show slider!');
            startNGTimer(winners);
            setGameStatus(3);
            //io.sockets.emit('slider', winners)
        },function(response){
            console.tag('Game').error('Something wrong [showSlider]');
            setTimeout(showSliderWinners, 1000);
        });
}

function setGameStatus(status){
    requestify.post(config.domain+'/api/setGameStatus', {
        status: status,
        secretKey: config.secretKey
    })
        .then(function(response) {
            game = JSON.parse(response.body);
            console.tag('Game').log('Set game to a prefinishing status. Bets are redirected to a new game.');
        },function(response){
            console.tag('Game').error('Something wrong [setGameStatus]');
            setTimeout(setGameStatus, 1000);
        });
}

function checkSteamInventoryStatus() {
    requestify.get('http://api.steampowered.com/ICSGOServers_730/GetGameServersStatus/v1/?key=' + config.apiKey)
        .then(function(response) {
            var answer = JSON.parse(response.body);
            steamStatus = answer.result.services;
            console.tag('SteamStatus').info(steamStatus);
            client.set('steam.community.status', steamStatus.SteamCommunity);
            client.set('steam.inventory.status', steamStatus.IEconItems);
        },function(response){
            console.log('Something wrong [5]');
         //   console.log(response.body);
        });
}
setInterval(checkSteamInventoryStatus, 120000);