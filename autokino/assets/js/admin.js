/* АВТОКИНО — админка: заявки, файлы, статусы */
(function () {
  'use strict';

  var AK = window.AK;
  var CFG = AK.CFG;
  var esc = AK.esc;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var PASS_KEY = 'autokino-admin';
  var DEFAULT_STATUSES = ['Новый', 'Ожидает проверки оплаты', 'Оплачен', 'В работе', 'Готов', 'Отправлен клиенту'];
  var CAR_LABELS = { car_front: 'Спереди', car_back: 'Сзади', car_left: 'Слева', car_right: 'Справа' };

  var state = {
    password: null, orders: [], statuses: DEFAULT_STATUSES, filter: 'all', q: '',
    current: null, cache: {}, loading: false, loadedAt: 0,
  };

  function api(action, data, opts) {
    return AK.api(action, Object.assign({ password: state.password }, data || {}), opts);
  }

  /* ---------- Вход ---------- */
  function showLogin(msg) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginError').textContent = msg || '';
    setTimeout(function () { $('#password').focus(); }, 30);
  }
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
  }
  function isAuthError(e) { return e && (e.code === 'auth' || e.code === 'locked'); }

  function initLogin() {
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = $('#password').value;
      if (!pw) { $('#loginError').textContent = 'Введите пароль'; return; }
      var btn = $('#loginBtn');
      btn.disabled = true;
      btn.textContent = 'Проверяем…';
      state.password = pw;
      api('login').then(function (res) {
        if (res.statuses) state.statuses = res.statuses;
        AK.storage.set(PASS_KEY, pw, sessionStorageSafe());
        $('#password').value = '';
        showApp();
        load();
      }, function (err) {
        state.password = null;
        $('#loginError').textContent = err.message;
      }).then(function () {
        btn.disabled = false;
        btn.textContent = 'Войти';
      });
    });
    $('#logoutBtn').addEventListener('click', function () {
      AK.storage.remove(PASS_KEY, sessionStorageSafe());
      state.password = null;
      state.orders = [];
      state.cache = {};
      $('#list').innerHTML = '';
      showLogin('');
    });
  }
  function sessionStorageSafe() { try { return window.sessionStorage; } catch (e) { return undefined; } }

  /* ---------- Загрузка ---------- */
  function load(silent) {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    var btn = $('#refreshBtn');
    btn.classList.add('is-spinning');
    if (!silent && !state.orders.length) $('#list').innerHTML = '<div class="a-empty">Загружаем заказы…</div>';
    return api('listOrders', {}, { timeout: 60000 }).then(function (res) {
      state.orders = res.orders || [];
      if (res.statuses) state.statuses = res.statuses;
      state.loadedAt = Date.now();
      if (res.sheetUrl) { $('#sheetLink').href = res.sheetUrl; $('#sheetLink').hidden = false; }
      if (res.folderUrl) { $('#folderLink').href = res.folderUrl; $('#folderLink').hidden = false; }
      $('#updated').textContent = 'Обновлено в ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      render();
      if (state.current) {
        var fresh = findOrder(state.current.id);
        if (fresh) state.current = fresh;
      }
    }, function (err) {
      if (isAuthError(err)) { showLogin(err.message); return; }
      if (!state.orders.length) $('#list').innerHTML = '<div class="a-empty"><b>Не удалось загрузить</b>' + esc(err.message) + '</div>';
      else AK.toast(err.message, 4000);
    }).then(function () {
      state.loading = false;
      btn.classList.remove('is-spinning');
    });
  }

  function findOrder(id) {
    for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === id) return state.orders[i];
    return null;
  }

  /* ---------- Список ---------- */
  function fmtDate(iso, long) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var opts = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    if (long || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleString('ru-RU', opts);
  }

  function matches(o, q) {
    if (!q) return true;
    var hay = [o.id, o.name, o.phone, AK.digits(o.phone), o.instagram, o.brand, o.model, o.color, o.year].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1 || (AK.digits(w) && AK.digits(o.phone).indexOf(AK.digits(w)) !== -1); });
  }

  function render() {
    var counts = { all: state.orders.length };
    state.statuses.forEach(function (s) { counts[s] = 0; });
    state.orders.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });
    var keys = ['all'].concat(state.statuses);
    $('#filters').innerHTML = keys.map(function (k) {
      var label = k === 'all' ? 'Все' : k;
      return '<button type="button" class="a-filter" data-f="' + esc(k) + '" aria-pressed="' + (state.filter === k) + '">' +
        (k === 'all' ? '' : '<span class="status" data-s="' + esc(k) + '"></span>') + esc(label) + ' <b>' + (counts[k] || 0) + '</b></button>';
    }).join('');

    var list = state.orders.filter(function (o) {
      return (state.filter === 'all' || o.status === state.filter) && matches(o, state.q.trim());
    });
    var box = $('#list');
    if (!state.orders.length) {
      box.innerHTML = '<div class="a-empty"><b>Заказов пока нет</b>Как только клиент отправит заявку, она появится здесь и придёт в Telegram.</div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="a-empty"><b>Ничего не найдено</b>Измените фильтр или строку поиска.</div>';
      return;
    }
    box.innerHTML = list.map(function (o) {
      return '<button type="button" class="o-row' + (o.status === state.statuses[0] ? ' is-new' : '') + '" data-id="' + esc(o.id) + '">' +
        '<span class="o-id">' + esc(o.id) + '</span>' +
        '<span class="o-date">' + esc(fmtDate(o.createdAt)) + '</span>' +
        '<span class="o-who">' + esc(o.name) + '<span class="o-phone">' + esc(o.phone) + '</span></span>' +
        '<span class="o-car">' + esc([o.brand + ' ' + o.model, o.year, o.color].filter(Boolean).join(', ')) + '</span>' +
        '<span class="status" data-s="' + esc(o.status) + '">' + esc(o.status) + '</span>' +
        '<span class="o-sum">' + esc(AK.money(o.amount)) + '</span>' +
      '</button>';
    }).join('');
  }

  function initList() {
    $('#filters').addEventListener('click', function (e) {
      var b = e.target.closest('.a-filter');
      if (!b) return;
      state.filter = b.dataset.f;
      render();
    });
    var t;
    $('#search').addEventListener('input', function (e) {
      clearTimeout(t);
      t = setTimeout(function () { state.q = e.target.value; render(); }, 120);
    });
    $('#list').addEventListener('click', function (e) {
      var row = e.target.closest('.o-row');
      if (row) openOrder(row.dataset.id);
    });
    $('#refreshBtn').addEventListener('click', function () { load(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.password && Date.now() - state.loadedAt > 60000) load(true);
    });
    setInterval(function () {
      if (document.visibilityState === 'visible' && state.password && !$('#drawer').open) load(true);
    }, 120000);
  }

  /* ---------- Карточка заказа ---------- */
  function openOrder(id) {
    var o = findOrder(id);
    if (!o) return;
    state.current = o;
    renderDrawer();
    var d = $('#drawer');
    if (!d.open) d.showModal();
    loadThumbs(o);
  }

  function fileTile(o, f, opts) {
    opts = opts || {};
    var cls = 'd-file' + (opts.tall ? ' is-tall' : '') + (f.kind === 'receipt' ? ' is-receipt' : '');
    return '<figure class="' + cls + '"><button type="button" data-file="' + esc(f.id) + '" aria-label="Открыть: ' + esc(opts.label || f.label) + '"><span class="spin" aria-hidden="true"></span></button>' +
      '<figcaption>' + esc(opts.label || f.label) + '</figcaption></figure>';
  }

  function renderDrawer() {
    var o = state.current;
    $('#dTitle').textContent = o.id;
    $('#dSub').textContent = 'Создан ' + fmtDate(o.createdAt, true) + (o.updatedAt && o.updatedAt !== o.createdAt ? '. Изменён ' + fmtDate(o.updatedAt, true) : '');
    var cars = ['car_front', 'car_back', 'car_left', 'car_right'].map(function (k) {
      return o.files.filter(function (f) { return f.kind === k; })[0];
    }).filter(Boolean);
    var people = o.files.filter(function (f) { return f.kind === 'person'; });
    var receipt = o.files.filter(function (f) { return f.kind === 'receipt'; })[0];
    var wa = AK.waLink(o.phone, 'Здравствуйте, ' + o.name + '! Это ' + (CFG.brand || 'АВТОКИНО') + ', пишем по вашему заказу ' + o.id + '.');
    var ig = AK.igLink(o.instagram);
    var texts = '';
    if (o.moods) texts += '<p class="d-text"><b>Атмосфера:</b> ' + esc(o.moods) + '</p>';
    if (o.story) texts += '<p class="d-text"><b>Сюжет:</b> ' + esc(o.story) + '</p>';
    if (o.wishes) texts += '<p class="d-text"><b>Пожелания:</b> ' + esc(o.wishes) + '</p>';
    if (!texts) texts = '<p class="d-text">Клиент не оставил пожеланий — сюжет на ваш выбор.</p>';

    $('#dBody').innerHTML =
      '<section class="d-sec"><h3>Статус</h3><div class="d-status">' +
        '<div class="d-flow" role="group" aria-label="Статус заказа">' + state.statuses.map(function (s) {
          return '<button type="button" data-status="' + esc(s) + '" aria-pressed="' + (s === o.status) + '"><span class="status" data-s="' + esc(s) + '">' + esc(s) + '</span></button>';
        }).join('') + '</div></div></section>' +

      '<section class="d-sec"><h3>Клиент</h3><dl class="d-list">' +
        '<dt>Имя</dt><dd>' + esc(o.name) + '</dd>' +
        '<dt>Телефон</dt><dd><a href="tel:' + esc(AK.digits(o.phone) ? '+' + AK.digits(o.phone) : '') + '">' + esc(o.phone) + '</a></dd>' +
        (o.instagram ? '<dt>Instagram</dt><dd><a href="' + esc(ig) + '" target="_blank" rel="noopener">' + esc(o.instagram) + '</a></dd>' : '') +
      '</dl>' +
      (wa ? '<div class="d-actions"><a class="btn btn-red btn-sm" href="' + esc(wa) + '" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#i-chat"/></svg><span>Написать в WhatsApp</span></a></div>' : '') +
      '</section>' +

      '<section class="d-sec"><h3>Автомобиль</h3><dl class="d-list">' +
        '<dt>Машина</dt><dd>' + esc(o.brand + ' ' + o.model) + '</dd>' +
        '<dt>Год</dt><dd>' + esc(o.year) + '</dd>' +
        '<dt>Цвет</dt><dd>' + esc(o.color) + '</dd>' +
      '</dl></section>' +

      '<section class="d-sec"><h3>Видео и оплата</h3><dl class="d-list">' +
        '<dt>Роликов</dt><dd>' + esc(o.quantity) + '</dd>' +
        '<dt>Сумма</dt><dd>' + esc(AK.money(o.amount)) + '</dd>' +
      '</dl><div style="margin-top:14px">' + texts + '</div></section>' +

      '<section class="d-sec"><h3>Фото автомобиля</h3><div class="d-files">' +
        cars.map(function (f) { return fileTile(o, f, { label: CAR_LABELS[f.kind] }); }).join('') + '</div></section>' +

      '<section class="d-sec"><h3>Фото клиента</h3><div class="d-files">' +
        people.map(function (f, i) { return fileTile(o, f, { tall: true, label: 'Фото ' + (i + 1) }); }).join('') + '</div></section>' +

      (receipt ? '<section class="d-sec"><h3>Чек об оплате</h3><div class="d-files">' + fileTile(o, receipt, { tall: true, label: receipt.mime === 'application/pdf' ? 'PDF' : 'Изображение' }) + '</div></section>' : '') +

      '<section class="d-sec d-note"><h3><label for="dNote" style="all:inherit">Заметка для себя</label></h3>' +
        '<textarea id="dNote" rows="3" maxlength="3000" placeholder="Например: оплата пришла, ролик в работе у монтажёра">' + esc(o.note) + '</textarea>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="dNoteSave">Сохранить заметку</button></section>' +

      '<section class="d-sec d-meta">' +
        '<p>Уведомление в Telegram: ' + esc(o.telegram || '—') + '</p>' +
        (o.folderUrl ? '<p style="margin-top:6px"><a href="' + esc(o.folderUrl) + '" target="_blank" rel="noopener">Открыть папку заказа в Google Drive</a></p>' : '') +
      '</section>';
  }

  function setOrder(updated) {
    for (var i = 0; i < state.orders.length; i++) {
      if (state.orders[i].id === updated.id) { state.orders[i] = updated; break; }
    }
    if (state.current && state.current.id === updated.id) state.current = updated;
  }

  function initDrawer() {
    var d = $('#drawer');
    $$('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { d.close(); }); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.addEventListener('close', function () { state.current = null; });
    $('#dBody').addEventListener('click', function (e) {
      var sBtn = e.target.closest('[data-status]');
      if (sBtn) { changeStatus(sBtn.dataset.status); return; }
      var fBtn = e.target.closest('[data-file]');
      if (fBtn) { openFile(fBtn.dataset.file); return; }
      if (e.target.closest('#dNoteSave')) saveNote();
    });
  }

  function changeStatus(status) {
    var o = state.current;
    if (!o || o.status === status) return;
    var prev = o.status;
    $$('#dBody [data-status]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.status === status)); });
    api('updateOrder', { orderId: o.id, status: status }).then(function (res) {
      setOrder(res.order);
      render();
      AK.toast(o.id + ': ' + status);
    }, function (err) {
      if (isAuthError(err)) { $('#drawer').close(); showLogin(err.message); return; }
      $$('#dBody [data-status]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.status === prev)); });
      AK.toast('Статус не сохранён: ' + err.message, 4000);
    });
  }

  function saveNote() {
    var o = state.current;
    var btn = $('#dNoteSave');
    btn.disabled = true;
    btn.textContent = 'Сохраняем…';
    api('updateOrder', { orderId: o.id, note: $('#dNote').value }).then(function (res) {
      setOrder(res.order);
      AK.toast('Заметка сохранена');
    }, function (err) {
      AK.toast('Заметка не сохранена: ' + err.message, 4000);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Сохранить заметку';
    });
  }

  /* ---------- Файлы ---------- */
  function getFile(orderId, fileId, size) {
    var key = fileId + ':' + size;
    if (!state.cache[key]) {
      state.cache[key] = api('getFile', { orderId: orderId, fileId: fileId, size: size }, { timeout: 90000 }).catch(function (err) {
        delete state.cache[key];
        throw err;
      });
    }
    return state.cache[key];
  }

  function loadThumbs(o) {
    var queue = o.files.slice();
    var running = 0;
    function next() {
      while (running < 4 && queue.length) {
        (function (f) {
          running++;
          getFile(o.id, f.id, 'thumb').then(function (res) {
            var btn = $('#dBody [data-file="' + f.id + '"]');
            if (!btn) return;
            if (/^image\//.test(res.mime)) btn.innerHTML = '<img alt="" src="data:' + res.mime + ';base64,' + res.data + '">';
            else btn.innerHTML = '<svg aria-hidden="true"><use href="#i-doc"/></svg>';
          }, function () {
            var btn = $('#dBody [data-file="' + f.id + '"]');
            if (btn) btn.innerHTML = '<svg aria-hidden="true"><use href="#i-doc"/></svg>';
          }).then(function () { running--; next(); });
        })(queue.shift());
      }
    }
    next();
  }

  var lbUrl = null;
  function openFile(fileId) {
    var o = state.current;
    var meta = o.files.filter(function (f) { return f.id === fileId; })[0];
    if (!meta) return;
    var lb = $('#lightbox');
    var stage = $('#lbStage');
    $('#lbName').textContent = o.id + ' · ' + meta.label;
    stage.innerHTML = '<span class="spin" aria-hidden="true"></span>';
    $('#lbDownload').hidden = true;
    lb.showModal();
    getFile(o.id, fileId, 'full').then(function (res) {
      if (!lb.open) return;
      var bin = atob(res.data);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      if (lbUrl) URL.revokeObjectURL(lbUrl);
      lbUrl = URL.createObjectURL(new Blob([arr], { type: res.mime }));
      if (/^image\//.test(res.mime)) stage.innerHTML = '<img alt="' + esc(meta.label) + '" src="' + lbUrl + '">';
      else stage.innerHTML = '<iframe title="' + esc(meta.label) + '" src="' + lbUrl + '"></iframe>';
      var dl = $('#lbDownload');
      dl.href = lbUrl;
      dl.download = res.name || meta.name;
      dl.hidden = false;
    }, function (err) {
      stage.innerHTML = '<p class="a-empty">' + esc(err.message) + '</p>';
    });
  }

  function initLightbox() {
    var lb = $('#lightbox');
    $$('[data-close]', lb).forEach(function (b) { b.addEventListener('click', function () { lb.close(); }); });
    lb.addEventListener('close', function () { $('#lbStage').innerHTML = ''; });
  }

  /* ---------- Старт ---------- */
  function init() {
    $$('[data-cfg]').forEach(function (el) { var v = AK.get(el.dataset.cfg); if (v) el.textContent = v; });
    initLogin();
    initList();
    initDrawer();
    initLightbox();
    if (!CFG.apiUrl) {
      showLogin('Сервер не подключён: укажите apiUrl в файле config.js (см. README).');
      $('#loginBtn').disabled = true;
      return;
    }
    var saved = AK.storage.get(PASS_KEY, sessionStorageSafe());
    if (saved) {
      state.password = saved;
      showApp();
      load();
    } else {
      showLogin('');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
