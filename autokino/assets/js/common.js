/* Общие функции для сайта и админки */
(function () {
  'use strict';

  var CFG = window.AUTOKINO_CONFIG || {};

  function get(path, obj) {
    return String(path).split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj || CFG);
  }

  function digits(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

  function money(n, currency) {
    var num = Math.round(Number(n) || 0);
    var s = String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return s + ' ' + (currency || CFG.currency || '₸');
  }

  /* Маска номера: +7 701 555 72 24. Номера других стран (+996, +998…) не трогаем. */
  function maskPhone(value) {
    var t = String(value == null ? '' : value).trim();
    if (/^\+[0-689]/.test(t)) return '+' + digits(t).slice(0, 15);
    var d = digits(t);
    if (!d) return '';
    if (d.length > 11 && (d.slice(0, 2) === '77' || d.slice(0, 2) === '78')) d = '7' + d.slice(2);
    if (d.charAt(0) === '8') d = '7' + d.slice(1);
    if (d.charAt(0) !== '7') d = '7' + d;
    d = d.slice(0, 11);
    var out = '+7';
    if (d.length > 1) out += ' ' + d.slice(1, 4);
    if (d.length > 4) out += ' ' + d.slice(4, 7);
    if (d.length > 7) out += ' ' + d.slice(7, 9);
    if (d.length > 9) out += ' ' + d.slice(9, 11);
    return out;
  }

  function phoneValid(value) {
    var t = String(value || '').trim();
    var d = digits(t);
    if (/^\+[0-689]/.test(t)) return d.length >= 10 && d.length <= 15;
    return d.length === 11 && d.charAt(0) === '7' && /[3-9]/.test(d.charAt(1));
  }

  function waNumber(phone) {
    var d = digits(phone);
    if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    return d;
  }

  function waLink(phone, text) {
    var n = waNumber(phone);
    if (!n) return '';
    return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  function igLink(nick) {
    nick = String(nick || '').trim().replace(/^@+/, '');
    return nick ? 'https://instagram.com/' + encodeURIComponent(nick) : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' КБ';
    return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  }

  function apiError(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /*
   * Запрос к серверу (Google Apps Script).
   * Тело отправляется как text/plain — так браузер не делает предварительный
   * CORS-запрос, который Apps Script не поддерживает.
   */
  function api(action, data, opts) {
    opts = opts || {};
    var url = CFG.apiUrl;
    if (!url) {
      return Promise.reject(apiError('Приём заявок ещё не подключён: в файле config.js не указан адрес сервера (apiUrl). Напишите нам в WhatsApp — оформим заказ вручную.', 'no_api'));
    }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 60000) : null;
    var body = JSON.stringify(Object.assign({ action: action }, data || {}));
    return fetch(url, { method: 'POST', body: body, redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
      .catch(function (e) {
        if (e && e.name === 'AbortError') throw apiError('Сервер слишком долго не отвечает. Проверьте интернет и попробуйте ещё раз.', 'timeout');
        throw apiError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.', 'network');
      })
      .then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) { /* not json */ }
          if (!json) throw apiError('Сервер ответил неожиданно (код ' + res.status + '). Попробуйте ещё раз через минуту.', 'bad_response');
          if (json.ok !== true) throw apiError(json.error || 'Сервер вернул ошибку.', json.code || 'server');
          return json;
        });
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  var storage = {
    get: function (k, store) { try { return JSON.parse((store || localStorage).getItem(k)); } catch (e) { return null; } },
    set: function (k, v, store) { try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    remove: function (k, store) { try { (store || localStorage).removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  var toastTimer;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, ms || 2600);
  }

  window.AK = {
    CFG: CFG, get: get, digits: digits, money: money, maskPhone: maskPhone, phoneValid: phoneValid,
    waLink: waLink, igLink: igLink, esc: esc, fmtBytes: fmtBytes, api: api, storage: storage, toast: toast,
  };
})();
