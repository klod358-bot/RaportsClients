'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || r.statusText); e.status = r.status;
    if (r.status === 402) { if (typeof refreshTrial === 'function') refreshTrial(); if (typeof refreshLicense === 'function') refreshLicense(); }
    throw e;
  }
  return j;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const amt = v => fmt(v, Math.abs(v) < 1 ? 3 : 2);
const canLabel = c => String(c || '').replace(/\s*l$/i, ' л').replace(/\s*kg$/i, ' кг').replace('.', ',');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* нет хранилища */ } },
};
function isLight(hex) {
  if (!hex) return true;
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 5000 : 2600);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const state = {
  catalog: null, settings: {}, currency: '', product: null, colour: null,
  canBySize: {}, canId: 0, qty: 1, strength: 100, calc: null, cards: {},
};
const money = v => fmt(Math.round(v || 0), 0) + (state.currency ? ' ' + state.currency : '');

/* ================= навигация ================= */
function showView(name) {
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'history') loadHistory();
  if (name === 'stats') loadStats();
  if (name === 'refs') renderRefs();
  if (name === 'settings') loadSettingsForm();
  if (name === 'dispenser') loadDispenser();
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showView(b.dataset.view); });

/* ================= запуск ================= */
async function init() {
  state.settings = await api('/api/settings');
  const st = await api('/api/status');
  applyTrial(st.trial);
  applyLicense(st.license);
  if (st.trial && st.trial.demo) setInterval(refreshTrial, 60000);
  if (!st.has_db) {
    $('#welcome').hidden = false;
    $('#dbBadge').textContent = 'База рецептур не загружена';
    if (st.installer_hint) $('#importPath2').value = st.installer_hint;
    if (st.import && st.import.running) pollImport();
    return;
  }
  await loadCatalog();
}

async function loadCatalog() {
  const c = await api('/api/catalog');
  state.catalog = c;
  state.currency = c.currency || '';
  state.cards = Object.fromEntries(c.cards.map(k => [k.id, k]));
  const m = c.meta || {};
  $('#dbBadge').textContent = `База: ${m.database || m.system || '—'} · ${fmt(c.colour_count, 0)} цветов · ${c.products.length} продуктов`;
  $('#cardSelect').innerHTML = '<option value="0">Все вееры</option>' +
    c.cards.map(k => `<option value="${k.id}">${esc(k.name)} (${k.count})</option>`).join('');
  const last = +store.get('product');
  state.product = c.products.find(p => p.id === last) || null;
  renderProducts();
  searchColours();
  refreshDispenser();
  $('#welcome').hidden = true;
}

/* ================= лицензия ================= */
function applyLicense(l) {
  const card = $('#licCard');
  if (!l || !l.required) { $('#licWall').hidden = true; card.hidden = true; state.license = null; return; }
  state.license = l;
  $('#licCode').textContent = l.install_code || '';
  $('#licCode2').textContent = l.install_code || '';
  $('#licContacts').textContent = l.contacts || '';
  // окно активации — пока лицензия не активна
  $('#licWall').hidden = !!l.valid;
  if (!l.valid) {
    $('#licTitle').textContent = l.expiry ? 'Подписка истекла' : 'Активация программы';
    $('#licReason').textContent = l.reason || '';
  }
  // карточка в настройках
  card.hidden = false;
  $('#licInfo').innerHTML = l.valid
    ? `<div><b>Активна</b><span>лицензия</span></div><div><b>${esc(l.expiry || '')}</b><span>действует до${l.days_left != null ? ' · ' + l.days_left + ' дн.' : ''}</span></div>${l.customer ? `<div><b>${esc(l.customer)}</b><span>клиент</span></div>` : ''}`
    : `<div><b>Не активна</b><span>${esc(l.reason || '')}</span></div>`;
}
async function refreshLicense() {
  try { const st = await api('/api/status'); applyLicense(st.license); } catch { /* */ }
}
async function activateLicense(key, msgEl) {
  key = (key || '').trim();
  if (!key) { if (msgEl) msgEl.textContent = 'Вставьте ключ.'; return; }
  try {
    const l = await post('/api/license/activate', { Key: key });
    applyLicense(l);
    toast('Лицензия активирована');
    if (l.valid && !state.catalog) loadCatalog();
  } catch (e) { if (msgEl) { msgEl.textContent = e.message; msgEl.className = 'lic-msg err'; } else toast(e.message, true); }
}
$('#licActivate').addEventListener('click', () => activateLicense($('#licKey').value, $('#licMsg')));
$('#licActivate2').addEventListener('click', () => activateLicense($('#licKey2').value, $('#licMsg2')));
$('#licCopy').addEventListener('click', () => {
  try { navigator.clipboard.writeText(state.license.install_code); toast('Код скопирован'); } catch { /* */ }
});

/* ================= демо-режим ================= */
function applyTrial(t) {
  const pill = $('#demoPill');
  if (!t || !t.demo) { pill.hidden = true; $('#blocker').hidden = true; state.demo = null; return; }
  state.demo = t;
  pill.hidden = false;
  const days = Math.ceil(t.remaining / 86400);
  const hours = Math.ceil(t.remaining / 3600);
  if (t.expired) {
    pill.textContent = 'Демо завершено';
    pill.className = 'demo-pill over';
  } else {
    pill.textContent = 'Демо · осталось ' + (t.remaining >= 86400 ? days + ' дн.' : hours + ' ч.');
    pill.className = 'demo-pill' + (t.remaining < 86400 ? ' soon' : '');
  }
  const bl = $('#blocker');
  if (t.expired) {
    $('#blockerContacts').textContent = t.contacts || '';
    $('#blockerCode').textContent = t.code ? 'Код установки: ' + t.code : '';
    bl.hidden = false;
  } else {
    bl.hidden = true;
  }
}
async function refreshTrial() {
  try { const st = await api('/api/status'); applyTrial(st.trial); } catch { /* сеть не нужна */ }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#blocker').hidden = true; $('#licWall').hidden = true; } });
$('#demoPill').addEventListener('click', () => {
  const t = state.demo; if (!t) return;
  if (t.expired) { $('#blocker').hidden = false; return; }
  const d = Math.floor(t.remaining / 86400), h = Math.floor((t.remaining % 86400) / 3600);
  toast(`Пробная версия. Осталось ${d} дн. ${h} ч. работы программы. Код установки: ${t.code}`);
});

/* ================= дозатор ================= */
async function refreshDispenser() {
  try { state.dispenser = await api('/api/dispenser'); } catch { state.dispenser = null; }
  updateDispenseButton();
}
function updateDispenseButton() {
  const d = state.dispenser, note = $('#dispenserNote'), bd = $('#btnDispense');
  if (!d || d.backend === 'none') {
    bd.hidden = true; note.textContent = 'Дозатор не подключён — дозируйте вручную по рецепту.';
    note.className = 'dispenser-note'; return;
  }
  const names = { sim: 'Симулятор дозатора', corob: 'Машина Corob (E4G/E5G)' };
  bd.hidden = false;
  bd.disabled = !state.calc || !!(state.calc && state.calc.no_tint);
  if (d.ready) { note.textContent = (names[d.backend] || d.backend) + ' готов' + (d.low_count ? ` · ${d.low_count} канистр на исходе` : ''); note.className = 'dispenser-note ok'; }
  else { note.textContent = d.status; note.className = 'dispenser-note warn'; }
}
async function testDispenser(addr, resultEl) {
  resultEl.textContent = 'Проверяю…'; resultEl.className = 'test-result';
  try {
    const r = await post('/api/dispenser/test', { addr: addr || '' });
    resultEl.textContent = r.message; resultEl.className = 'test-result ' + (r.ok ? 'ok' : 'err');
  } catch (e) { resultEl.textContent = e.message; resultEl.className = 'test-result err'; }
}
$('#btnTestDispenser').addEventListener('click', () => testDispenser($('#sCorobAddr').value.trim(), $('#dispTestResult')));
$('#btnTestDisp2').addEventListener('click', async () => { await testDispenser('', $('#dispTestResultPage')); loadDispenser(); });

// ---- Журнал обмена с машиной ----
async function loadLog() {
  const el = $('#logText');
  el.textContent = 'Загрузка…';
  try {
    const r = await fetch('/api/dispenser/log', { cache: 'no-store' });
    el.textContent = await r.text();
  } catch (e) { el.textContent = 'Не удалось прочитать журнал: ' + e.message; }
  el.scrollTop = el.scrollHeight;
}
$('#btnDispLog').addEventListener('click', () => { $('#logModal').hidden = false; loadLog(); });
$('#logRefresh').addEventListener('click', loadLog);
$('#logClose').addEventListener('click', () => { $('#logModal').hidden = true; });
$('#logClear').addEventListener('click', async () => {
  await post('/api/dispenser/log/clear', {}).catch(() => {});
  toast('Журнал очищен'); loadLog();
});
$('#logSave').addEventListener('click', () => { window.location.href = '/api/dispenser/log?download=1'; });
$('#logCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#logText').textContent); toast('Скопировано в буфер обмена'); }
  catch { toast('Не удалось скопировать — выделите текст вручную', true); }
});

let canistersDirty = false;
async function loadDispenser() {
  const d = state.dispenser = await api('/api/dispenser').catch(() => null);
  if (!d) return;
  const names = { sim: 'Симулятор (отладка без машины)', corob: 'Машина Corob (E4G/E5G)', none: 'Дозатор выключен' };
  $('#dispStatus').innerHTML = `<span class="dstat ${d.ready ? 'ok' : 'off'}">●</span> ${esc(names[d.backend] || d.backend)} — ${esc(d.status)}`;
  const cnts = (state.catalog ? state.catalog.colorants : []);
  const opt = sel => '<option value=""></option>' + cnts.map(c => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.code)}${c.descr ? ' — ' + esc(c.descr) : ''}</option>`).join('');
  const cans = d.canisters || [];
  const grid = $('#canisterGrid');
  if (!cans.length) {
    grid.innerHTML = `<div class="grid-note">Канистры не настроены. Нажмите «Заполнить канистры по пастам», затем поправьте расстановку под вашу машину.</div>`;
  } else {
    grid.innerHTML = cans.map(c => {
      const pct = c.max_level > 0 ? Math.max(0, Math.min(100, c.cur_level / c.max_level * 100)) : 0;
      const low = c.cnt_code && c.cur_level <= c.warn_level;
      return `<div class="can-card${c.enabled ? '' : ' off'}" data-pos="${c.position}">
        <div class="can-top"><span class="can-pos">${c.position}</span>
          <label class="can-en"><input type="checkbox" class="c-en" ${c.enabled ? 'checked' : ''}> вкл.</label></div>
        <div class="can-sw" style="background:${c.rgb || '#eee'}"></div>
        <select class="c-code">${opt(c.cnt_code)}</select>
        <div class="can-level"><div class="can-bar ${low ? 'low' : ''}"><span style="width:${pct}%"></span></div></div>
        <div class="can-nums">
          <label>есть<input type="number" class="c-cur" value="${c.cur_level}" min="0" step="10"></label>
          <label>макс<input type="number" class="c-max" value="${c.max_level}" min="0" step="100"></label>
          <label>порог<input type="number" class="c-warn" value="${c.warn_level}" min="0" step="10"></label>
        </div></div>`;
    }).join('');
  }
  canistersDirty = false; $('#btnSaveCanisters').hidden = true;
}
$('#canisterGrid').addEventListener('input', () => { canistersDirty = true; $('#btnSaveCanisters').hidden = false; });
$('#canisterGrid').addEventListener('change', e => {
  if (e.target.classList.contains('c-code')) {
    const c = cntByCode(e.target.value); const card = e.target.closest('.can-card');
    card.querySelector('.can-sw').style.background = (c && c.rgb) || '#eee';
  }
});
function cntByCode(code) { return (state.catalog ? state.catalog.colorants : []).find(c => c.code === code); }
$('#btnAutofill').addEventListener('click', async () => {
  try { await post('/api/dispenser/autofill', {}); toast('Канистры заполнены по пастам'); loadDispenser(); refreshDispenser(); }
  catch (e) { toast(e.message, true); }
});
$('#btnImportMachine').addEventListener('click', async () => {
  try { await post('/api/dispenser/import-machine', {}); toast('Канистры загружены с машины'); loadDispenser(); refreshDispenser(); }
  catch (e) { toast(e.message, true); }
});
$('#btnSaveCanisters').addEventListener('click', async () => {
  const list = $$('#canisterGrid .can-card').map(card => ({
    position: +card.dataset.pos,
    cnt_code: card.querySelector('.c-code').value,
    cur_level: +card.querySelector('.c-cur').value || 0,
    max_level: +card.querySelector('.c-max').value || 0,
    warn_level: +card.querySelector('.c-warn').value || 0,
    min_level: 0,
    enabled: card.querySelector('.c-en').checked,
  }));
  try { await post('/api/dispenser/canisters', list); toast('Расстановка сохранена'); loadDispenser(); refreshDispenser(); }
  catch (e) { toast(e.message, true); }
});
$('#maintainBar').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try { const j = await post('/api/dispenser/maintain', { kind: b.dataset.m, positions: [], minutes: 2 }); openDispModal(j, { maintain: b.textContent }); }
  catch (err) { toast(err.message, true); }
});

/* ---- отправка на дозатор + окно прогресса ---- */
$('#btnDispense').addEventListener('click', async () => {
  if (!state.calc) return;
  try {
    const cu = (state.custom && state.custom.on) ? { Custom: state.custom.amt, CUnit: state.custom.unit } : {};
    const j = await post('/api/dispenser/dispense', {
      Product: state.product.id, Colour: state.colour.id, Can: state.calc.can ? state.calc.can.id : 0,
      Qty: state.qty, Strength: state.strength, ...cu,
    });
    openDispModal(j);
  } catch (e) { toast(e.message, true); }
});
let dispPoll = null, dispJobId = null;
function openDispModal(job, opts) {
  opts = opts || {};
  dispJobId = job.id;
  const m = $('#dispModal'); m.hidden = false;
  $('#dispClose').hidden = true; $('#dispAbort').hidden = false;
  if (opts.maintain) {
    paintHero({ rgb: '#3a3c42', code: opts.maintain, name: 'Обслуживание дозатора' }, '', m);
  } else {
    paintHero({ rgb: job.rgb, code: job.colour_code, name: job.colour_name }, (job.product || '') + (job.base ? ' · база ' + job.base : ''), m);
  }
  renderDispJob(job);
  clearInterval(dispPoll);
  dispPoll = setInterval(pollDisp, 500);
}
function renderDispJob(j) {
  $('#dispBar').style.width = (j.progress || 0) + '%';
  $('#dispBar').className = j.status === 'error' ? 'err' : '';
  const stMap = { queued: 'В очереди…', running: j.message || 'Выполняется…', done: j.message || 'Готово', error: j.message || 'Ошибка', aborted: 'Прервано', paused: 'Пауза' };
  $('#dispMsg').textContent = stMap[j.status] || j.status;
  const tb = $('#dispTable');
  if (j.kind === 'dispense' && j.items) {
    tb.hidden = false;
    tb.tBodies[0].innerHTML = j.items.map(it => `<tr${it.available === false ? ' class="miss"' : ''}>
      <td><span class="cnt"><i style="background:${it.rgb || '#fff'}"></i>${esc(it.code)}</span></td>
      <td>${it.position || '—'}</td><td class="num">${amt(it.actual_ml || 0)}</td><td class="num">${amt(it.target_ml)}</td></tr>`).join('');
  } else tb.hidden = true;
  const done = ['done', 'error', 'aborted'].includes(j.status);
  $('#dispAbort').hidden = done; $('#dispClose').hidden = !done;
}
async function pollDisp() {
  if (dispJobId == null) return;
  try {
    const j = await api('/api/dispenser/job/' + dispJobId);
    renderDispJob(j);
    if (['done', 'error', 'aborted'].includes(j.status)) { clearInterval(dispPoll); dispPoll = null; }
  } catch { clearInterval(dispPoll); dispPoll = null; }
}
$('#dispAbort').addEventListener('click', async () => {
  if (dispJobId != null) { try { await post('/api/dispenser/job/' + dispJobId + '/abort', {}); } catch (e) { toast(e.message, true); } }
});
$('#dispClose').addEventListener('click', () => {
  $('#dispModal').hidden = true; clearInterval(dispPoll); dispPoll = null; dispJobId = null;
  refreshDispenser();
});

/* ================= продукты ================= */
function renderProducts() {
  const q = $('#productSearch').value.trim().toLowerCase();
  const list = state.catalog.products.filter(p => !q || p.name.toLowerCase().includes(q));
  let html = '', group = null;
  for (const p of list) {
    const g = p.group || 'Прочие';
    if (g !== group) { html += `<div class="pgroup">${esc(g)}</div>`; group = g; }
    const bases = (p.bases || []).map(b => b.code).join(' · ');
    html += `<button class="pitem${state.product && state.product.id === p.id ? ' active' : ''}" data-id="${p.id}">
      <span>${esc(p.name)}</span><span class="bases">${esc(bases)}</span></button>`;
  }
  $('#productList').innerHTML = html || '<div class="grid-note">Ничего не найдено</div>';
}
$('#productSearch').addEventListener('input', renderProducts);
$('#productList').addEventListener('click', e => {
  const b = e.target.closest('.pitem'); if (!b) return;
  state.product = state.catalog.products.find(p => p.id === +b.dataset.id);
  store.set('product', state.product.id);
  renderProducts();
  searchColours();
  recalc();
});

/* ================= цвета ================= */
let searchSeq = 0;
async function searchColours() {
  if (!state.catalog) return;
  const q = $('#colourSearch').value.trim();
  const card = $('#cardSelect').value;
  const params = new URLSearchParams({ q, card, limit: 240 });
  if (state.product) params.set('product', state.product.id);
  const seq = ++searchSeq;
  let res;
  try { res = await api('/api/colours?' + params); } catch (e) { toast(e.message, true); return; }
  if (seq !== searchSeq) return;
  const items = res.items || [];
  state.lastColours = items;
  const hex = res.mode === 'hex';
  $('#colourCount').textContent = hex ? `Ближайшие к ${q.toUpperCase()}` :
    res.total > items.length ? `Найдено ${fmt(res.total, 0)}, показаны первые ${items.length}` : `Найдено ${fmt(res.total, 0)}`;
  if (!items.length) {
    $('#colourGrid').innerHTML = `<div class="grid-note">${state.product ? `Для «${esc(state.product.name)}» таких цветов нет` : 'Ничего не найдено'}</div>`;
    return;
  }
  $('#colourGrid').innerHTML = items.map(c => {
    const card = c.cards && c.cards.length ? (state.cards[c.cards[0]] || {}).name || '' : '';
    const sub = hex ? `ΔE ${fmt(c.de, 1)} · ${card}` : (c.name || card);
    return `<button class="tile${state.colour && state.colour.id === c.id ? ' active' : ''}" data-id="${c.id}" title="${esc(c.code + (c.name ? ' — ' + c.name : '') + (card ? '\n' + card : ''))}">
      <span class="sw" style="background:${c.rgb || '#fff'}"></span>
      <span class="tc"><span class="code">${esc(c.code)}</span><span class="sub">${esc(sub)}</span></span></button>`;
  }).join('');
}
const searchColoursSoon = debounce(searchColours, 180);
$('#colourSearch').addEventListener('input', searchColoursSoon);
$('#colourSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter' && state.lastColours && state.lastColours.length) selectColour(state.lastColours[0]);
});
$('#cardSelect').addEventListener('change', searchColours);
$('#colourGrid').addEventListener('click', e => {
  const t = e.target.closest('.tile'); if (!t) return;
  selectColour(state.lastColours.find(c => c.id === +t.dataset.id));
});
function selectColour(c) {
  state.colour = c;
  const sc = $('.recipe-scroll'); if (sc) sc.scrollTop = 0;
  $$('#colourGrid .tile').forEach(t => t.classList.toggle('active', +t.dataset.id === c.id));
  recalc();
}

/* ================= рецепт ================= */
async function recalc() {
  if (!state.colour) return;
  $('#recipeEmpty').hidden = true;
  $('#recipeBody').hidden = false;
  paintHero(state.colour, cardsOf(state.colour));
  if (!state.product) {
    showRecipeMessage('Выберите продукт слева — рецепт зависит от продукта и базы.', true);
    return;
  }
  const canId = state.canBySize[state.product.id] || 0;
  const params = new URLSearchParams({ product: state.product.id, colour: state.colour.id, can: canId, qty: state.qty, strength: state.strength });
  if (state.custom && state.custom.on && state.custom.amt > 0) { params.set('custom', state.custom.amt); params.set('cunit', state.custom.unit); }
  try {
    state.calc = await api('/api/calc?' + params);
  } catch (e) {
    state.calc = null;
    showRecipeMessage(e.status === 404 ? `Для продукта «${state.product.name}» нет рецептуры цвета ${state.colour.code}.` : e.message, false);
    return;
  }
  renderRecipe(state.calc);
}
function cardsOf(c) { return (c.cards || []).map(id => (state.cards[id] || {}).name).filter(Boolean); }
function paintHero(c, cards, el = document) {
  const hero = $('#hero', el) || el.querySelector('.hero');
  hero.style.background = c.rgb || '#ddd';
  hero.classList.toggle('light', isLight(c.rgb));
  hero.querySelector('.hero-code').textContent = c.code || c.colour_code;
  hero.querySelector('.hero-name').textContent = c.name || c.colour_name || '';
  hero.querySelector('.hero-cards').textContent = Array.isArray(cards) ? cards.join(' · ') : (cards || '');
}
function showRecipeMessage(msg, info) {
  $('#rpProduct').textContent = state.product ? state.product.name : '—';
  $('#rpBase').innerHTML = '';
  $('#canChips').innerHTML = '';
  const m = $('#rpMsg'); m.hidden = false; m.className = 'msg' + (info ? ' info' : ''); m.textContent = msg;
  $('#recipeTable').hidden = true; $('#fillBox').hidden = true; $('#moneyBox').hidden = true;
  $$('.rp-actions .btn').forEach(b => (b.disabled = true));
  updateDispenseButton();
}
function renderRecipe(r) {
  const unitG = (state.settings.unit || 'g') === 'g';
  const showCost = state.settings.show_cost !== '0';
  paintHero(r.colour, r.card_names);
  $('#rpProduct').textContent = r.product;
  $('#rpBase').innerHTML = `База <b>${esc(r.base.code)}</b>`;
  $('#rpBase').title = r.base.liquid || '';
  const customOn = !!(state.custom && state.custom.on);
  $('#canChips').innerHTML = (r.base.cans || []).map(c =>
    `<button class="chip${!customOn && r.can && c.id === r.can.id ? ' active' : ''}" data-id="${c.id}">${esc(canLabel(c.code))}</button>`).join('')
    + `<button class="chip${customOn ? ' active' : ''}" data-id="custom">Своя…</button>`;
  $('#customRow').hidden = !customOn;
  if (customOn) {
    if (document.activeElement !== $('#customAmt')) $('#customAmt').value = state.custom.amt || '';
    $('#customUnit').value = state.custom.unit || 'ml';
  }
  $('#qty').value = r.qty; $('#strength').value = r.strength;

  const msgs = [...(r.warnings || [])];
  if (r.no_tint) msgs.unshift('Цвет получается на чистой базе — паста не нужна.');
  if (r.strength !== 100) msgs.push(`Рецепт пересчитан на ${fmt(r.strength, 0)} % насыщенности.`);
  const m = $('#rpMsg');
  m.hidden = !msgs.length; m.className = 'msg' + ((r.warnings || []).length ? '' : ' info'); m.textContent = msgs.join(' ');

  const tbl = $('#recipeTable');
  tbl.hidden = r.no_tint;
  tbl.classList.toggle('hide-cost', !showCost);
  const head = tbl.tHead.rows[0];
  head.innerHTML = `<th>Паста</th>` + (unitG ? '<th class="num">г</th><th class="num">мл</th>' : '<th class="num">мл</th><th class="num">г</th>') + '<th class="num cost-col">Стоимость</th>';
  tbl.tBodies[0].innerHTML = r.items.map(it => {
    const g = `<td class="num${unitG ? ' main' : ''}">${amt(it.g)}</td>`, ml = `<td class="num${unitG ? '' : ' main'}">${amt(it.ml)}</td>`;
    return `<tr><td><span class="cnt"><i style="background:${it.rgb || '#fff'}"></i>${esc(it.code)}</span></td>${unitG ? g + ml : ml + g}<td class="num cost-col">${money(it.cost)}</td></tr>`;
  }).join('');
  const tg = `<td class="num">${amt(r.total_g)}</td>`, tm = `<td class="num">${amt(r.total_ml)}</td>`;
  tbl.tFoot.innerHTML = `<tr><td>Итого</td>${unitG ? tg + tm : tm + tg}<td class="num cost-col">${money(r.cost_cnt)}</td></tr>`;

  const fb = $('#fillBox'); fb.hidden = r.no_tint;
  const scale = Math.max(r.max_fill_pct || 11, r.fill_pct) * 1.15 || 1;
  const bar = $('#fillVal');
  bar.style.width = Math.min(100, r.fill_pct / scale * 100) + '%';
  bar.classList.toggle('over', r.max_fill_pct > 0 && r.fill_pct > r.max_fill_pct);
  $('#fillMax').style.left = r.max_fill_pct ? (r.max_fill_pct / scale * 100) + '%' : '-10px';
  const vol = r.can && r.can.gravimetric ? `${fmt(r.volume_l, 2)} л базы в таре` : '';
  $('#fillText').textContent = `Пасты ${fmt(r.fill_pct, 1)} % к объёму базы` + (r.max_fill_pct ? ` · допустимо до ${fmt(r.max_fill_pct, 0)} %` : '') + (vol ? ' · ' + vol : '');

  const mb = $('#moneyBox'); mb.hidden = !showCost;
  mb.innerHTML = `<span class="muted">Пасты</span><span>${money(r.cost_cnt)}</span>` +
    `<span class="muted">База ${esc(canLabel(r.can && r.can.code))} × ${r.qty}${r.cost_base ? '' : ' · <a data-go="prices">указать цену</a>'}</span><span>${r.cost_base ? money(r.cost_base) : '—'}</span>` +
    (r.markup ? `<span class="muted">Наценка</span><span>${fmt(r.markup, 1)} %</span>` : '') +
    `<span class="total">Итого</span><span class="total">${money(r.price)}</span>`;
  $$('.rp-actions .btn').forEach(b => (b.disabled = false));
  updateDispenseButton();
}
$('#canChips').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c || !state.product) return;
  if (c.dataset.id === 'custom') {
    state.custom = state.custom || { amt: 200, unit: 'ml' };
    state.custom.on = true;
    if (!state.custom.amt) state.custom.amt = 200;
  } else {
    if (state.custom) state.custom.on = false;
    state.canBySize[state.product.id] = +c.dataset.id;
  }
  recalc();
});
$('#customAmt').addEventListener('input', () => {
  state.custom = state.custom || { unit: 'ml' }; state.custom.on = true;
  state.custom.amt = +$('#customAmt').value || 0;
  if (state.custom.amt > 0) recalcSoon();
});
$('#customUnit').addEventListener('change', () => {
  state.custom = state.custom || { amt: 200 }; state.custom.on = true;
  state.custom.unit = $('#customUnit').value; recalc();
});
const recalcSoon = debounce(recalc, 350);
$('.stepper').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.qty = Math.max(1, (+$('#qty').value || 1) + +b.dataset.step);
  recalc();
});
$('#qty').addEventListener('change', () => { state.qty = Math.max(1, Math.round(+$('#qty').value || 1)); recalc(); });
$('#strength').addEventListener('change', () => { state.strength = Math.min(300, Math.max(1, +$('#strength').value || 100)); recalc(); });
$('#moneyBox').addEventListener('click', e => {
  if (e.target.dataset.go === 'prices') { refTab = 'prod'; refProduct = state.product && state.product.id; showView('refs'); }
});

async function saveOrder(print) {
  if (!state.calc) return;
  try {
    const cu = (state.custom && state.custom.on) ? { Custom: state.custom.amt, CUnit: state.custom.unit } : {};
    const { id } = await post('/api/orders', {
      Product: state.product.id, Colour: state.colour.id, Can: state.calc.can ? state.calc.can.id : 0,
      Qty: state.qty, Strength: state.strength, ...cu, Customer: $('#customer').value, Comment: $('#comment').value,
    });
    toast(`Записано: колеровка № ${id}`);
    $('#customer').value = ''; $('#comment').value = '';
    if (print) printLabel(await api('/api/orders/' + id));
  } catch (e) { toast(e.message, true); }
}
$('#btnSavePrint').addEventListener('click', () => saveOrder(true));
$('#btnSave').addEventListener('click', () => saveOrder(false));
$('#btnPrint').addEventListener('click', () => {
  const r = state.calc; if (!r) return;
  printLabel({
    id: null, created: new Date().toLocaleString('ru-RU'), product: r.product, base: r.base.code, colour_code: r.colour.code,
    colour_name: r.colour.name, card: (r.card_names || []).join(', '), rgb: r.colour.rgb, can: r.can ? r.can.code : '',
    qty: r.qty, strength: r.strength, items: r.items, total_ml: r.total_ml, total_g: r.total_g,
    customer: $('#customer').value, comment: $('#comment').value,
  });
});

/* ================= этикетка ================= */
function printLabel(o) {
  const s = state.settings;
  const w = s.label_width || '58';
  const page = w === 'a6' ? 'size: A6; margin: 8mm;' : `size: ${w}mm auto; margin: 2mm 3mm;`;
  const unitG = (s.unit || 'g') === 'g';
  const items = Array.isArray(o.items) ? o.items : [];
  const created = o.id ? String(o.created).replace(/^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d).*/, '$3.$2.$1 $4') : o.created;
  const rows = items.map(i => `<tr><td>${esc(i.code)}</td><td class="n">${amt(unitG ? i.g : i.ml)}</td><td class="n s">${amt(unitG ? i.ml : i.g)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Этикетка</title><style>
    @page { ${page} }
    body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; color: #000; font-size: ${w === '58' ? '10.5pt' : '11.5pt'}; }
    .shop { font-weight: 700; text-align: center; font-size: 1.05em; }
    .info { text-align: center; font-size: .8em; margin-bottom: 4px; }
    .sw { height: 9mm; border: 1px solid #000; margin: 4px 0; background: ${o.rgb || '#fff'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .code { font-size: 1.7em; font-weight: 800; text-align: center; line-height: 1.1; margin-top: 4px; }
    .name { text-align: center; font-size: .95em; }
    .card { text-align: center; font-size: .78em; }
    .kv { width: 100%; border-collapse: collapse; margin: 5px 0; font-size: .92em; }
    .kv td { padding: 1px 0; vertical-align: top; } .kv td:first-child { color: #333; width: 38%; }
    hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
    table.r { width: 100%; border-collapse: collapse; }
    table.r th { text-align: left; font-size: .78em; border-bottom: 1px solid #000; } table.r th.n { text-align: right; }
    table.r td { padding: 1px 0; } .n { text-align: right; font-variant-numeric: tabular-nums; } .s { font-size: .8em; color: #333; }
    .foot { font-size: .78em; margin-top: 5px; display: flex; justify-content: space-between; }
  </style></head><body>
    ${state.demo && state.demo.demo ? '<div style="text-align:center;font-size:.72em;color:#777;border:1px dashed #999;border-radius:3px;margin-bottom:3px">ДЕМО-ВЕРСИЯ</div>' : ''}
    ${s.shop_name ? `<div class="shop">${esc(s.shop_name)}</div>` : ''}
    ${s.shop_info ? `<div class="info">${esc(s.shop_info)}</div>` : ''}
    <div class="code">${esc(o.colour_code)}</div>
    ${o.colour_name ? `<div class="name">${esc(o.colour_name)}</div>` : ''}
    ${o.card ? `<div class="card">${esc(o.card)}</div>` : ''}
    <div class="sw"></div>
    <table class="kv">
      <tr><td>Продукт</td><td><b>${esc(o.product)}</b></td></tr>
      <tr><td>База</td><td><b>${esc(o.base)}</b></td></tr>
      <tr><td>Тара</td><td><b>${esc(canLabel(o.can))}</b>${o.qty > 1 ? ` × ${o.qty}` : ''}</td></tr>
      ${o.strength && o.strength !== 100 ? `<tr><td>Насыщ.</td><td>${fmt(o.strength, 0)} %</td></tr>` : ''}
      ${o.customer ? `<tr><td>Клиент</td><td>${esc(o.customer)}</td></tr>` : ''}
      ${o.comment ? `<tr><td>Прим.</td><td>${esc(o.comment)}</td></tr>` : ''}
    </table>
    ${items.length ? `<hr><table class="r"><tr><th>Паста</th><th class="n">${unitG ? 'г' : 'мл'}</th><th class="n">${unitG ? 'мл' : 'г'}</th></tr>${rows}</table>` : '<hr><div>Без пасты (чистая база)</div>'}
    <hr><div class="foot"><span>${esc(created)}</span><span>${o.id ? '№ ' + o.id : ''}</span></div>
  </body></html>`;
  const f = $('#printFrame');
  f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Не удалось открыть печать', true); } }, 50); };
  f.srcdoc = html;
}

/* ================= история ================= */
let historyRows = [];
async function loadHistory() {
  const p = new URLSearchParams({ from: $('#hFrom').value, to: $('#hTo').value, q: $('#hSearch').value.trim() });
  historyRows = await api('/api/orders?' + p).catch(e => (toast(e.message, true), []));
  $('#historyEmpty').hidden = historyRows.length > 0;
  $('#historyTable tbody').innerHTML = historyRows.map(o => `<tr data-id="${o.id}">
    <td class="muted">${o.id}</td><td>${esc(o.created.slice(0, 16).replace(/^(\d{4})-(\d\d)-(\d\d)/, '$3.$2.$1'))}</td>
    <td><span class="dot" style="background:${o.rgb || '#fff'}"></span>${esc(o.colour_code)}</td>
    <td>${esc(o.product)} <span class="muted">· ${esc(o.base)}</span></td>
    <td>${esc(canLabel(o.can))}${o.qty > 1 ? ' × ' + o.qty : ''}</td>
    <td class="num">${amt(o.total_ml)}</td><td class="num">${o.price ? money(o.price) : '—'}</td>
    <td>${esc(o.customer)}</td></tr>`).join('');
}
const loadHistorySoon = debounce(loadHistory, 250);
['#hFrom', '#hTo'].forEach(s => $(s).addEventListener('change', loadHistory));
$('#hSearch').addEventListener('input', loadHistorySoon);
$('#historyTable').addEventListener('click', async e => {
  const tr = e.target.closest('tbody tr'); if (!tr) return;
  $$('#historyTable tbody tr').forEach(r => r.classList.toggle('active', r === tr));
  const o = await api('/api/orders/' + tr.dataset.id);
  const box = $('#orderDetail');
  const items = Array.isArray(o.items) ? o.items : [];
  box.innerHTML = `<div class="hero"><div class="hero-code"></div><div class="hero-name"></div><div class="hero-cards"></div></div>
    <div class="od-body">
      <div class="kv"><span>№</span><span>${o.id} · ${esc(o.created.slice(0, 16))}</span>
      <span>Продукт</span><span>${esc(o.product)}, база ${esc(o.base)}</span>
      <span>Тара</span><span>${esc(canLabel(o.can))} × ${o.qty}${o.strength !== 100 ? ` · ${fmt(o.strength, 0)} %` : ''}</span>
      ${o.customer ? `<span>Клиент</span><span>${esc(o.customer)}</span>` : ''}${o.comment ? `<span>Комментарий</span><span>${esc(o.comment)}</span>` : ''}
      <span>Сумма</span><span>${o.price ? money(o.price) : '—'}</span></div>
      <table class="recipe-table"><thead><tr><th>Паста</th><th class="num">г</th><th class="num">мл</th></tr></thead><tbody>
      ${items.map(i => `<tr><td><span class="cnt"><i style="background:${i.rgb}"></i>${esc(i.code)}</span></td><td class="num">${amt(i.g)}</td><td class="num">${amt(i.ml)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Без пасты</td></tr>'}
      </tbody></table>
    </div>
    <div class="od-actions">
      <button class="btn primary" data-a="print">Печать этикетки</button>
      <button class="btn" data-a="repeat">Повторить колеровку</button>
      <button class="btn danger" data-a="del">Удалить запись</button>
    </div>`;
  paintHero({ rgb: o.rgb, code: o.colour_code, name: o.colour_name }, o.card, box);
  box.hidden = false; $('.history-grid').classList.add('with-detail');
  box.onclick = async ev => {
    const a = ev.target.closest('button'); if (!a) return;
    if (a.dataset.a === 'print') printLabel(o);
    if (a.dataset.a === 'repeat') repeatOrder(o);
    if (a.dataset.a === 'del') {
      if (!a.dataset.sure) { a.dataset.sure = 1; a.textContent = 'Точно удалить? Нажмите ещё раз'; return; }
      await api('/api/orders/' + o.id, { method: 'DELETE' });
      box.hidden = true; $('.history-grid').classList.remove('with-detail'); loadHistory(); toast('Запись удалена');
    }
  };
});
async function repeatOrder(o) {
  const p = state.catalog.products.find(x => x.id === o.product_id) || state.catalog.products.find(x => x.name === o.product);
  if (!p) { toast('Продукт из записи не найден в текущей базе', true); return; }
  state.product = p; store.set('product', p.id);
  const base = p.bases.find(b => b.code === o.base);
  const can = base && base.cans.find(c => c.code === o.can);
  if (can) state.canBySize[p.id] = can.id;
  state.qty = o.qty || 1; state.strength = o.strength || 100;
  $('#colourSearch').value = o.colour_code; $('#cardSelect').value = '0';
  showView('tint'); renderProducts();
  await searchColours();
  const c = (state.lastColours || []).find(x => x.id === o.colour_id) || (state.lastColours || []).find(x => x.code === o.colour_code);
  if (c) selectColour(c);
  $('#customer').value = o.customer || '';
}

/* ================= статистика ================= */
let statPeriod = 'month';
$('#statPeriod').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  statPeriod = b.dataset.p;
  $$('#statPeriod button').forEach(x => x.classList.toggle('active', x === b));
  loadStats();
});
function isoDate(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
async function loadStats() {
  const now = new Date(), from = new Date(now);
  const days = { today: 0, week: 6, month: 29, year: 364 }[statPeriod];
  const p = new URLSearchParams();
  if (days !== undefined) { from.setDate(now.getDate() - days); p.set('from', isoDate(from)); }
  const s = await api('/api/stats?' + p).catch(e => (toast(e.message, true), null));
  if (!s) return;
  const cur = s.currency ? ' ' + s.currency : '';
  $('#kpis').innerHTML = [
    [fmt(s.orders, 0), 'колеровок'], [fmt(s.cans, 0), 'тар'],
    [fmt(s.litres, 1) + ' л' + (s.kg ? ` + ${fmt(s.kg, 1)} кг` : ''), 'заколеровано'],
    [fmt(Math.round(s.revenue), 0) + cur, 'сумма по колеровкам'], [fmt(Math.round(s.cost_cnt), 0) + cur, 'стоимость пасты'],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const cntRGB = Object.fromEntries((state.catalog ? state.catalog.colorants : []).map(c => [c.code, c.rgb]));
  const bars = (rows, val, label, sw, right) => {
    if (!rows.length) return '<div class="muted">Нет данных за период</div>';
    const max = Math.max(...rows.map(val)) || 1;
    return '<div class="bars">' + rows.map(r => `<div class="bar-row"><span class="name">${sw ? `<span class="dot" style="background:${sw(r)}"></span>` : ''}${esc(label(r))}</span>
      <span class="bar-track"><span style="width:${val(r) / max * 100}%;${sw ? `background:${sw(r)}` : ''}"></span></span><span class="val">${right(r)}</span></div>`).join('') + '</div>';
  };
  $('#statCnt').innerHTML = bars(s.colorants, r => r.ml, r => r.key, r => cntRGB[r.key] || '#999', r => `${amt(r.ml)} мл · ${amt(r.g)} г`);
  $('#statColours').innerHTML = bars(s.colours, r => r.count, r => r.key, r => r.extra || '#999', r => `${r.count} раз`);
  $('#statProducts').innerHTML = bars(s.products, r => r.count, r => r.key, null, r => `${r.count} кол. · ${r.extra} тар`);
}

/* ================= справочники ================= */
let refTab = 'cnt', refProduct = null;
$('#refTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { refTab = b.dataset.t; renderRefs(); } });
async function renderRefs() {
  $$('#refTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === refTab));
  const body = $('#refBody');
  if (!state.catalog) { body.innerHTML = '<div class="card muted">Сначала загрузите базу рецептур.</div>'; return; }
  const cur = state.currency || '';
  if (refTab === 'cnt') {
    const cat = await api('/api/catalog');
    body.innerHTML = `<div class="card"><p class="muted">Цена пасты за 1 литр — используется для расчёта стоимости колеровки. Изначально подставлена цена из базы производителя; изменения сохраняются сразу.</p>
      <div class="table-wrap"><table class="data ref-table"><thead><tr><th>Паста</th><th>Описание</th><th class="num">Плотность, г/мл</th><th class="num">Цена за 1 л, ${esc(cur)}</th></tr></thead><tbody>
      ${cat.colorants.map(c => `<tr><td><span class="cnt"><i style="background:${c.rgb}"></i>${esc(c.code)}</span></td><td class="muted">${esc(c.descr)}</td>
        <td class="num">${fmt(c.sg, 3)}</td><td class="num"><input type="number" step="1" min="0" data-code="${esc(c.code)}" value="${c.price}"></td></tr>`).join('')}
      </tbody></table></div></div>`;
    body.querySelectorAll('input[data-code]').forEach(i => i.addEventListener('change', async () => {
      await post('/api/price/colorant', { code: i.dataset.code, price: +i.value || 0 }); toast('Цена пасты сохранена'); recalc();
    }));
  } else if (refTab === 'prod') {
    const prices = await api('/api/price/base');
    const prods = state.catalog.products;
    const p = prods.find(x => x.id === refProduct) || prods[0];
    refProduct = p.id;
    body.innerHTML = `<div class="ref-prod"><div class="card plist">${prods.map(x =>
      `<button class="pitem${x.id === p.id ? ' active' : ''}" data-id="${x.id}"><span>${esc(x.name)}</span><span class="bases">${x.bases.map(b => b.code).join(' · ')}</span></button>`).join('')}</div>
      <div class="card"><h3>${esc(p.name)}</h3>
      ${p.bases.map(b => `<div class="base-card"><h4>База ${esc(b.code)}</h4>
        <div class="spec"><span>Основа рецептур: <b>${esc(b.liquid || '—')}</b></span><span>Плотность: <b>${fmt(b.sg, 3)}</b></span>
        <span>Макс. пасты: <b>${b.maxfill ? fmt(b.maxfill * 100, 0) + ' %' : '—'}</b></span><span>Коэффициент рецептуры: <b>${fmt(b.coefficient, 3)}</b></span></div>
        <table class="data ref-table"><thead><tr><th>Тара</th><th class="num">Цена базы, ${esc(cur)}</th></tr></thead><tbody>
        ${(b.cans || []).map(c => { const k = `${p.name}|${b.code}|${c.code}`; return `<tr><td>${esc(canLabel(c.code))}</td>
          <td class="num"><input type="number" min="0" step="1" data-k="${esc(k)}" value="${prices[k] ?? ''}" placeholder="не задана"></td></tr>`; }).join('') || '<tr><td colspan="2" class="muted">нет тары</td></tr>'}
        </tbody></table></div>`).join('')}
      </div></div>`;
    body.querySelector('.plist').addEventListener('click', e => { const b = e.target.closest('.pitem'); if (b) { refProduct = +b.dataset.id; renderRefs(); } });
    body.querySelectorAll('input[data-k]').forEach(i => i.addEventListener('change', async () => {
      const [Product, Base, Can] = i.dataset.k.split('|');
      await post('/api/price/base', { Product, Base, Can, Price: +i.value || 0 }); toast('Цена базы сохранена'); recalc();
    }));
  } else {
    body.innerHTML = `<div class="card"><p class="muted">Нажмите на веер, чтобы открыть его цвета в колеровке.</p><div class="cards-list">${state.catalog.cards.map(c =>
      `<div role="button" data-id="${c.id}" style="cursor:pointer"><span>${esc(c.name)}</span><span class="muted">${fmt(c.count, 0)}</span></div>`).join('')}</div></div>`;
    body.querySelector('.cards-list').addEventListener('click', e => {
      const d = e.target.closest('[data-id]'); if (!d) return;
      $('#cardSelect').value = d.dataset.id; $('#colourSearch').value = ''; showView('tint'); searchColours();
    });
  }
}

/* ================= настройки и импорт ================= */
async function loadSettingsForm() {
  const s = state.settings = await api('/api/settings');
  $('#sShop').value = s.shop_name || ''; $('#sInfo').value = s.shop_info || ''; $('#sMarkup').value = s.markup || 0;
  $('#sUnit').value = s.unit || 'g'; $('#sLabel').value = s.label_width || '58'; $('#sShowCost').checked = s.show_cost !== '0';
  $('#sDispBackend').value = s.dispenser_backend || 'sim'; $('#sCorobAddr').value = s.corob_addr || '127.0.0.1:5000';
  const st = await api('/api/status');
  const m = st.meta || {};
  $('#dbInfo').innerHTML = st.has_db ? [
    [m.database || m.system || '—', 'система'], [fmt(+m.colours, 0), 'цветов'], [fmt(+m.recipes, 0), 'рецептур'],
    [m.products || '—', 'продуктов'], [m.cards || '—', 'вееров'], [m.imported || '—', `загружено из ${m.source_file || ''}`],
  ].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('') : '<div><b>Не загружена</b><span>выберите файл ниже</span></div>';
  if (st.installer_hint && !$('#importPath').value) $('#importPath').value = st.installer_hint;
  if (st.import && st.import.running) pollImport();
}
$('#btnSaveSettings').addEventListener('click', async () => {
  state.settings = await post('/api/settings', {
    shop_name: $('#sShop').value.trim(), shop_info: $('#sInfo').value.trim(), markup: String(+$('#sMarkup').value || 0),
    unit: $('#sUnit').value, label_width: $('#sLabel').value, show_cost: $('#sShowCost').checked ? '1' : '0',
  });
  $('#settingsSaved').hidden = false; setTimeout(() => ($('#settingsSaved').hidden = true), 2000);
  recalc();
});
$('#btnSaveDispenser').addEventListener('click', async () => {
  state.settings = await post('/api/settings', { dispenser_backend: $('#sDispBackend').value, corob_addr: $('#sCorobAddr').value.trim() || '127.0.0.1:5000' });
  $('#dispSaved').hidden = false; setTimeout(() => ($('#dispSaved').hidden = true), 2000);
  refreshDispenser();
});

function progressEls() {
  const welcome = !$('#welcome').hidden;
  return welcome ? [$('#importProgress2'), $('#importBar2'), $('#importText2')] : [$('#importProgress'), $('#importBar'), $('#importText')];
}
function setProgress(pct, text, err) {
  const [box, bar, txt] = progressEls();
  box.hidden = false; bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  txt.textContent = text; txt.classList.toggle('err', !!err);
}
function uploadFile(file) {
  if (!file) return;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/import/upload');
  xhr.upload.onprogress = e => e.lengthComputable && setProgress(e.loaded / e.total * 100, `Передача файла ${file.name}: ${fmt(e.loaded / 1048576, 0)} из ${fmt(e.total / 1048576, 0)} МБ`);
  xhr.onload = () => {
    if (xhr.status >= 300) { let m = 'Ошибка загрузки'; try { m = JSON.parse(xhr.responseText).error; } catch { } setProgress(0, m, true); return; }
    pollImport();
  };
  xhr.onerror = () => setProgress(0, 'Не удалось передать файл', true);
  xhr.send(file);
}
$('#importFile').addEventListener('change', e => uploadFile(e.target.files[0]));
$('#importFile2').addEventListener('change', e => uploadFile(e.target.files[0]));
async function importPath(v) {
  if (!v.trim()) return;
  try { await post('/api/import/path', { Path: v }); pollImport(); } catch (e) { setProgress(0, e.message, true); }
}
$('#btnImportPath').addEventListener('click', () => importPath($('#importPath').value));
$('#btnImportPath2').addEventListener('click', () => importPath($('#importPath2').value));
let polling = false;
async function pollImport() {
  if (polling) return; polling = true;
  try {
    for (;;) {
      const s = await api('/api/import/status');
      if (s.error) { setProgress(s.percent || 0, 'Ошибка: ' + s.error, true); break; }
      if (s.done && !s.running) {
        setProgress(100, s.summary || 'Готово');
        await loadCatalog(); toast('База рецептур загружена');
        if ($('#view-settings').classList.contains('active')) loadSettingsForm();
        break;
      }
      const m = Math.floor(s.elapsed / 60), sec = String(s.elapsed % 60).padStart(2, '0');
      setProgress(s.percent || 0, `${s.stage || 'Подготовка'}… ${fmt(s.percent || 0, 0)} % · ${m}:${sec}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  } finally { polling = false; }
}

init().catch(e => toast(e.message, true));
