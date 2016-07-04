/*
Config file
 */

var config = {
    serverPort: 80,
    prefix: '',
	//настройка бота рулетки
    bot: {
        username: 'aselleyarourse',
        password: 'AUSvGghJbfyuMJ',
        sharedSecret: 'BD0KsfI7CbVOPIi4Zo7crK/oFN0=',
        identitySecret: 'qkiz6mE/i6ZZnXNS8lc0zkMdD5E='
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
        sharedSecret: 'BD0KsfI7CbVOPIi4Zo7crK/oFN0=',
        identitySecret: 'qkiz6mE/i6ZZnXNS8lc0zkMdD5E='
    },
    apiKey: '89638B050C0254D97337012787F57F68',	//steam api key
    domain: 'http://164.132.47.168',	//домен сайта
    secretKey: 'GDDrHk76e2n8kwcYtLrbht9ETg2yGC3L',
    
    admins: [	//steam id админов
        '76561198175079859','76561198039687585'//
    ]
}

module.exports = config;
