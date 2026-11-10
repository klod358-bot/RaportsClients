/**
 * АВТОКИНО — сервер приёма заявок (Google Apps Script)
 * ------------------------------------------------------------------
 * Что делает:
 *   • принимает заявку с сайта вместе с фото автомобиля, фото клиента и чеком;
 *   • присваивает уникальный номер (AV-1001, AV-1002 …);
 *   • сохраняет файлы в Google Drive (отдельная папка на каждый заказ);
 *   • записывает заказ в Google Таблицу «АВТОКИНО — заказы»;
 *   • отправляет уведомление в Telegram со всеми фото и чеком;
 *   • отдаёт данные админке: список заказов, файлы, смена статуса и заметки.
 *
 * Установка — по шагам в README.md (папка autokino в репозитории).
 * Коротко: вставить этот код в новый проект на script.google.com,
 * заполнить CONFIG ниже, запустить функцию setup(), затем
 * «Развернуть → Новое развертывание → Веб-приложение»
 * (Запуск от имени: Я, Доступ: Все) и вставить ссылку …/exec в config.js сайта.
 */

var CONFIG = {
  // Пароль для входа в админку (admin.html). Обязательно поменяйте!
  ADMIN_PASSWORD: 'СМЕНИТЕ-ПАРОЛЬ',

  // Telegram: токен бота от @BotFather и ID чата, куда слать заявки.
  // Как узнать ID чата — запустите функцию findTelegramChatId() (см. README).
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',

  // Ссылка на админку — придёт в уведомлении
  ADMIN_URL: 'https://klod358-bot.github.io/RaportsClients/autokino/admin.html',

  BRAND: 'АВТОКИНО',
  ORDER_PREFIX: 'AV-',
  FIRST_ORDER_NUMBER: 1001,
  TIMEZONE: 'Asia/Almaty',
  CURRENCY: '₸',

  // Сообщать в Telegram, когда в админке меняют статус заказа
  NOTIFY_STATUS_CHANGES: false,

  // Ограничения
  MAX_FILE_MB: 15,
  MAX_TOTAL_MB: 45,
  MAX_PERSON_PHOTOS: 5,
  MAX_VIDEOS_PER_ORDER: 10,
};

var STATUSES = ['Новый', 'Ожидает проверки оплаты', 'Оплачен', 'В работе', 'Готов', 'Отправлен клиенту'];

var CAR_SLOTS = [
  ['car_front', 'Спереди'],
  ['car_back', 'Сзади'],
  ['car_left', 'Слева'],
  ['car_right', 'Справа'],
];

var COLUMNS = [
  'Номер', 'Создан', 'Статус', 'Имя', 'Телефон', 'Instagram',
  'Марка', 'Модель', 'Год', 'Цвет', 'Роликов', 'Сумма',
  'Атмосфера', 'Сюжет', 'Пожелания', 'Папка с файлами', 'Файлы (служебное)',
  'Telegram', 'Обновлён', 'Заметка', 'Страница',
];
var COL = {};
COLUMNS.forEach(function (name, i) { COL[name] = i + 1; });

var SHEET_NAME = 'Заказы';

/* ======================== Вход ======================== */

function doGet() {
  return json_({ ok: true, service: CONFIG.BRAND, time: new Date().toISOString() });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw) fail_('Пустой запрос', 'bad_request');
    var body;
    try { body = JSON.parse(raw); } catch (err) { fail_('Некорректный запрос', 'bad_request'); }

    switch (body.action) {
      case 'createOrder':
        return json_(createOrder_(body));
      case 'login':
        requireAdmin_(body);
        return json_({ ok: true, statuses: STATUSES, brand: CONFIG.BRAND });
      case 'listOrders':
        requireAdmin_(body);
        return json_(listOrders_());
      case 'getFile':
        requireAdmin_(body);
        return json_(getFile_(body));
      case 'updateOrder':
        requireAdmin_(body);
        return json_(updateOrder_(body));
      default:
        fail_('Неизвестное действие', 'bad_request');
    }
  } catch (err) {
    var known = err && err.userMessage;
    if (!known) console.error(err && err.stack || err);
    return json_({
      ok: false,
      error: known ? err.userMessage : 'Ошибка на сервере. Попробуйте ещё раз через минуту.',
      code: known ? err.code : 'server',
    });
  }
}

/* ======================== Новый заказ ======================== */

function createOrder_(body) {
  var o = body.order || {};
  var f = body.files || {};

  // Ловушка для ботов: настоящий человек это поле не видит и не заполняет
  if (o.website) return { ok: true, orderId: CONFIG.ORDER_PREFIX + '0000' };

  var cache = CacheService.getScriptCache();
  var clientId = str_(body.clientId, 80);
  if (clientId) {
    var prev = cache.get('cid:' + clientId);
    if (prev) return { ok: true, orderId: prev, duplicate: true };
  }

  var order = {
    name: str_(o.name, 80),
    phone: str_(o.phone, 32),
    instagram: str_(o.instagram, 60).replace(/^@+/, ''),
    brand: str_(o.brand, 60),
    model: str_(o.model, 60),
    year: str_(o.year, 4),
    color: str_(o.color, 40),
    moods: (Array.isArray(o.moods) ? o.moods : []).slice(0, 12).map(function (m) { return str_(m, 40); }).filter(String).join(', '),
    story: str_(o.story, 3000),
    wishes: str_(o.wishes, 2000),
    quantity: clampInt_(o.quantity, 1, CONFIG.MAX_VIDEOS_PER_ORDER),
    amount: Math.max(0, Math.round(Number(o.amount) || 0)),
    page: str_(o.page, 300),
  };

  if (order.name.length < 2) fail_('Укажите имя', 'validation');
  var phoneDigits = order.phone.replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 15) fail_('Проверьте номер телефона', 'validation');
  if (!order.brand) fail_('Укажите марку автомобиля', 'validation');
  if (!order.model) fail_('Укажите модель автомобиля', 'validation');
  var y = Number(order.year);
  if (!/^\d{4}$/.test(order.year) || y < 1900 || y > new Date().getFullYear() + 1) fail_('Проверьте год выпуска', 'validation');
  if (!order.color) fail_('Укажите цвет автомобиля', 'validation');
  if (o.consent !== true) fail_('Нужно согласие на обработку данных', 'validation');

  var files = decodeFiles_(f);

  // Номер заказа выдаём под блокировкой, чтобы два клиента не получили один номер
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var orderId;
  try {
    orderId = nextOrderId_();
  } finally {
    lock.releaseLock();
  }

  var store = store_();
  var folderName = orderId + ' — ' + order.name + ' — ' + order.brand + ' ' + order.model;
  var folder = store.folder.createFolder(folderName.slice(0, 120));
  var saved = files.map(function (x) {
    x.blob.setName(orderId + '_' + x.fileName);
    var file = folder.createFile(x.blob);
    return { kind: x.kind, label: x.label, id: file.getId(), name: file.getName(), mime: x.mime, size: x.size };
  });

  var now = new Date();
  var row = [];
  row[COL['Номер'] - 1] = orderId;
  row[COL['Создан'] - 1] = now;
  row[COL['Статус'] - 1] = STATUSES[0];
  row[COL['Имя'] - 1] = cell_(order.name);
  row[COL['Телефон'] - 1] = "'" + order.phone; // апостроф — чтобы таблица не приняла «+7…» за формулу
  row[COL['Instagram'] - 1] = order.instagram ? "'@" + order.instagram : '';
  row[COL['Марка'] - 1] = cell_(order.brand);
  row[COL['Модель'] - 1] = cell_(order.model);
  row[COL['Год'] - 1] = order.year;
  row[COL['Цвет'] - 1] = cell_(order.color);
  row[COL['Роликов'] - 1] = order.quantity;
  row[COL['Сумма'] - 1] = order.amount;
  row[COL['Атмосфера'] - 1] = cell_(order.moods);
  row[COL['Сюжет'] - 1] = cell_(order.story);
  row[COL['Пожелания'] - 1] = cell_(order.wishes);
  row[COL['Папка с файлами'] - 1] = folder.getUrl();
  row[COL['Файлы (служебное)'] - 1] = JSON.stringify(saved);
  row[COL['Telegram'] - 1] = '…';
  row[COL['Обновлён'] - 1] = now;
  row[COL['Заметка'] - 1] = '';
  row[COL['Страница'] - 1] = cell_(order.page);
  for (var i = 0; i < COLUMNS.length; i++) if (row[i] === undefined) row[i] = '';
  store.sheet.appendRow(row);

  if (clientId) cache.put('cid:' + clientId, orderId, 21600);

  var tgStatus;
  try {
    tgStatus = notifyNewOrder_(orderId, order, files, folder.getUrl());
  } catch (err) {
    tgStatus = 'Ошибка: ' + String(err && err.message || err).slice(0, 200);
    console.error(err);
  }
  var rowIndex = findRow_(store.sheet, orderId);
  if (rowIndex) store.sheet.getRange(rowIndex, COL['Telegram']).setValue(tgStatus);

  return { ok: true, orderId: orderId };
}

function decodeFiles_(f) {
  var list = [];
  var total = 0;
  var maxBytes = CONFIG.MAX_FILE_MB * 1024 * 1024;

  function take(src, kind, label, fileName, allowPdf, required) {
    if (!src || !src.data) {
      if (required) fail_('Не хватает файла: ' + label.toLowerCase(), 'validation');
      return;
    }
    var bytes;
    try { bytes = Utilities.base64Decode(String(src.data)); } catch (err) { fail_('Файл повреждён: ' + label.toLowerCase(), 'validation'); }
    if (!bytes.length) fail_('Пустой файл: ' + label.toLowerCase(), 'validation');
    if (bytes.length > maxBytes) fail_('Файл слишком большой: ' + label.toLowerCase() + ' (максимум ' + CONFIG.MAX_FILE_MB + ' МБ)', 'validation');
    var mime = sniffMime_(bytes);
    if (!mime || (mime === 'application/pdf' && !allowPdf)) {
      fail_('Неподдерживаемый формат: ' + label.toLowerCase() + '. Нужны JPG или PNG' + (allowPdf ? ' или PDF' : ''), 'validation');
    }
    total += bytes.length;
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime];
    list.push({
      kind: kind, label: label, mime: mime, size: bytes.length,
      fileName: fileName + '.' + ext,
      blob: Utilities.newBlob(bytes, mime, fileName + '.' + ext),
    });
  }

  CAR_SLOTS.forEach(function (s) { take(f[s[0]], s[0], 'Фото ' + s[1].toLowerCase(), s[0], false, true); });
  var people = Array.isArray(f.person) ? f.person : [];
  if (!people.length) fail_('Загрузите хотя бы одно своё фото', 'validation');
  if (people.length > CONFIG.MAX_PERSON_PHOTOS) fail_('Слишком много фото клиента (максимум ' + CONFIG.MAX_PERSON_PHOTOS + ')', 'validation');
  people.forEach(function (p, i) { take(p, 'person', 'Фото клиента ' + (i + 1), 'person_' + (i + 1), false, true); });
  take(f.receipt, 'receipt', 'Чек об оплате', 'receipt', true, true);

  if (total > CONFIG.MAX_TOTAL_MB * 1024 * 1024) fail_('Файлы слишком большие в сумме. Уменьшите количество фото.', 'validation');
  return list;
}

function sniffMime_(bytes) {
  function b(i) { return bytes[i] & 0xff; }
  if (bytes.length > 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (bytes.length > 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
      b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  if (bytes.length > 5 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) return 'application/pdf';
  return '';
}

function nextOrderId_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('LAST_ORDER_NUMBER') || (CONFIG.FIRST_ORDER_NUMBER - 1));
  var next = last + 1;
  props.setProperty('LAST_ORDER_NUMBER', String(next));
  return CONFIG.ORDER_PREFIX + next;
}

/* ======================== Хранилище ======================== */

function store_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_ID');
  var sheetId = props.getProperty('SHEET_ID');
  var folder, ss;

  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (err) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder(CONFIG.BRAND + ' — заказы');
    props.setProperty('FOLDER_ID', folder.getId());
  }

  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.BRAND + ' — заказы');
    try { ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE); } catch (err) { /* noop */ }
    try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (err) { /* оставим в корне Диска */ }
    props.setProperty('SHEET_ID', ss.getId());
  }

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    var first = ss.getSheets()[0];
    if (first && first.getLastRow() === 0) { sheet = first; sheet.setName(SHEET_NAME); }
    else sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
    sheet.getRange(2, COL['Статус'], 1000, 1).setDataValidation(rule);
    sheet.getRange(2, COL['Создан'], 1000, 1).setNumberFormat('dd.mm.yyyy hh:mm');
    sheet.getRange(2, COL['Обновлён'], 1000, 1).setNumberFormat('dd.mm.yyyy hh:mm');
    sheet.getRange(2, COL['Сумма'], 1000, 1).setNumberFormat('#,##0');
    sheet.setColumnWidth(COL['Файлы (служебное)'], 80);
    sheet.setColumnWidth(COL['Сюжет'], 260);
    sheet.setColumnWidth(COL['Пожелания'], 220);
  }
  return { folder: folder, ss: ss, sheet: sheet };
}

function findRow_(sheet, orderId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var ids = sheet.getRange(2, COL['Номер'], last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(orderId)) return i + 2;
  }
  return 0;
}

function rowToOrder_(r) {
  function v(name) { return r[COL[name] - 1]; }
  function iso(d) { return d instanceof Date ? d.toISOString() : (d ? String(d) : ''); }
  var files = [];
  try { files = JSON.parse(v('Файлы (служебное)') || '[]'); } catch (err) { files = []; }
  return {
    id: String(v('Номер')),
    createdAt: iso(v('Создан')),
    status: String(v('Статус') || STATUSES[0]),
    name: String(v('Имя') || ''),
    phone: String(v('Телефон') || '').replace(/^'/, ''),
    instagram: String(v('Instagram') || ''),
    brand: String(v('Марка') || ''),
    model: String(v('Модель') || ''),
    year: String(v('Год') || ''),
    color: String(v('Цвет') || ''),
    quantity: Number(v('Роликов')) || 1,
    amount: Number(v('Сумма')) || 0,
    moods: String(v('Атмосфера') || ''),
    story: String(v('Сюжет') || ''),
    wishes: String(v('Пожелания') || ''),
    folderUrl: String(v('Папка с файлами') || ''),
    files: files,
    telegram: String(v('Telegram') || ''),
    updatedAt: iso(v('Обновлён')),
    note: String(v('Заметка') || ''),
  };
}

/* ======================== Админка ======================== */

function requireAdmin_(body) {
  if (!CONFIG.ADMIN_PASSWORD || CONFIG.ADMIN_PASSWORD === 'СМЕНИТЕ-ПАРОЛЬ') {
    fail_('Пароль админки не задан. Укажите его в CONFIG.ADMIN_PASSWORD в коде сервера и разверните новую версию.', 'auth');
  }
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('adminFails') || 0);
  if (fails >= 10) fail_('Слишком много неудачных попыток. Подождите 10 минут.', 'locked');
  if (String(body.password || '') !== String(CONFIG.ADMIN_PASSWORD)) {
    cache.put('adminFails', String(fails + 1), 600);
    fail_('Неверный пароль', 'auth');
  }
}

function listOrders_() {
  var store = store_();
  var sheet = store.sheet;
  var last = sheet.getLastRow();
  var orders = [];
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues();
    values.forEach(function (r) { if (r[0]) orders.push(rowToOrder_(r)); });
  }
  orders.reverse();
  return { ok: true, orders: orders, statuses: STATUSES, sheetUrl: store.ss.getUrl(), folderUrl: store.folder.getUrl() };
}

function getFile_(body) {
  var store = store_();
  var rowIndex = findRow_(store.sheet, body.orderId);
  if (!rowIndex) fail_('Заказ не найден', 'not_found');
  var r = store.sheet.getRange(rowIndex, 1, 1, COLUMNS.length).getValues()[0];
  var order = rowToOrder_(r);
  var meta = null;
  order.files.forEach(function (x) { if (x.id === body.fileId) meta = x; });
  if (!meta) fail_('Файл не относится к этому заказу', 'not_found');

  var file = DriveApp.getFileById(meta.id);
  var blob = null;
  if (body.size === 'thumb') {
    try { blob = file.getThumbnail(); } catch (err) { blob = null; }
  }
  var isThumb = !!blob;
  if (!blob) blob = file.getBlob();
  return {
    ok: true,
    thumb: isThumb,
    mime: isThumb ? (blob.getContentType() || 'image/png') : meta.mime,
    name: meta.name,
    data: Utilities.base64Encode(blob.getBytes()),
  };
}

function updateOrder_(body) {
  var store = store_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var result;
  try {
    var rowIndex = findRow_(store.sheet, body.orderId);
    if (!rowIndex) fail_('Заказ не найден', 'not_found');
    var range = store.sheet.getRange(rowIndex, 1, 1, COLUMNS.length);
    var r = range.getValues()[0];
    var before = rowToOrder_(r);
    var changed = false;
    if (body.status !== undefined) {
      if (STATUSES.indexOf(body.status) === -1) fail_('Неизвестный статус', 'validation');
      if (body.status !== before.status) {
        store.sheet.getRange(rowIndex, COL['Статус']).setValue(body.status);
        changed = true;
      }
    }
    if (body.note !== undefined) {
      store.sheet.getRange(rowIndex, COL['Заметка']).setValue(cell_(str_(body.note, 3000)));
      changed = true;
    }
    if (changed) store.sheet.getRange(rowIndex, COL['Обновлён']).setValue(new Date());
    result = rowToOrder_(store.sheet.getRange(rowIndex, 1, 1, COLUMNS.length).getValues()[0]);
    if (CONFIG.NOTIFY_STATUS_CHANGES && body.status !== undefined && body.status !== before.status) {
      try { tg_('sendMessage', { chat_id: CONFIG.TELEGRAM_CHAT_ID, text: '🔄 ' + result.id + ': ' + before.status + ' → ' + result.status }); } catch (err) { console.error(err); }
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, order: result };
}

/* ======================== Telegram ======================== */

function notifyNewOrder_(orderId, order, files, folderUrl) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return 'не настроен';
  var chat = CONFIG.TELEGRAM_CHAT_ID;
  var phoneDigits = order.phone.replace(/\D/g, '');
  var lines = [
    '🎬 <b>Новый заказ ' + h_(orderId) + '</b>',
    '',
    '👤 ' + h_(order.name),
    '📞 ' + h_(order.phone) + (phoneDigits ? ' · <a href="https://wa.me/' + phoneDigits + '">WhatsApp</a>' : ''),
  ];
  if (order.instagram) lines.push('📷 <a href="https://instagram.com/' + encodeURIComponent(order.instagram) + '">@' + h_(order.instagram) + '</a>');
  lines.push('🚗 ' + h_(order.brand + ' ' + order.model) + ', ' + h_(order.year) + ', ' + h_(order.color));
  lines.push('🎞 Роликов: ' + order.quantity + ' · Сумма: ' + h_(formatMoney_(order.amount)));
  if (order.moods) lines.push('✨ ' + h_(order.moods));
  if (order.story) lines.push('📝 <b>Сюжет:</b> ' + h_(cut_(order.story, 900)));
  if (order.wishes) lines.push('💬 <b>Пожелания:</b> ' + h_(cut_(order.wishes, 700)));
  lines.push('');
  lines.push('📂 <a href="' + h_(folderUrl) + '">Папка с файлами</a>' + (CONFIG.ADMIN_URL ? ' · <a href="' + h_(CONFIG.ADMIN_URL) + '">Админка</a>' : ''));
  lines.push('🧾 Чек прикреплён — проверьте поступление.');

  tg_('sendMessage', { chat_id: chat, text: cut_(lines.join('\n'), 4000), parse_mode: 'HTML', disable_web_page_preview: 'true' });

  var photos = files.filter(function (x) { return x.kind !== 'receipt'; });
  for (var i = 0; i < photos.length; i += 10) {
    var chunk = photos.slice(i, i + 10);
    if (chunk.length === 1) {
      tg_('sendPhoto', { chat_id: chat, photo: chunk[0].blob, caption: orderId + ' · ' + chunk[0].label });
      continue;
    }
    var payload = { chat_id: chat };
    var media = chunk.map(function (x, j) {
      payload['p' + j] = x.blob;
      return { type: 'photo', media: 'attach://p' + j, caption: (i + j === 0 ? orderId + ' · ' : '') + x.label };
    });
    payload.media = JSON.stringify(media);
    tg_('sendMediaGroup', payload);
  }

  var receipt = files.filter(function (x) { return x.kind === 'receipt'; })[0];
  if (receipt) {
    var cap = '🧾 Чек об оплате · ' + orderId + ' · ' + formatMoney_(order.amount);
    if (receipt.mime === 'application/pdf') tg_('sendDocument', { chat_id: chat, document: receipt.blob, caption: cap });
    else tg_('sendPhoto', { chat_id: chat, photo: receipt.blob, caption: cap });
  }
  return 'отправлено';
}

function tg_(method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Telegram ' + method + ' (' + code + '): ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

/* ======================== Служебные функции для запуска вручную ======================== */

/** Шаг установки: создаёт папку и таблицу, проверяет Telegram. Запустите один раз из редактора. */
function setup() {
  var store = store_();
  console.log('Папка с заказами: ' + store.folder.getUrl());
  console.log('Таблица заказов: ' + store.ss.getUrl());
  if (!CONFIG.ADMIN_PASSWORD || CONFIG.ADMIN_PASSWORD === 'СМЕНИТЕ-ПАРОЛЬ') console.warn('Задайте пароль админки в CONFIG.ADMIN_PASSWORD');
  if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID) {
    tg_('sendMessage', { chat_id: CONFIG.TELEGRAM_CHAT_ID, text: '✅ ' + CONFIG.BRAND + ': уведомления о заказах подключены.' });
    console.log('Тестовое сообщение отправлено в Telegram.');
  } else {
    console.warn('Telegram ещё не настроен: заполните TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (или запустите findTelegramChatId).');
  }
}

/** Напишите боту любое сообщение (или добавьте его в группу и напишите там), затем запустите эту функцию. */
function findTelegramChatId() {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) throw new Error('Сначала вставьте TELEGRAM_BOT_TOKEN в CONFIG.');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/getUpdates', { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  if (!data.ok) throw new Error('Telegram ответил: ' + (data.description || 'ошибка') + '. Проверьте TELEGRAM_BOT_TOKEN.');
  var seen = {};
  (Array.isArray(data.result) ? data.result : []).forEach(function (u) {
    var m = u.message || u.channel_post || u.my_chat_member || {};
    var c = m.chat;
    if (c && !seen[c.id]) {
      seen[c.id] = true;
      console.log('ID чата: ' + c.id + '  (' + (c.title || [c.first_name, c.last_name].filter(String).join(' ') || c.username || c.type) + ')');
    }
  });
  if (!Object.keys(seen).length) console.log('Сообщений не найдено. Напишите боту /start и запустите функцию ещё раз.');
}

/* ======================== Утилиты ======================== */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(message, code) {
  var e = new Error(message);
  e.userMessage = message;
  e.code = code || 'error';
  throw e;
}

function str_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max || 200);
}

/** Текст, начинающийся с = + - @, таблица считает формулой — экранируем апострофом. */
function cell_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function clampInt_(v, min, max) {
  var n = Math.round(Number(v) || min);
  return Math.max(min, Math.min(max, n));
}

function h_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cut_(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatMoney_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + CONFIG.CURRENCY;
}
