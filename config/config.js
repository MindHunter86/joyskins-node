/*
Config file
 */

var config = {
    serverPort: 80,
    prefix: '',
    redisPort: 6379,
    redisIp: '127.0.0.1',
	//настройка бота рулетки
    bot: {
        username: 'baidalenedal',
        password: 'YsvVQa21Apk9',//
        sharedSecret: 'i7Haiv/jaI2q1aXVVczYzhcTZm0=',
        identitySecret: 'vt2lAeKhDS/6IdBosHMm36CB7mo='
    },
	//настройки бота магазина
    shopBot: {
        username: 'romsdoto',
        password: '',//
        sharedSecret: '',
        identitySecret: '',
        timeForCancelOffer: 1800
    },
    //настройки дуэль бота
    duelsBot:{
        username: 'aselleyarourse',
        password: 'AUSvGghJbfyuMJ',
        sharedSecret: 'hFCjzhgtmN4Rdn/lc3Pf7Ag+tCc=',
        identitySecret: 'x+8MzBTaqlGJ5ZpYDpRerA5iS4M='
    },
    apiKey: '89638B050C0254D97337012787F57F68',	//steam api key
    domain: 'joyskins.top',	//домен сайта
    protocol: 'https://',
    secretKey: 'GDDrHk76e2n8kwcYtLrbht9ETg2yGC3L',
    
    admins: [	//steam id админов
        '76561198175079859','76561198039687585'//
    ]
}

module.exports = config;
