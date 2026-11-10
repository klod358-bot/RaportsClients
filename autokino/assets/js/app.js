/* АВТОКИНО — логика сайта */
(function () {
  'use strict';

  var AK = window.AK;
  var CFG = AK.CFG;
  var esc = AK.esc;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var VIDEOS = (CFG.videos || []).filter(function (v) { return v && v.src; });
  var CONTACTS = CFG.contacts || {};

  var DEFAULT_TEXT = 'Здравствуйте! Хочу заказать AI-видео со своей машиной.\n\n' +
    'Имя: \nМашина (марка, модель, год, цвет): \nПожелания к сюжету: \n\n' +
    'Отправляю фото машины с 4 сторон, своё фото и чек об оплате.';

  /* Текст сообщения для WhatsApp. example — название ролика из галереи. */
  function orderText(example) {
    var lines = String(CFG.whatsappText || DEFAULT_TEXT).split('\n');
    if (example) lines.splice(1, 0, 'Хочу как в примере «' + example + '».');
    return lines.join('\n');
  }
  function orderLink(example) { return AK.waLink(CONTACTS.whatsapp, orderText(example)); }

  /* ===================== Настройки на странице ===================== */
  function applyConfig() {
    $$('[data-cfg]').forEach(function (el) {
      var v = AK.get(el.dataset.cfg);
      if (v != null && v !== '') el.textContent = v;
    });
    $$('[data-if]').forEach(function (el) { el.hidden = !AK.get(el.dataset.if); });
    $$('[data-price-text]').forEach(function (el) { el.textContent = AK.money(CFG.price); });
    var wa = orderLink();
    $$('[data-contact="whatsapp"], [data-wa-order]').forEach(function (a) {
      if (wa) { a.href = wa; a.hidden = false; } else if (a.hasAttribute('data-contact')) a.hidden = true;
    });
    var ig = AK.igLink(CONTACTS.instagram);
    $$('[data-contact="instagram"]').forEach(function (a) { if (ig) { a.href = ig; a.hidden = false; } });
    if (CFG.brand) document.title = CFG.brand + ' — AI-видео с вашим автомобилем';
    var y = $('#year');
    if (y) y.textContent = new Date().getFullYear();
  }

  /* ===================== Главный экран ===================== */
  function initHero() {
    var hero = $('.hero');
    if (!hero) return;
    var opened = false;
    function open() { if (!opened) { opened = true; hero.classList.add('is-open'); } }
    var poster = $('.hero-poster');
    if (reduceMotion) open();
    else {
      var go = function () { requestAnimationFrame(function () { setTimeout(open, 120); }); };
      if (poster && !poster.complete) { poster.addEventListener('load', go, { once: true }); poster.addEventListener('error', go, { once: true }); }
      else go();
      setTimeout(open, 1400);
    }

    var video = $('.hero-video');
    var conn = navigator.connection || {};
    if (!video || reduceMotion || conn.saveData) return;
    var started = false;
    function start() {
      if (started) return;
      started = true;
      var portrait = window.matchMedia && matchMedia('(orientation: portrait)').matches;
      video.src = portrait ? 'videos/hero-vertical.mp4' : 'videos/hero.mp4';
      video.addEventListener('playing', function () { video.classList.add('is-playing'); }, { once: true });
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* автозапуск запрещён — остаётся постер */ });
    }
    if (document.readyState === 'complete') setTimeout(start, 400);
    else window.addEventListener('load', function () { setTimeout(start, 400); }, { once: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (!started) return;
        if (entries[0].isIntersecting) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } else video.pause();
      }).observe(hero);
    }
  }

  function initTopbar() {
    var bar = $('#topbar');
    function upd() { bar.classList.toggle('is-solid', window.scrollY > 40); }
    window.addEventListener('scroll', upd, { passive: true });
    upd();
  }

  function initReveal() {
    var els = $$('[data-reveal]');
    if (!('IntersectionObserver' in window) || reduceMotion) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ===================== Галерея ===================== */
  function initGallery() {
    var list = $('#reels');
    if (!list) return;
    if (!VIDEOS.length) { $('#examples').hidden = true; return; }
    list.innerHTML = VIDEOS.map(function (v, i) {
      var pos = esc((v.focus || '50%') + ' 50%');
      var media = v.poster
        ? '<img src="' + esc(v.poster) + '" alt="" loading="lazy" decoding="async" style="object-position:' + pos + '">'
        : '<video muted playsinline preload="metadata" src="' + esc(v.src) + '#t=0.5" style="object-position:' + pos + '"></video>';
      return '<li><button type="button" class="reel" data-i="' + i + '" aria-label="Смотреть видео «' + esc(v.title || 'Пример') + '»' + (v.duration ? ', ' + esc(v.duration) : '') + '">' +
        '<span class="reel-media">' + media + '</span>' +
        (v.duration ? '<span class="reel-time">' + esc(v.duration) + '</span>' : '') +
        '<span class="reel-play" aria-hidden="true"><svg><use href="#i-play"/></svg></span>' +
        '<span class="reel-meta"><span class="reel-title">' + esc(v.title || '') + '</span>' +
        (v.note ? '<span class="reel-note">' + esc(v.note) + '</span>' : '') + '</span>' +
        '</button></li>';
    }).join('');

    $$('.reel', list).forEach(function (btn) {
      var i = Number(btn.dataset.i);
      btn.addEventListener('click', function () { openViewer(i, btn); });
      if (!canHover || reduceMotion) return;
      var pv = null;
      btn.addEventListener('pointerenter', function () {
        var media = $('.reel-media', btn);
        pv = $('video', media);
        if (!pv) {
          pv = document.createElement('video');
          pv.muted = true; pv.loop = true; pv.playsInline = true; pv.preload = 'auto';
          pv.setAttribute('aria-hidden', 'true');
          pv.style.objectPosition = (VIDEOS[i].focus || '50%') + ' 50%';
          pv.src = VIDEOS[i].src;
          media.appendChild(pv);
        }
        pv.onplaying = function () { btn.classList.add('is-previewing'); };
        var p = pv.play(); if (p && p.catch) p.catch(function () {});
      });
      btn.addEventListener('pointerleave', function () {
        btn.classList.remove('is-previewing');
        if (pv) pv.pause();
      });
    });
  }

  /* ===================== Просмотр видео ===================== */
  var viewer, vv, vIndex = 0, viewerOpener = null;
  function initViewer() {
    viewer = $('#viewer');
    vv = $('#viewerVideo');
    if (!viewer || !vv) return;
    $$('[data-close]', viewer).forEach(function (b) { b.addEventListener('click', function () { viewer.close(); }); });
    $('#viewerPrev').addEventListener('click', function () { setViewer(vIndex - 1); });
    $('#viewerNext').addEventListener('click', function () { setViewer(vIndex + 1); });
    $('#viewerSound').addEventListener('click', function () { vv.muted = !vv.muted; updateSound(); });
    vv.addEventListener('click', togglePlay);
    vv.addEventListener('play', function () { $('#viewerPaused').hidden = true; });
    vv.addEventListener('pause', function () { if (viewer.open) $('#viewerPaused').hidden = false; });
    vv.addEventListener('ended', function () { if (VIDEOS.length > 1) setViewer(vIndex + 1); });
    vv.addEventListener('timeupdate', function () {
      var pct = vv.duration ? (vv.currentTime / vv.duration) * 100 : 0;
      $('#viewerBar').style.width = pct + '%';
      $('#viewerProgress').setAttribute('aria-valuenow', String(Math.round(pct)));
    });
    var prog = $('#viewerProgress');
    prog.addEventListener('click', function (e) {
      var r = prog.getBoundingClientRect();
      if (vv.duration) vv.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * vv.duration;
    });
    prog.addEventListener('keydown', function (e) {
      if (!vv.duration) return;
      if (e.key === 'ArrowRight') { vv.currentTime = Math.min(vv.duration, vv.currentTime + 5); e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'ArrowLeft') { vv.currentTime = Math.max(0, vv.currentTime - 5); e.preventDefault(); e.stopPropagation(); }
    });
    viewer.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { setViewer(vIndex + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { setViewer(vIndex - 1); e.preventDefault(); }
      else if (e.key === ' ' && e.target === viewer) { togglePlay(); e.preventDefault(); }
      else if (e.key === 'm' || e.key === 'ь') { vv.muted = !vv.muted; updateSound(); }
    });
    var t0 = null;
    viewer.addEventListener('touchstart', function (e) {
      if (e.target.closest('button, a, .viewer-progress')) { t0 = null; return; }
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    viewer.addEventListener('touchend', function (e) {
      if (!t0) return;
      var dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
      t0 = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 60) return;
      if (Math.abs(dy) > Math.abs(dx)) setViewer(vIndex + (dy < 0 ? 1 : -1));
      else setViewer(vIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
    viewer.addEventListener('close', function () {
      vv.pause();
      vv.removeAttribute('src');
      vv.load();
      document.documentElement.style.overflow = '';
      updateDock();
      if (viewerOpener && viewerOpener.focus) viewerOpener.focus({ preventScroll: true });
    });
    // «Хочу такое же» открывает WhatsApp с названием примера; сам просмотр закрываем
    $('#viewerOrder').addEventListener('click', function () { setTimeout(function () { viewer.close(); }, 300); });
  }

  function togglePlay() {
    if (vv.paused) { var p = vv.play(); if (p && p.catch) p.catch(function () {}); } else vv.pause();
  }

  function updateSound() {
    var b = $('#viewerSound');
    b.setAttribute('aria-label', vv.muted ? 'Включить звук' : 'Выключить звук');
    $('use', b).setAttribute('href', vv.muted ? '#i-mute' : '#i-sound');
  }

  function openViewer(i, opener) {
    viewerOpener = opener || null;
    if (typeof viewer.showModal !== 'function') { window.open(VIDEOS[i].src, '_blank'); return; }
    viewer.showModal();
    document.documentElement.style.overflow = 'hidden';
    updateDock();
    setViewer(i);
  }

  function setViewer(i) {
    var n = VIDEOS.length;
    vIndex = ((i % n) + n) % n;
    var v = VIDEOS[vIndex];
    var bg = $('#viewerBg');
    if (v.poster) { bg.src = v.poster; bg.hidden = false; } else { bg.hidden = true; }
    if (v.poster) vv.poster = v.poster; else vv.removeAttribute('poster');
    vv.src = v.src;
    $('#viewerTitle').textContent = v.title || '';
    $('#viewerNote').textContent = v.note || '';
    $('#viewerCount').textContent = (vIndex + 1) + ' / ' + n;
    $('#viewerBar').style.width = '0%';
    $('#viewerPrev').hidden = $('#viewerNext').hidden = n < 2;
    var order = $('#viewerOrder');
    var link = orderLink(v.title);
    if (link) { order.href = link; order.hidden = false; } else order.hidden = true;
    vv.muted = false;
    var p = vv.play();
    if (p && p.catch) p.catch(function () { vv.muted = true; updateSound(); vv.play().catch(function () {}); });
    updateSound();
  }

  /* ===================== Оплата ===================== */
  function initCopy() {
    var btn = $('#copyPhone');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var raw = (CFG.payment && CFG.payment.phone) || '';
      var text = '+' + AK.waNumber(raw);
      function done() {
        AK.toast('Номер скопирован: ' + raw);
        $('span', btn).textContent = 'Скопировано';
        setTimeout(function () { $('span', btn).textContent = 'Скопировать номер'; }, 2200);
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        if (ok) done(); else AK.toast('Не получилось скопировать. Номер: ' + raw, 4000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
  }

  /* ===================== Нижняя панель (телефон) ===================== */
  var vis = { hero: true, order: false, footer: false };
  function initDock() {
    if (!('IntersectionObserver' in window)) return;
    function watch(el, key, opts) {
      if (!el) return;
      new IntersectionObserver(function (en) { vis[key] = en[0].isIntersecting; updateDock(); }, opts || {}).observe(el);
    }
    watch($('.hero'), 'hero', { threshold: 0.35 });
    watch($('#order'), 'order', { rootMargin: '0px 0px -25% 0px' });
    watch($('.credits'), 'footer');
  }
  function updateDock() {
    var dock = $('#dock');
    if (!dock) return;
    var show = !vis.hero && !vis.order && !vis.footer && !(viewer && viewer.open);
    dock.classList.toggle('is-visible', show);
  }

  /* ===================== Старт ===================== */
  function init() {
    applyConfig();
    initHero();
    initTopbar();
    initReveal();
    initGallery();
    initViewer();
    initCopy();
    initDock();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
