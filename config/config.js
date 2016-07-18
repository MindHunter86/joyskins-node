/*
Config file
 */

var config = {
    serverPort: 80,
    prefix: '',
	//настройка бота рулетки
    bot: {
        username: 'baidalenedal',
        password: 'YsvVQa21Apk9',//
        sharedSecret: 'i7Haiv/jaI2q1aXVVczYzhcTZm0=',
        identitySecret: 'vt2lAeKhDS/6IdBosHMm36CB7mo='
    },
	//настройки бота магазина
    shopBot: {
        username: '',
        password: '',//
        sharedSecret: '8z3EuTV1OuF13AyDVmQCpyLcz+I=',
        identitySecret: 'Gz+2GzTeEzK3kRDTltiycctlVAE=',
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
    domain: 'http://164.132.47.168',	//домен сайта
    secretKey: 'GDDrHk76e2n8kwcYtLrbht9ETg2yGC3L',
    
    admins: [	//steam id админов
        '76561198175079859','76561198039687585'//
    ]
}

module.exports = config;
