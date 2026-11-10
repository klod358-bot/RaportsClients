/* АВТОКИНО — логика сайта */
(function () {
  'use strict';

  var AK = window.AK;
  var CFG = AK.CFG;
  var esc = AK.esc;
  var money = AK.money;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  var LIMITS = Object.assign({ maxPhotoMB: 25, maxReceiptMB: 10, maxPersonPhotos: 5 }, CFG.upload || {});
  var PRICE = Number(CFG.price) || 0;
  var MAX_QTY = Math.max(1, Number(CFG.maxVideosPerOrder) || 5);
  var PHOTO_MAX_SIDE = 1920;
  var PHOTO_QUALITY = 0.86;
  var RECEIPT_MAX_SIDE = 2400;
  var RECEIPT_QUALITY = 0.9;
  var DRAFT_KEY = 'autokino-draft-v1';
  var VIDEOS = (CFG.videos || []).filter(function (v) { return v && v.src; });

  var CAR_SLOTS = [
    { key: 'car_front', label: 'Спереди', symbol: 'car-front', hint: 'Встаньте напротив машины в 3–4 шагах: обе фары и номер в кадре.' },
    { key: 'car_back', label: 'Сзади', symbol: 'car-rear', hint: 'Прямо за машиной: видны оба фонаря и номер.' },
    { key: 'car_left', label: 'Слева', symbol: 'car-side', hint: 'Машина целиком, от бампера до бампера, камера на уровне ручек дверей.' },
    { key: 'car_right', label: 'Справа', symbol: 'car-side', flip: true, hint: 'Так же с правой стороны: вся машина в кадре.' },
  ];
  var MOODS = ['Ночной город', 'Погоня', 'Дрифт', 'Закат', 'Горы', 'Трасса', 'Я за рулём', 'Как в рекламе'];
  var COLORS = [
    ['Чёрный', '#0e0e10'], ['Белый', '#f1f1ef'], ['Серебристый', '#b8bcc3'], ['Серый', '#686c73'],
    ['Красный', '#c8141f'], ['Синий', '#1c3d8c'], ['Зелёный', '#1f5a3c'], ['Бежевый', '#cdb892'], ['Коричневый', '#5a3a28'],
  ];
  var BRANDS = ['Toyota', 'Lexus', 'Mercedes-Benz', 'BMW', 'Audi', 'Porsche', 'Volkswagen', 'Hyundai', 'Kia', 'Chevrolet',
    'Nissan', 'Infiniti', 'Mitsubishi', 'Honda', 'Mazda', 'Subaru', 'Land Rover', 'Range Rover', 'Jeep', 'Ford', 'Tesla',
    'Volvo', 'Skoda', 'Renault', 'Lada', 'Haval', 'Chery', 'Geely', 'Changan', 'Jetour', 'Tank', 'Exeed', 'Omoda', 'Zeekr',
    'Li Auto', 'BYD', 'Hongqi', 'Genesis', 'Cadillac', 'Bentley', 'Rolls-Royce', 'Maserati', 'Ferrari', 'Lamborghini', 'Dodge', 'GAZ', 'UAZ'];

  var state = {
    files: { car_front: null, car_back: null, car_left: null, car_right: null, person: [], receipt: null },
    qty: 1,
    moods: [],
    sending: false,
    clientId: null,
    lastFocus: null,
  };

  /* ===================== Настройки на странице ===================== */
  function applyConfig() {
    $$('[data-cfg]').forEach(function (el) {
      var v = AK.get(el.dataset.cfg);
      if (v != null && v !== '') el.textContent = v;
    });
    $$('[data-if]').forEach(function (el) { el.hidden = !AK.get(el.dataset.if); });
    $$('[data-price-text]').forEach(function (el) { el.textContent = money(PRICE); });
    var contacts = CFG.contacts || {};
    var wa = AK.waLink(contacts.whatsapp, 'Здравствуйте! Хочу заказать AI-видео со своей машиной.');
    $$('[data-contact="whatsapp"]').forEach(function (a) { if (wa) { a.href = wa; a.hidden = false; } });
    var ig = AK.igLink(contacts.instagram);
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
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
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
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
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
      unlockScroll();
      updateDock();
      if (viewerOpener && viewerOpener.focus) viewerOpener.focus({ preventScroll: true });
    });
    $('#viewerOrder').addEventListener('click', function () {
      var v = VIDEOS[vIndex];
      viewer.close();
      var story = $('#f-story');
      var line = 'Как в примере «' + (v.title || 'видео') + '»';
      if (story.value.indexOf(line) === -1) story.value = story.value.trim() ? story.value.trim() + '\n' + line : line;
      saveDraft();
      updateProgress();
      $('#order').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      AK.toast('Добавили пример «' + (v.title || 'видео') + '» в пожелания');
    });
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
    lockScroll();
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
    vv.muted = false;
    var p = vv.play();
    if (p && p.catch) p.catch(function () { vv.muted = true; updateSound(); vv.play().catch(function () {}); });
    updateSound();
  }

  var scrollLocks = 0;
  function lockScroll() { scrollLocks++; document.documentElement.style.overflow = 'hidden'; }
  function unlockScroll() { scrollLocks = Math.max(0, scrollLocks - 1); if (!scrollLocks) document.documentElement.style.overflow = ''; }

  /* ===================== Форма: поля ===================== */
  var form, fields = {};
  function initFields() {
    form = $('#orderForm');
    ['name', 'phone', 'instagram', 'brand', 'model', 'year', 'color', 'story', 'wishes'].forEach(function (n) { fields[n] = form.elements[n]; });
    fields.consent = $('#f-consent');

    $('#brands').innerHTML = BRANDS.map(function (b) { return '<option value="' + esc(b) + '">'; }).join('');

    var sw = $('#swatches');
    sw.innerHTML = COLORS.map(function (c) {
      return '<button type="button" class="swatch" style="--c:' + c[1] + '" data-color="' + esc(c[0]) + '" aria-pressed="false" aria-label="' + esc(c[0]) + '" title="' + esc(c[0]) + '"></button>';
    }).join('');
    sw.addEventListener('click', function (e) {
      var b = e.target.closest('.swatch');
      if (!b) return;
      fields.color.value = b.dataset.color;
      fields.color.dispatchEvent(new Event('input', { bubbles: true }));
    });

    var moods = $('#moods');
    moods.innerHTML = MOODS.map(function (m) { return '<button type="button" class="chip" aria-pressed="false" data-mood="' + esc(m) + '">' + esc(m) + '</button>'; }).join('');
    moods.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      var m = b.dataset.mood, idx = state.moods.indexOf(m);
      if (idx === -1) state.moods.push(m); else state.moods.splice(idx, 1);
      syncMoods();
      saveDraft();
      updateProgress();
    });

    fields.phone.addEventListener('focus', function () { if (!fields.phone.value) fields.phone.value = '+7 '; });
    fields.phone.addEventListener('blur', function () {
      var v = fields.phone.value.trim();
      fields.phone.value = (v === '+7' || v === '+') ? '' : AK.maskPhone(v);
      saveDraft();
    });
    fields.phone.addEventListener('input', function (e) {
      if (e.inputType && e.inputType.indexOf('delete') === 0) return;
      var masked = AK.maskPhone(fields.phone.value);
      if (masked !== fields.phone.value) {
        fields.phone.value = masked;
        try { fields.phone.setSelectionRange(masked.length, masked.length); } catch (err) { /* noop */ }
      }
    });
    fields.year.addEventListener('input', function () {
      var d = AK.digits(fields.year.value).slice(0, 4);
      if (d !== fields.year.value) fields.year.value = d;
    });
    fields.instagram.addEventListener('input', function () {
      var v = fields.instagram.value.replace(/^@+/, '').replace(/\s+/g, '');
      if (/instagram\.com\//i.test(v)) v = v.replace(/^.*instagram\.com\//i, '').split(/[/?#]/)[0];
      if (v !== fields.instagram.value) fields.instagram.value = v;
    });

    form.addEventListener('input', function (e) {
      var f = e.target.closest('.field');
      if (f && f.classList.contains('is-invalid')) validateField(e.target.name);
      if (e.target === fields.color) syncSwatches();
      if (e.target === fields.consent && fields.consent.checked) setConsentError('');
      saveDraftSoon();
      updateProgress();
    });
    form.addEventListener('change', function (e) {
      if (e.target === fields.consent) { if (fields.consent.checked) setConsentError(''); updateProgress(); }
    });

    $$('.stepper-btn').forEach(function (b) {
      b.addEventListener('click', function () { setQty(state.qty + Number(b.dataset.qty)); saveDraft(); });
    });

    $('#copyPhone').addEventListener('click', copyPhone);

    $$('#progressList li').forEach(function (li) {
      li.addEventListener('click', function () {
        var panel = $('[data-step-panel="' + li.dataset.step + '"]');
        if (panel) panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    });
  }

  function syncSwatches() {
    var v = fields.color.value.trim().toLowerCase();
    $$('.swatch').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === v)); });
  }
  function syncMoods() {
    $$('#moods .chip').forEach(function (b) { b.setAttribute('aria-pressed', String(state.moods.indexOf(b.dataset.mood) !== -1)); });
  }

  function setQty(n) {
    state.qty = Math.max(1, Math.min(MAX_QTY, n || 1));
    $('#qty').textContent = state.qty;
    $('[data-qty="-1"]').disabled = state.qty <= 1;
    $('[data-qty="1"]').disabled = state.qty >= MAX_QTY;
    updateTotal();
  }
  function total() { return PRICE * state.qty; }
  function updateTotal() { $$('[data-total]').forEach(function (el) { el.textContent = money(total()); }); }

  function copyPhone() {
    var raw = (CFG.payment && CFG.payment.phone) || '';
    var d = AK.digits(raw);
    if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    var text = '+' + d;
    var btn = $('#copyPhone');
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
  }

  /* ===================== Черновик ===================== */
  var draftTimer;
  function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); }
  function saveDraft() {
    var d = { qty: state.qty, moods: state.moods };
    ['name', 'phone', 'instagram', 'brand', 'model', 'year', 'color', 'story', 'wishes'].forEach(function (n) { d[n] = fields[n].value; });
    AK.storage.set(DRAFT_KEY, d);
  }
  function restoreDraft() {
    var d = AK.storage.get(DRAFT_KEY);
    if (!d || typeof d !== 'object') return;
    ['name', 'phone', 'instagram', 'brand', 'model', 'year', 'color', 'story', 'wishes'].forEach(function (n) {
      if (typeof d[n] === 'string' && d[n]) fields[n].value = d[n];
    });
    if (Array.isArray(d.moods)) state.moods = d.moods.filter(function (m) { return MOODS.indexOf(m) !== -1; });
    if (d.qty) setQty(Number(d.qty));
    syncMoods();
    syncSwatches();
  }
  function clearDraft() { AK.storage.remove(DRAFT_KEY); }

  /* ===================== Файлы ===================== */
  function isImageFile(f) {
    return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name || '');
  }
  function checkImage(f, maxMB) {
    if (!isImageFile(f)) return 'Это не фото. Загрузите изображение в формате JPG или PNG.';
    if (f.size > maxMB * 1024 * 1024) return 'Фото слишком большое (' + AK.fmtBytes(f.size) + '). Максимум — ' + maxMB + ' МБ.';
    if (!f.size) return 'Файл пустой. Выберите другое фото.';
    return '';
  }
  function baseName(n) { return String(n || 'photo').replace(/\.[^.]+$/, '').replace(/[^\wа-яё\-]+/gi, '_').slice(0, 60) || 'photo'; }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось открыть это фото. Сохраните его в формате JPG или PNG и загрузите снова.'));
      };
      img.src = url;
    });
  }

  /* Сжимаем фото в браузере: длинная сторона до maxSide, JPEG. Ориентация с телефона сохраняется. */
  function processImage(file, maxSide, quality) {
    return loadImage(file).then(function (r) {
      var img = r.img;
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error('Не удалось прочитать размеры фото. Попробуйте другое фото.');
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cw, ch);
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            canvas.width = canvas.height = 0;
            if (!blob) { reject(new Error('Не удалось обработать фото. Попробуйте другое.')); return; }
            resolve({
              blob: blob, name: baseName(file.name) + '.jpg', type: 'image/jpeg', size: blob.size,
              url: URL.createObjectURL(blob), w: cw, h: ch, origName: file.name,
            });
          }, 'image/jpeg', quality);
        });
      } finally {
        URL.revokeObjectURL(r.url);
      }
    });
  }

  function release(item) { if (item && item.url) { try { URL.revokeObjectURL(item.url); } catch (e) { /* noop */ } } }

  function enableDrop(el, onFiles) {
    ['dragenter', 'dragover'].forEach(function (t) {
      el.addEventListener(t, function (e) { e.preventDefault(); el.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.addEventListener(t, function (e) { e.preventDefault(); el.classList.remove('is-drag'); });
    });
    el.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  }

  /* --- Ракурсы автомобиля --- */
  function initCarShots() {
    var wrap = $('#carShots');
    wrap.innerHTML = CAR_SLOTS.map(function (s) {
      return '<div class="shot" id="shot-' + s.key + '" data-slot="' + s.key + '">' +
        '<div class="shot-media">' +
          '<label class="shot-frame">' +
            '<input type="file" id="f-' + s.key + '" class="sr-only" accept="image/*" aria-label="Фото автомобиля: ' + s.label.toLowerCase() + '" aria-describedby="e-' + s.key + '">' +
            '<span class="shot-label">' + s.label + '</span>' +
            '<svg class="shot-guide' + (s.flip ? ' flip' : '') + '" viewBox="0 0 240 112" aria-hidden="true"><use href="#' + s.symbol + '"/></svg>' +
            '<img class="shot-preview" alt="Фото автомобиля: ' + s.label.toLowerCase() + '" hidden>' +
            '<span class="shot-ok" aria-hidden="true"><svg><use href="#i-check"/></svg></span>' +
          '</label>' +
          '<button type="button" class="icon-btn shot-remove" aria-label="Удалить фото: ' + s.label.toLowerCase() + '" hidden><svg aria-hidden="true"><use href="#i-close"/></svg></button>' +
        '</div>' +
        '<p class="shot-hint">' + s.hint + '</p>' +
        '<div class="shot-actions">' +
          '<label class="btn btn-ghost btn-sm" for="f-' + s.key + '"><span class="shot-pick">Загрузить фото</span></label>' +
        '</div>' +
        '<p class="field-error" id="e-' + s.key + '"></p>' +
      '</div>';
    }).join('');

    CAR_SLOTS.forEach(function (s) {
      var shot = $('#shot-' + s.key);
      var input = $('#f-' + s.key);
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) setSlotFile(s.key, input.files[0]);
        input.value = '';
      });
      $('.shot-remove', shot).addEventListener('click', function () {
        release(state.files[s.key]);
        state.files[s.key] = null;
        renderSlot(s.key);
        updateProgress();
      });
      enableDrop($('.shot-frame', shot), function (files) { setSlotFile(s.key, files[0]); });
    });
  }

  function setSlotFile(key, file) {
    var shot = $('#shot-' + key);
    var frame = $('.shot-frame', shot);
    var err = $('#e-' + key);
    var msg = checkImage(file, LIMITS.maxPhotoMB);
    if (msg) { err.textContent = msg; shot.classList.add('is-invalid'); return Promise.resolve(); }
    err.textContent = '';
    frame.classList.add('is-busy');
    return processImage(file, PHOTO_MAX_SIDE, PHOTO_QUALITY).then(function (item) {
      item.kind = key;
      release(state.files[key]);
      state.files[key] = item;
      shot.classList.remove('is-invalid');
      renderSlot(key);
    }, function (e) {
      err.textContent = e.message;
      shot.classList.add('is-invalid');
    }).then(function () {
      frame.classList.remove('is-busy');
      updateProgress();
    });
  }

  function renderSlot(key) {
    var shot = $('#shot-' + key);
    var item = state.files[key];
    var frame = $('.shot-frame', shot);
    var img = $('.shot-preview', shot);
    frame.classList.toggle('has-file', !!item);
    $('.shot-guide', shot).style.visibility = item ? 'hidden' : '';
    if (item) { img.src = item.url; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    $('.shot-pick', shot).textContent = item ? 'Заменить' : 'Загрузить фото';
    $('.shot-remove', shot).hidden = !item;
  }

  /* --- Фото человека --- */
  function initPeople() {
    var input = $('#f-person');
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      addPeople(files);
    });
    enableDrop($('#peopleAdd'), function (files) { addPeople(Array.prototype.slice.call(files)); });
  }

  function addPeople(files) {
    var err = $('#e-person');
    err.textContent = '';
    var room = LIMITS.maxPersonPhotos - state.files.person.length;
    if (files.length > room) {
      err.textContent = 'Можно загрузить не больше ' + LIMITS.maxPersonPhotos + ' фото. Лишние мы не добавили.';
      files = files.slice(0, Math.max(0, room));
    }
    var add = $('#peopleAdd');
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        var msg = checkImage(f, LIMITS.maxPhotoMB);
        if (msg) { err.textContent = msg; return; }
        var tile = document.createElement('div');
        tile.className = 'person is-busy';
        add.parentNode.insertBefore(tile, add);
        return processImage(f, PHOTO_MAX_SIDE, PHOTO_QUALITY).then(function (item) {
          item.kind = 'person';
          state.files.person.push(item);
        }, function (e) { err.textContent = e.message; }).then(function () { tile.remove(); renderPeople(); });
      });
    });
    return chain.then(function () {
      $('#sec-person').classList.remove('is-invalid-people');
      renderPeople();
      updateProgress();
    });
  }

  function renderPeople() {
    var wrap = $('#people');
    var add = $('#peopleAdd');
    $$('.person:not(.is-busy)', wrap).forEach(function (n) { n.remove(); });
    state.files.person.forEach(function (item, i) {
      var fig = document.createElement('figure');
      fig.className = 'person';
      fig.style.margin = '0';
      fig.innerHTML = '<img src="' + item.url + '" alt="Ваше фото ' + (i + 1) + '"><button type="button" class="icon-btn" aria-label="Удалить фото ' + (i + 1) + '"><svg aria-hidden="true"><use href="#i-close"/></svg></button>';
      $('button', fig).addEventListener('click', function () {
        release(item);
        state.files.person.splice(state.files.person.indexOf(item), 1);
        $('#e-person').textContent = '';
        renderPeople();
        updateProgress();
      });
      wrap.insertBefore(fig, add);
    });
    add.hidden = state.files.person.length >= LIMITS.maxPersonPhotos;
    $('.people-add-text').textContent = state.files.person.length ? 'Добавить ещё' : 'Загрузить фото';
  }

  /* --- Чек --- */
  var pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise(function (resolve, reject) {
        var base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
        var s = document.createElement('script');
        s.src = base + 'pdf.min.js';
        s.onload = function () {
          if (!window.pdfjsLib) { reject(new Error('pdf.js')); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        s.onerror = function () { pdfjsPromise = null; reject(new Error('pdf.js')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]);
  }
  function renderPdfThumb(blob) {
    return withTimeout(loadPdfJs(), 8000).then(function (lib) {
      return blob.arrayBuffer().then(function (buf) {
        return lib.getDocument({ data: new Uint8Array(buf) }).promise;
      }).then(function (pdf) {
        return pdf.getPage(1).then(function (page) {
          var vp1 = page.getViewport({ scale: 1 });
          var vp = page.getViewport({ scale: 260 / vp1.width });
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
            return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), pages: pdf.numPages };
          });
        });
      });
    });
  }
  function readHead(file, n) {
    return file.slice(0, n).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function initReceipt() {
    var input = $('#f-receipt');
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) setReceipt(input.files[0]);
      input.value = '';
    });
    $('#receiptRemove').addEventListener('click', function () {
      release(state.files.receipt);
      state.files.receipt = null;
      renderReceipt();
      updateProgress();
    });
    $('#receiptPreview').addEventListener('click', function () {
      var r = state.files.receipt;
      if (r) window.open(r.url, '_blank', 'noopener');
    });
    enableDrop($('#receipt'), function (files) { setReceipt(files[0]); });
  }

  function setReceipt(file) {
    var box = $('#receipt');
    var err = $('#e-receipt');
    err.textContent = '';
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    var isImg = /^image\/(jpeg|png|jpg|pjpeg)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name || '');
    var maxMB = LIMITS.maxReceiptMB;
    function fail(msg) { err.textContent = msg; box.classList.add('is-invalid'); }
    if (!isPdf && !isImg) return Promise.resolve(fail('Чек должен быть в формате JPG, PNG или PDF.'));
    if (file.size > maxMB * 1024 * 1024) return Promise.resolve(fail('Файл слишком большой (' + AK.fmtBytes(file.size) + '). Максимум — ' + maxMB + ' МБ.'));
    if (!file.size) return Promise.resolve(fail('Файл пустой. Выберите другой.'));
    box.classList.add('is-busy');
    var job;
    if (isPdf) {
      job = readHead(file, 5).then(function (h) {
        if (String.fromCharCode.apply(null, h) !== '%PDF-') throw new Error('Файл не похож на PDF. Загрузите чек в формате JPG, PNG или PDF.');
        return {
          blob: file, name: baseName(file.name) + '.pdf', type: 'application/pdf', size: file.size,
          url: URL.createObjectURL(file), pdf: true, origName: file.name,
        };
      });
    } else {
      job = processImage(file, RECEIPT_MAX_SIDE, RECEIPT_QUALITY).then(function (item) {
        item.name = baseName(file.name) + '.jpg';
        return item;
      });
    }
    return job.then(function (item) {
      item.kind = 'receipt';
      release(state.files.receipt);
      state.files.receipt = item;
      box.classList.remove('is-invalid');
      renderReceipt();
      if (item.pdf) {
        renderPdfThumb(item.blob).then(function (t) {
          if (state.files.receipt !== item) return;
          item.thumb = t.dataUrl;
          item.pages = t.pages;
          renderReceipt();
        }, function () { /* миниатюра PDF недоступна — показываем значок */ });
      }
    }, function (e) { fail(e.message); }).then(function () {
      box.classList.remove('is-busy');
      updateProgress();
    });
  }

  function renderReceipt() {
    var r = state.files.receipt;
    var box = $('#receipt');
    var prev = $('#receiptPreview');
    box.classList.toggle('has-file', !!r);
    $('#receiptRemove').hidden = !r;
    $('#receiptPick span').textContent = r ? 'Заменить чек' : 'Загрузить чек';
    var name = $('.receipt-name', box);
    if (!r) {
      prev.hidden = true;
      prev.innerHTML = '';
      if (name) name.remove();
      return;
    }
    prev.hidden = false;
    prev.title = 'Открыть чек';
    if (!r.pdf) {
      prev.className = 'receipt-preview';
      prev.innerHTML = '<img src="' + r.url + '" alt="Чек об оплате">';
    } else if (r.thumb) {
      prev.className = 'receipt-preview';
      prev.innerHTML = '<img src="' + r.thumb + '" alt="Чек об оплате, первая страница PDF"><span class="badge">PDF</span>';
    } else {
      prev.className = 'receipt-preview is-pdf-icon';
      prev.innerHTML = '<svg aria-hidden="true"><use href="#i-doc"/></svg><span class="badge">PDF</span>';
    }
    if (!name) {
      name = document.createElement('p');
      name.className = 'receipt-name';
      $('.receipt-actions', box).insertBefore(name, $('#receiptPick'));
    }
    name.textContent = (r.origName || r.name) + ', ' + AK.fmtBytes(r.size) + (r.pages > 1 ? ', ' + r.pages + ' стр.' : '');
  }

  /* ===================== Проверка ===================== */
  var STEP_NAMES = { client: 'данные о вас', car: 'автомобиль', carPhotos: 'фото автомобиля', person: 'ваше фото', payment: 'чек об оплате' };

  function fieldError(name) {
    var v = (fields[name].value || '').trim();
    switch (name) {
      case 'name': return v.length >= 2 ? '' : 'Укажите имя';
      case 'phone': return AK.phoneValid(v) ? '' : (v.length > 3 ? 'Проверьте номер: нужно 11 цифр, например +7 701 555 72 24' : 'Укажите номер телефона или WhatsApp');
      case 'brand': return v ? '' : 'Укажите марку';
      case 'model': return v ? '' : 'Укажите модель';
      case 'year': {
        var y = Number(v), max = new Date().getFullYear() + 1;
        if (!v) return 'Укажите год выпуска';
        return /^\d{4}$/.test(v) && y >= 1900 && y <= max ? '' : 'Год — четыре цифры, от 1900 до ' + max;
      }
      case 'color': return v ? '' : 'Укажите цвет';
      default: return '';
    }
  }
  function validateField(name) {
    var msg = fieldError(name);
    var input = fields[name];
    var wrap = input.closest('.field');
    var err = $('#e-' + name);
    if (wrap) wrap.classList.toggle('is-invalid', !!msg);
    if (err) err.textContent = msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err && msg) input.setAttribute('aria-describedby', err.id);
    return msg;
  }
  function setConsentError(msg) {
    $('#e-consent').textContent = msg;
    $('.consent').classList.toggle('is-invalid', !!msg);
  }

  function stepStatus() {
    var f = state.files;
    return {
      client: !fieldError('name') && !fieldError('phone'),
      car: !fieldError('brand') && !fieldError('model') && !fieldError('year') && !fieldError('color'),
      carPhotos: CAR_SLOTS.every(function (s) { return !!f[s.key]; }),
      person: f.person.length > 0,
      story: !!(state.moods.length || fields.story.value.trim() || fields.wishes.value.trim()),
      payment: !!f.receipt,
    };
  }

  function missingList(st) {
    st = st || stepStatus();
    return Object.keys(STEP_NAMES).filter(function (k) { return !st[k]; }).map(function (k) { return STEP_NAMES[k]; });
  }

  function updateProgress() {
    var st = stepStatus();
    Object.keys(st).forEach(function (k) {
      var panel = $('[data-step-panel="' + k + '"]');
      if (panel) panel.classList.toggle('is-done', st[k]);
      var li = $('#progressList [data-step="' + k + '"]');
      if (li) li.classList.toggle('is-done', st[k]);
    });
    updateDock();
  }

  function validateAll() {
    var problems = [];
    ['name', 'phone', 'brand', 'model', 'year', 'color'].forEach(function (n) {
      if (validateField(n)) problems.push(fields[n]);
    });
    CAR_SLOTS.forEach(function (s) {
      var shot = $('#shot-' + s.key);
      if (!state.files[s.key]) {
        $('#e-' + s.key).textContent = 'Загрузите фото: ' + s.label.toLowerCase();
        shot.classList.add('is-invalid');
        problems.push(shot);
      }
    });
    if (!state.files.person.length) {
      $('#e-person').textContent = 'Загрузите хотя бы одно своё фото';
      $('#sec-person').classList.add('is-invalid-people');
      problems.push($('#peopleAdd'));
    }
    if (!state.files.receipt) {
      $('#e-receipt').textContent = 'Прикрепите чек об оплате — без него мы не сможем подтвердить заказ';
      $('#receipt').classList.add('is-invalid');
      problems.push($('#receipt'));
    }
    if (!fields.consent.checked) {
      setConsentError('Отметьте согласие — без него мы не можем использовать ваши фото');
      problems.push($('.consent'));
    }
    return problems;
  }

  /* ===================== Отправка ===================== */
  var summary;
  function initSubmit() {
    summary = $('#summary');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      trySubmit();
    });
    $$('[data-close]', summary).forEach(function (b) { b.addEventListener('click', function () { if (!state.sending) summary.close(); }); });
    summary.addEventListener('cancel', function (e) { if (state.sending) e.preventDefault(); });
    summary.addEventListener('close', function () { unlockScroll(); updateDock(); resetSheet(); });
    $('#confirmSend').addEventListener('click', send);
    $('#finaleClose').addEventListener('click', closeFinale);
  }

  function trySubmit() {
    if (state.sending) return;
    var problems = validateAll();
    if (problems.length) {
      var first = problems[0];
      first.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      var focusable = first.matches('input, textarea') ? first : $('input', first);
      if (focusable) setTimeout(function () { try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); } }, reduceMotion ? 0 : 450);
      AK.toast(problems.length === 1 ? 'Осталось заполнить одно поле' : 'Заполните отмеченные поля: ' + problems.length, 3200);
      return;
    }
    $('#summaryBody').innerHTML = buildSummary();
    resetSheet();
    if (typeof summary.showModal === 'function') {
      summary.showModal();
      lockScroll();
      updateDock();
    } else {
      send();
    }
  }

  function formData() {
    var d = {};
    ['name', 'phone', 'instagram', 'brand', 'model', 'year', 'color', 'story', 'wishes'].forEach(function (n) { d[n] = fields[n].value.trim(); });
    d.phone = AK.maskPhone(d.phone);
    d.instagram = d.instagram.replace(/^@+/, '');
    return d;
  }

  function buildSummary() {
    var d = formData();
    var f = state.files;
    function thumb(item, cap) {
      return '<figure class="sum-thumb"><img src="' + item.url + '" alt="' + esc(cap) + '"><figcaption>' + esc(cap) + '</figcaption></figure>';
    }
    var r = f.receipt;
    var rThumb = !r.pdf ? '<figure class="sum-thumb"><img src="' + r.url + '" alt="Чек"></figure>'
      : r.thumb ? '<figure class="sum-thumb"><img src="' + r.thumb + '" alt="Чек, PDF"></figure>'
      : '<figure class="sum-thumb"><span class="pdf"><svg aria-hidden="true"><use href="#i-doc"/></svg></span></figure>';
    var wishes = '';
    if (state.moods.length) wishes += '<p class="sum-text"><b>Атмосфера:</b> ' + esc(state.moods.join(', ')) + '</p>';
    if (d.story) wishes += '<p class="sum-text"><b>Сюжет:</b> ' + esc(d.story) + '</p>';
    if (d.wishes) wishes += '<p class="sum-text"><b>Дополнительно:</b> ' + esc(d.wishes) + '</p>';
    return '' +
      '<section class="sum-group"><h3>Клиент</h3><dl class="sum-list">' +
        '<dt>Имя</dt><dd>' + esc(d.name) + '</dd>' +
        '<dt>Телефон</dt><dd>' + esc(d.phone) + '</dd>' +
        (d.instagram ? '<dt>Instagram</dt><dd>@' + esc(d.instagram) + '</dd>' : '') +
      '</dl></section>' +
      '<section class="sum-group"><h3>Автомобиль</h3><dl class="sum-list">' +
        '<dt>Машина</dt><dd>' + esc(d.brand + ' ' + d.model) + '</dd>' +
        '<dt>Год</dt><dd>' + esc(d.year) + '</dd>' +
        '<dt>Цвет</dt><dd>' + esc(d.color) + '</dd>' +
      '</dl></section>' +
      '<section class="sum-group"><h3>Фото автомобиля</h3><div class="sum-thumbs">' +
        CAR_SLOTS.map(function (s) { return thumb(f[s.key], s.label); }).join('') +
      '</div></section>' +
      '<section class="sum-group"><h3>Ваши фото</h3><div class="sum-thumbs people-thumbs">' +
        f.person.map(function (p, i) { return thumb(p, 'Фото ' + (i + 1)); }).join('') +
      '</div></section>' +
      (wishes ? '<section class="sum-group"><h3>Пожелания к видео</h3>' + wishes + '</section>' : '') +
      '<section class="sum-group"><h3>Оплата</h3>' +
        '<div class="sum-receipt">' + rThumb + '<div><p>Чек об оплате прикреплён</p><p class="hint">' + esc(r.origName || r.name) + ', ' + AK.fmtBytes(r.size) + '</p></div></div>' +
        '<div class="sum-total" style="margin-top:14px"><span>' + (state.qty > 1 ? 'Роликов: ' + state.qty + '. ' : '') + 'Сумма к оплате</span><strong>' + money(total()) + '</strong></div>' +
      '</section>';
  }

  function resetSheet() {
    $('#summaryBody').hidden = false;
    $('#summaryFoot').hidden = false;
    var st = $('#sendStatus');
    st.hidden = true;
    st.classList.remove('is-error');
    $$('.btn', st).forEach(function (b) { b.remove(); });
    $('.sheet-head [data-close]', summary).hidden = false;
  }

  function setStatus(title, text, isError) {
    $('#summaryBody').hidden = true;
    $('#summaryFoot').hidden = true;
    $('.sheet-head [data-close]', summary).hidden = !isError;
    var st = $('#sendStatus');
    st.hidden = false;
    st.classList.toggle('is-error', !!isError);
    $('#sendTitle').textContent = title;
    $('#sendText').textContent = text;
    $$('.btn', st).forEach(function (b) { b.remove(); });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { reject(new Error('Не удалось прочитать файл. Загрузите его ещё раз.')); };
      fr.readAsDataURL(blob);
    });
  }
  function packFile(item) {
    return blobToBase64(item.blob).then(function (data) {
      return { name: item.name, type: item.type, size: item.size, data: data };
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function buildPayload() {
    var f = state.files;
    var d = formData();
    var jobs = CAR_SLOTS.map(function (s) { return packFile(f[s.key]); });
    jobs.push(Promise.all(f.person.map(packFile)));
    jobs.push(packFile(f.receipt));
    return Promise.all(jobs).then(function (packed) {
      var files = {};
      CAR_SLOTS.forEach(function (s, i) { files[s.key] = packed[i]; });
      files.person = packed[CAR_SLOTS.length];
      files.receipt = packed[CAR_SLOTS.length + 1];
      if (!state.clientId) state.clientId = uuid();
      return {
        clientId: state.clientId,
        order: {
          name: d.name, phone: d.phone, instagram: d.instagram,
          brand: d.brand, model: d.model, year: d.year, color: d.color,
          moods: state.moods.slice(), story: d.story, wishes: d.wishes,
          quantity: state.qty, price: PRICE, amount: total(), currency: CFG.currency || '₸',
          consent: !!fields.consent.checked,
          website: (form.elements.website && form.elements.website.value) || '',
          page: location.href.split('#')[0],
        },
        files: files,
      };
    });
  }

  function totalBytes() {
    var f = state.files, sum = 0;
    CAR_SLOTS.forEach(function (s) { sum += f[s.key] ? f[s.key].size : 0; });
    f.person.forEach(function (p) { sum += p.size; });
    sum += f.receipt ? f.receipt.size : 0;
    return sum;
  }

  function send() {
    if (state.sending) return;
    state.sending = true;
    if (!summary.open && typeof summary.showModal === 'function') { summary.showModal(); lockScroll(); }
    setStatus('Отправляем заказ…', 'Загружаем фото и чек (' + AK.fmtBytes(totalBytes()) + '). Не закрывайте страницу — обычно это занимает до минуты.');
    var name = fields.name.value.trim();
    var car = (fields.brand.value.trim() + ' ' + fields.model.value.trim()).trim();
    buildPayload().then(function (payload) {
      return AK.api('createOrder', payload, { timeout: 300000 });
    }).then(function (res) {
      state.sending = false;
      summary.close();
      showFinale(res.orderId, name, car);
      resetForm();
    }, function (err) {
      state.sending = false;
      setStatus('Не удалось отправить', err.message + ' Ваши данные и фото сохранены на странице.', true);
      var st = $('#sendStatus');
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-red btn-lg';
      retry.textContent = 'Отправить ещё раз';
      retry.addEventListener('click', send);
      st.appendChild(retry);
      var wa = AK.waLink(CFG.contacts && CFG.contacts.whatsapp, 'Здравствуйте! Не получается отправить заказ на сайте. Меня зовут ' + name + '.');
      if (wa) {
        var a = document.createElement('a');
        a.className = 'btn btn-ghost btn-lg';
        a.href = wa; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'Написать в WhatsApp';
        a.style.marginLeft = '10px';
        st.appendChild(a);
      }
      retry.focus();
    });
  }

  function resetForm() {
    form.reset();
    ['car_front', 'car_back', 'car_left', 'car_right', 'receipt'].forEach(function (k) { release(state.files[k]); state.files[k] = null; });
    state.files.person.forEach(release);
    state.files.person = [];
    state.moods = [];
    state.clientId = null;
    CAR_SLOTS.forEach(function (s) { renderSlot(s.key); });
    renderPeople();
    renderReceipt();
    syncMoods();
    syncSwatches();
    setQty(1);
    clearDraft();
    $$('.field.is-invalid').forEach(function (n) { n.classList.remove('is-invalid'); });
    updateProgress();
  }

  function showFinale(orderId, name, car) {
    var fin = $('#finale');
    $('#finaleNum').innerHTML = 'Номер заказа <b>' + esc(orderId || '') + '</b>';
    var wa = AK.waLink(CFG.contacts && CFG.contacts.whatsapp, 'Здравствуйте! Я оформил(а) заказ ' + (orderId || '') + ' на сайте' + (car ? ': ' + car : '') + '. Меня зовут ' + name + '.');
    var waBtn = $('#finaleWa');
    if (wa) { waBtn.href = wa; waBtn.hidden = false; }
    state.lastFocus = document.activeElement;
    fin.hidden = false;
    lockScroll();
    updateDock();
    requestAnimationFrame(function () { requestAnimationFrame(function () { fin.classList.add('is-open'); }); });
    setTimeout(function () { $('#finaleTitle').focus({ preventScroll: true }); }, 60);
    document.addEventListener('keydown', finaleKeys);
  }
  function finaleKeys(e) { if (e.key === 'Escape') closeFinale(); }
  function closeFinale() {
    var fin = $('#finale');
    fin.classList.remove('is-open');
    fin.hidden = true;
    document.removeEventListener('keydown', finaleKeys);
    unlockScroll();
    window.scrollTo({ top: 0, behavior: 'auto' });
    updateDock();
  }

  /* ===================== Нижняя панель (телефон) ===================== */
  var vis = { hero: true, order: false, final: false, footer: false };
  function initDock() {
    if (!('IntersectionObserver' in window)) return;
    function watch(el, key, opts) {
      if (!el) return;
      new IntersectionObserver(function (en) { vis[key] = en[0].isIntersecting; updateDock(); }, opts || {}).observe(el);
    }
    watch($('.hero'), 'hero', { threshold: 0.35 });
    watch($('#order'), 'order', { rootMargin: '-35% 0px -35% 0px' });
    watch($('.final'), 'final');
    watch($('.credits'), 'footer');
    $('#dockBtn').addEventListener('click', function (e) {
      if ($('#dock').dataset.mode === 'form') { e.preventDefault(); trySubmit(); }
    });
  }
  function updateDock() {
    var dock = $('#dock');
    if (!dock) return;
    var modalOpen = (viewer && viewer.open) || (summary && summary.open) || !$('#finale').hidden;
    var show = !vis.hero && !vis.final && !vis.footer && !modalOpen;
    dock.classList.toggle('is-visible', show);
    var mode = vis.order ? 'form' : 'promo';
    dock.dataset.mode = mode;
    var btn = $('#dockBtn');
    if (mode === 'form') {
      var miss = missingList();
      $('#dockLabel').textContent = miss.length ? 'Осталось: ' + miss.join(', ') : 'Всё заполнено';
      btn.textContent = 'Отправить заказ';
    } else {
      $('#dockLabel').textContent = 'Ролик с вашей машиной';
      btn.textContent = 'Заказать видео';
    }
  }

  /* ===================== Старт ===================== */
  function init() {
    applyConfig();
    initHero();
    initTopbar();
    initReveal();
    initGallery();
    initViewer();
    initFields();
    initCarShots();
    initPeople();
    initReceipt();
    initSubmit();
    setQty(1);
    restoreDraft();
    updateProgress();
    initDock();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
