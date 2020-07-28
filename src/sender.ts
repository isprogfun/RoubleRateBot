import * as https from 'https';
import * as querystring from 'querystring';
import { Db } from 'mongodb';

import { Update, ReplyMarkup, Options, UserUpdate } from './interfaces';
var config = require('../config.json');
var path = "/bot" + config.token + "/sendMessage?";
var options: Options = {
    hostname: 'api.telegram.org',
    port: '443',
    method: 'POST'
};

function checkMessageText(receivedMessage: string, messageToCheck: string) {
    return receivedMessage === messageToCheck || receivedMessage === `${messageToCheck}@RoubleRateBot`;
}

export default {
    // First — handle commands, then if message is not a command — try to find a dialog
    handleMessage: function (db: Db, data: Update) {
        var that = this;
        if (!data.message) {
            return;
        }
        var messageText = data.message.text;
        var chatId = data.message.chat.id;
        var chatType = data.message.chat.type;
        console.log((new Date()).toISOString() + ": Got request\n", data);
        if (checkMessageText(messageText, '/start')) {
            var text = 'Бот обновляет курсы доллара и евро раз в 5 минут, используя данные ММВБ.\n' +
                'Торги на бирже идут по будним дням с 10 до 23:50. Данные по курсам не в реальном времени, задержка около 15 минут\n\n' +
                'Пожелания и предложения присылайте на адрес isprogfun@gmail.com\n\n' +
                'Список команд:\n' +
                '/get — Получить текущий биржевой курс\n' +
                '/settings — Настроить оповещения по изменению курса\n' +
                '/stop — Отписаться от оповещений';
            this.sendMessage(chatId, chatType, text);
        }
        else if (checkMessageText(messageText, '/settings')) {
            this.handleSettings(chatId, chatType, db, data);
        }
        else if (checkMessageText(messageText, '/stop')) {
            this.updateUser(chatId, db, { sendChanges: false });
            this.sendMessage(chatId, chatType, 'Вы отписались от оповещений');
        }
        else if (checkMessageText(messageText, '/get') || checkMessageText(messageText, '💵')) {
            this.sendRate(chatId, chatType, db);
        }
        else {
            // Commands not found
            db.collection('users').findOne({ id: chatId }, function (err, user) {
                if (err) {
                    throw err;
                }
                if (checkMessageText(messageText, 'Выключить оповещения')) {
                    that.updateUser(chatId, db, { sendChanges: false });
                    that.handleSettings(chatId, chatType, db);
                }
                else if (checkMessageText(messageText, 'Включить оповещения')) {
                    that.updateUser(chatId, db, { sendChanges: true });
                    that.handleSettings(chatId, chatType, db);
                }
                else if (checkMessageText(messageText, 'Настроить разницу курса')) {
                    var text = 'Выберите или введите новое значение разницы курса (от 0.01 до 10)';
                    that.updateUser(chatId, db, { lastMessage: messageText });
                    that.sendMessage(chatId, chatType, text, JSON.stringify({
                        keyboard: [
                            ['0.01', '0.1', '0.2', '0.3', '0.5'],
                            ['1', '2', '3', '5', '10', 'Выйти']
                        ],
                        resize_keyboard: true
                    }));
                }
                else if (user && user.lastMessage === 'Настроить разницу курса' && checkMessageText(messageText, 'Выйти')) {
                    that.updateUser(chatId, db, { lastMessage: '' });
                    that.handleSettings(chatId, chatType, db);
                }
                else if (user && user.lastMessage === 'Настроить разницу курса') {
                    var difference = parseFloat(messageText);
                    if (difference && difference >= 0.01 && difference <= 10) {
                        that.updateUser(chatId, db, {
                            difference: difference,
                            lastMessage: ''
                        });
                        that.handleSettings(chatId, chatType, db);
                    }
                }
                else if (checkMessageText(messageText, 'Выйти')) {
                    that.sendMessage(chatId, chatType, 'Вы вышли из режима настроек');
                }
            });
        }
    },

    // Show settings and keyboard with controls
    handleSettings: function (chatId: string, chatType: string, db: Db, data: Update) {
        var that = this;
        db.collection('users').findOne({ id: chatId }, function (err, user) {
            if (err) {
                throw err;
            }
            var sendChanges = (user && user.sendChanges) || false;
            var replyMarkup: ReplyMarkup = { resize_keyboard: true };
            var text = 'Текущие настройки:\nОповещения об изменении курса: ';
            if (!user) {
                db.collection('users').insertOne({
                    id: chatId,
                    name: data.message.chat.first_name + " " + (data.message.chat.last_name || ''),
                    sendChanges: sendChanges,
                    difference: 1
                });
            }
            if (sendChanges) {
                var difference = user.difference || 1;
                text += `*Включены*\nРазница курса для оповещения: *${difference} руб.*`;
                replyMarkup.keyboard = [
                    ['Выключить оповещения'],
                    ['Настроить разницу курса'],
                    ['Выйти'],
                ];
            }
            else {
                text += '*Выключены*';
                replyMarkup.keyboard = [
                    ['Включить оповещения'],
                    ['Выйти'],
                ];
            }
            that.sendMessage(chatId, chatType, text, JSON.stringify(replyMarkup));
        });
    },

    // Send message
    sendMessage: function (chatId: number, chatType: string, text: string, _replyMarkup: string) {
        var replyMarkup;

        if (_replyMarkup) {
            replyMarkup = _replyMarkup;
        } else if (chatType === 'private') {
            replyMarkup = JSON.stringify({
                keyboard: [['💵']],
                resize_keyboard: true
            });
        } else {
            replyMarkup = JSON.stringify({
                remove_keyboard: true
            });
        }

        const settings = {
            chat_id: chatId,
            text: text,
            reply_markup: replyMarkup,
            parse_mode: 'Markdown'
        };

        options.path = path + querystring.stringify(settings);
        var request = https.request(options, function (res) {
            res.on('data', function (resData) {
                console.log((new Date()).toISOString() + ": Got answer\n", JSON.parse(resData.toString()));
            });
        });
        request.on('error', function (err) {
            console.log((new Date()).toISOString() + ": Problem with request\n", err);
        });
        request.end();
    },

    // Send rate
    sendRate: function (chatId: number, chatType: string, db: Db) {
        var that = this;
        db.collection('rates').find().toArray(function (ratesError, collection) {
            if (ratesError) {
                throw ratesError;
            }
            db.collection('users').findOne({ id: chatId }, function (userError, user) {
                if (userError) {
                    throw userError;
                }
                var lastSend = (user && user.lastSend) || {};
                // Dollar first
                collection.sort(function (rate) {
                    if (rate.title === 'USD') {
                        return -1;
                    }
                    return 1;
                });
                var text = collection.map(function (rate) {
                    var result = rate.title + ": " + rate.rate + " \u0440\u0443\u0431";
                    var difference;
                    if (lastSend && Object.keys(lastSend).length) {
                        difference = Number(rate.rate - lastSend[rate.title]).toFixed(2);
                    }
                    if (difference && Number(difference) > 0) {
                        result += " _(+" + difference + " \u0440\u0443\u0431)_";
                    }
                    else if (difference && Number(difference) !== 0 && (Number(difference)).toString() !== 'NaN') {
                        result += " _(" + difference + " \u0440\u0443\u0431)_";
                    }
                    lastSend[rate.title] = rate.rate;
                    return result;
                }).join('\n');
                // Save last sent rates to user
                that.updateUser(chatId, db, { lastSend: lastSend });
                that.sendMessage(chatId, chatType, text);
            });
        });
    },

    // Update user settings
    updateUser: function (chatId: number, db: Db, data: UserUpdate) {
        var that = this;
        if (data && Object.keys(data).length) {
            db.collection('users').findOneAndUpdate({
                id: chatId
            }, {
                $set: data
            }, function (err) {
                if (err) {
                    throw err;
                }
            });
        }
    }
};
