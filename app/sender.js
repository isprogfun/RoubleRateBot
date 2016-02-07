'use strict';

let https = require('https');
let querystring = require('querystring');
let config = require(__dirname + '/config.json');
let path = '/bot' + config.token + '/sendMessage?';
let options = {
    hostname: 'api.telegram.org',
    port: '443',
    method: 'POST'
};

module.exports = {
    /**
     * Если нам присылают конкретные команды — мы сразу отправляем конкретные ответы
     * Иначе вызываем функцию определения диалога
     */
    handleMessage: function (req, data) {
        let messageText = data.message.text;
        let chatId = data.message.chat.id;
        let that = this;
        let db = req.db;

        console.log('Got request at: ' + new Date() + '\n', data);

        // Проверяем стандартные команды
        if (['/start', '/settings', '/get', '💵', '/stop'].indexOf(messageText) !== -1) {
            db.collection('users').findOneAndUpdate({ id: chatId }, {$set: {lastMessage: messageText}});
        }

        if (messageText === '/start') {
            let text = `Бот обновляет курсы доллара и евро каждую минуту.
                Вы можете получить текущий биржевой курс, а также настроить оповещения по изменению курса.`;

            this.sendMessage(chatId, text);
        } else if (messageText === '/settings') {
            this.handleSettings(chatId, db);
        } else if (messageText === '/stop') {
            db.collection('users').findOneAndUpdate({ id: chatId }, {$set: {sendChanges: false}});
            this.sendMessage(chatId, 'Вы отписались от оповещений');
        } else if (messageText === '/get' || messageText === '💵') {
            this.sendRate(chatId, db);
        } else {
            // Команды не найдены — поиск сообщений для настроек
            db.collection('users').findOne({id: chatId}, function(err, user) {
                if (err) { throw err; }

                if (messageText === 'Выключить оповещения') {
                    db.collection('users').findOneAndUpdate({ id: chatId }, {$set: {sendChanges: false}});
                    that.handleSettings(chatId, db);
                } else if (messageText == 'Включить оповещения') {
                    db.collection('users').findOneAndUpdate({ id: chatId }, {$set: {sendChanges: true}});
                    that.handleSettings(chatId, db);
                } else if (messageText === 'Настроить разницу курса') {
                    db.collection('users').findOneAndUpdate({ id: chatId }, {$set: {lastMessage: messageText}});
                    that.sendMessage(chatId, 'Введите новое значение разницы курса (больше 0 и меньше 10)', JSON.stringify({
                        keyboard: [['Выйти']],
                        resize_keyboard: true
                    }));
                } else if (messageText === 'Выйти' &&
                    user.lastMessage === 'Настроить разницу курса') {
                    db.collection('users').findOneAndUpdate({ id: chatId }, {$set: {lastMessage: ''}});
                    that.handleSettings(chatId, db);
                } else if (user.lastMessage === 'Настроить разницу курса') {
                    let difference = parseFloat(messageText);

                    if (difference && difference > 0 && difference < 10) {
                        db.collection('users').findOneAndUpdate({ id: chatId }, {
                            $set: {difference: difference, lastMessage: ''}
                        });
                        that.handleSettings(chatId, db);
                    }
                } else if (messageText === 'Выйти') {
                    that.sendMessage(chatId, 'Вы вышли из режима настроек');
                }
            });
        }
    },

    /**
     * Выводим текущие настройки и клавиатуру с кнопками,
     * ведущими ко всем настройкам в отдельности
     */
    handleSettings: function (chatId, db) {
        var that = this;

        db.collection('users').findOne({id: chatId}, function (err, user) {
            if (err) { throw err; }

            let sendChanges = user.sendChanges || false;
            let text = 'Текущие настройки:\n' + 'Оповещения об изменении курса: ';
            let replyMarkup = {resize_keyboard: true};

            if (!user) {
                db.collection('users').insertOne({id: chatId, sendChanges: sendChanges});
            }

            if (sendChanges) {
                let difference = user.difference || 1;

                text += '*Включены* \n';
                text += `Разница курса для оповещения: *${difference} руб.*`;
                replyMarkup.keyboard = [
                    ['Выключить оповещения'],
                    ['Настроить разницу курса'],
                    ['Выйти']
                ];
            } else {
                text += '*Выключены*';
                replyMarkup.keyboard = [
                    ['Включить оповещения'],
                    ['Выйти']
                ];
            }

            that.sendMessage(chatId, text, JSON.stringify(replyMarkup));
        });
    },

    sendMessage: function (chatId, text, replyMarkup) {
        let request;

        replyMarkup = replyMarkup || JSON.stringify({
            keyboard: [['💵']],
            resize_keyboard: true
        });

        options.path = path + querystring.stringify({
            chat_id: chatId,
            text: text,
            reply_markup: replyMarkup,
            parse_mode: 'Markdown'
        });

        request = https.request (options, function (res) {
            res.on('data', function (resData) {
                console.log('Got answer at: ' + new Date() + '\n', JSON.parse(resData.toString()));
            });
        });

        request.on('error', function (e) {
            console.log('Problem with request at: ' + new Date() + '\n', e.message);
        });

        request.end();
    },

    /**
     * Отправляем курс валют
     */
    sendRate: function (chatId, db) {
        let that = this;
        let text;
        let lastSend = {};

        db.collection('rates').find().toArray(function (err, collection) {
            if (err) { throw err; }

            text = collection.map(function (rate) {
                let result = (Math.round(rate.rate * 100) / 100).toString();

                if (result.length === 4) { result = result + '0'; }

                lastSend[rate.title] = rate.rate;

                return rate.title + ': ' + result + ' руб';
            }).join('\n');

            // Пользователю сохраняем последние отправленные курсы
            db.collection('users').find({id: chatId}).toArray(function (err, users) {
                if (err) { throw err; }

                if (users && users.length) {
                    db.collection('users').update({ id: chatId }, { $set: {lastSend: lastSend} });
                }
            });

            that.sendMessage(chatId, text);
        });
    }
};
