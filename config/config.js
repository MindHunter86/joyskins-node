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
        sharedSecret: 'hFCjzhgtmN4Rdn/lc3Pf7Ag+tCc='
    },
	//настройки бота магазина
    shopBot: {
        username: '',
        password: '',//
        timeForCancelOffer: 1800
    },
    apiKey: '89638B050C0254D97337012787F57F68',	//steam api key
    domain: 'test.joyskins.top',	//домен сайта
    secretKey: '',
    
    admins: [	//steam id админов
        '76561198175079859','76561198039687585'//
    ]
}

module.exports = config;
