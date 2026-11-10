/* Общие функции сайта */
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

  var toastTimer;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, ms || 2600);
  }

  window.AK = { CFG: CFG, get: get, digits: digits, money: money, waNumber: waNumber, waLink: waLink, igLink: igLink, esc: esc, toast: toast };
})();
