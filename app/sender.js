var https = require('https');
var querystring = require('querystring');
var fs = require('fs');

var config = require('./config.json');
var path = '/bot' + config.token + '/sendMessage?';
var options = {
    hostname: 'api.telegram.org',
    port: '443',
    method: 'POST'
};

function sendMessage(data, text) {
    options.path = path + querystring.stringify({
        chat_id: data.message.chat.id,
        text: text,
        reply_markup: JSON.stringify({
            keyboard: [['💵']],
            resize_keyboard: true
        })
    });

    request = https.request (options, function (res) {
        res.on('data', function (resData) {
            console.log('Got answer');
            console.log(JSON.parse(resData.toString()));
        });
    });

    request.on('error', function (e) {
        console.log('Problem with request: ' + e.message);
    });

    request.end();
}

module.exports = function (data, req) {
    var request;
    var text;

    console.log('Got request: ');
    console.log(data);

    if (data.message.text === '/start') {
        text = 'Привет. Я обновляю курсы доллара и евро каждую минуту. ' +
            'Отправь мне пачку денег или команду /get и я пришлю тебе всё, что знаю.';
        sendMessage(data, text);
    } else if (data.message.text === '/get' || data.message.text === '💵') {
        req.db.collection('rates').find().toArray(function (err, collection) {
            if (err) {
                throw err;
            }

            text = collection.map(function (rate) {
                var result = (Math.round(rate.rate * 100) / 100).toString();

                if (result.length === 4) {
                    result = result + '0';
                }

                return rate.title + ': ' + result + ' руб';
            }).join('\n');

            sendMessage(data, text);
        });
    } else {
        return;
    }
};
