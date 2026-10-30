'use strict';
/* ============================================================================
   МОК-СЕРВЕР ДЛЯ ПРОТОТИПА «КОЛЕРОВКА»
   Подменяет сетевые запросы (/api/...) заранее подготовленными примерами данных,
   чтобы интерфейс полностью работал в браузере без запущенной программы.
   Данные — ПРИМЕРНЫЕ, только для оценки внешнего вида и удобства.
   ========================================================================== */
(function () {
  const CUR = '₸';

  /* ---------- настройки (объявлены рано: нужны в расчёте) ---------- */
  const state = {
    settings: {
      shop_name: 'Магазин красок «Радуга»', shop_info: 'г. Алматы, пр. Абая 10 · +7 777 000-00-00',
      markup: '15', unit: 'g', label_width: '58', show_cost: '1',
      dispenser_backend: 'sim', corob_addr: '127.0.0.1:9333',
    },
  };

  /* ---------- пасты (колоранты) ---------- */
  const colorants = [
    { code: 'B',  descr: 'Чёрный',           rgb: '#141414', sg: 1.30, price: 3200 },
    { code: 'W',  descr: 'Белый (диоксид)',  rgb: '#f1f1ee', sg: 1.55, price: 2600 },
    { code: 'OY', descr: 'Оксид жёлтый',     rgb: '#b9821f', sg: 1.45, price: 2900 },
    { code: 'OR', descr: 'Оксид красный',    rgb: '#8c3b2b', sg: 1.50, price: 3100 },
    { code: 'Y',  descr: 'Жёлтый',           rgb: '#f3c20a', sg: 1.18, price: 4200 },
    { code: 'DY', descr: 'Жёлтый тёмный',    rgb: '#e59a00', sg: 1.20, price: 4300 },
    { code: 'R',  descr: 'Красный',          rgb: '#c5202a', sg: 1.22, price: 5200 },
    { code: 'M',  descr: 'Магента',          rgb: '#a01a5a', sg: 1.20, price: 6400 },
    { code: 'V',  descr: 'Фиолетовый',       rgb: '#5c2a86', sg: 1.16, price: 6800 },
    { code: 'BL', descr: 'Синий',            rgb: '#16489a', sg: 1.14, price: 4800 },
    { code: 'BG', descr: 'Сине-зелёный',     rgb: '#0f6f84', sg: 1.18, price: 5200 },
    { code: 'G',  descr: 'Зелёный',          rgb: '#1c8a46', sg: 1.17, price: 5600 },
  ];
  const cntByCode = Object.fromEntries(colorants.map(c => [c.code, c]));

  /* ---------- продукты, базы, тара ---------- */
  let canId = 1;
  const can = (code, grav) => ({ id: canId++, code, gravimetric: !!grav });
  const litreCans = () => [can('0.9 l'), can('2.7 l'), can('4.5 l'), can('9 l')];
  const products = [
    { id: 1, name: 'Ambiente', group: 'Интерьерные краски', bases: [
      { code: 'A', liquid: 'Ambiente Base A (белая)', sg: 1.45, maxfill: 0.07, coefficient: 1.0, cans: litreCans() },
      { code: 'C', liquid: 'Ambiente Base C (прозрачная)', sg: 1.30, maxfill: 0.15, coefficient: 1.0, cans: litreCans() },
    ] },
    { id: 2, name: 'EKO Flexi Pro', group: 'Интерьерные краски', bases: [
      { code: 'A', liquid: 'EKO Base A (белая)', sg: 1.46, maxfill: 0.06, coefficient: 1.0, cans: litreCans() },
      { code: 'C', liquid: 'EKO Base C (прозрачная)', sg: 1.31, maxfill: 0.14, coefficient: 1.0, cans: litreCans() },
    ] },
    { id: 3, name: 'Facade Silicone', group: 'Фасадные краски', bases: [
      { code: 'BW', liquid: 'Facade Base BW (белая)', sg: 1.52, maxfill: 0.05, coefficient: 1.0, cans: [can('2.7 l'), can('9 l'), can('18 l')] },
      { code: 'C', liquid: 'Facade Base C (прозрачная)', sg: 1.33, maxfill: 0.12, coefficient: 1.0, cans: [can('2.7 l'), can('9 l'), can('18 l')] },
    ] },
    { id: 4, name: 'Universal Lak', group: 'Лаки и эмали', bases: [
      { code: 'TR', liquid: 'Лак алкидный прозрачный', sg: 0.94, maxfill: 0.08, coefficient: 1.0, cans: [can('0.8 kg', true), can('2.4 kg', true), can('9 kg', true)] },
    ] },
    { id: 5, name: 'Emal PF-115', group: 'Лаки и эмали', bases: [
      { code: 'A', liquid: 'Эмаль ПФ база A', sg: 1.20, maxfill: 0.05, coefficient: 1.0, cans: [can('0.9 kg', true), can('2.7 kg', true)] },
      { code: 'C', liquid: 'Эмаль ПФ база C', sg: 1.05, maxfill: 0.10, coefficient: 1.0, cans: [can('0.9 kg', true), can('2.7 kg', true)] },
    ] },
  ];
  const productById = id => products.find(p => p.id === +id);

  /* ---------- вееры (каталоги цветов) ---------- */
  const cards = [
    { id: 1, name: 'Arcobaleno Collection', count: 1200 },
    { id: 2, name: 'NCS Index', count: 1950 },
    { id: 3, name: 'RAL Classic', count: 213 },
    { id: 4, name: 'RAL Design', count: 1625 },
    { id: 5, name: 'Monicolor', count: 1400 },
    { id: 6, name: 'Symphony', count: 2436 },
  ];

  /* ---------- генерация набора цветов ---------- */
  function hsl2rgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return '#' + to(f(0)) + to(f(8)) + to(f(4));
  }
  const colours = [];
  let cid = 1;
  // имена подбираются по светлоте цвета, чтобы не было «Снежно-белый» на тёмном
  const nameBuckets = [
    ['Рубин', 'Бордо', 'Индиго', 'Шоколад', 'Графит', 'Антрацит', 'Хаки', 'Тёмный изумруд'],      // тёмные
    ['Охра', 'Терракота', 'Коралл', 'Бирюза', 'Олива', 'Сирень', 'Стальной', 'Кирпичный'],         // средние
    ['Ваниль', 'Песочный', 'Капучино', 'Лосось', 'Мятный', 'Небесный', 'Лаванда', 'Фисташка'],     // светлые
    ['Снежно-белый', 'Слоновая кость', 'Крем', 'Пудра', 'Тёплый белый', 'Шёлк', 'Жемчуг'],          // очень светлые
  ];
  const nameFor = (rgb, i) => {
    const l = lumRaw(rgb);
    const b = l < 0.33 ? 0 : l < 0.6 ? 1 : l < 0.82 ? 2 : 3;
    return nameBuckets[b][i % nameBuckets[b].length];
  };
  function lumRaw(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; }
  // фирменные коды вида «00YY 18/346»
  const hueTags = ['00YY', '10YY', '20YR', '30RR', '40RB', '50BB', '60BG', '70GG', '80GY', '90YY'];
  for (let i = 0; i < 300; i++) {
    const h = (i * 37) % 360;
    const s = 20 + (i % 8) * 10;
    const l = 30 + (i % 7) * 9;
    const rgb = hsl2rgb(h, s, l);
    const tag = hueTags[i % hueTags.length];
    const code = `${tag} ${String(10 + (i % 80)).padStart(2, '0')}/${100 + ((i * 13) % 800)}`;
    const name = nameFor(rgb, i);
    const card = cards[i % cards.length].id;
    const card2 = cards[(i + 2) % cards.length].id;
    colours.push({ id: cid++, code, name, rgb, cards: i % 3 === 0 ? [card, card2] : [card] });
  }
  // несколько «настоящих» кодов для узнаваемости
  [
    ['RAL 9010', 'Чисто-белый', '#f1ece1', 3],
    ['RAL 9016', 'Транспортный белый', '#f1f0ea', 3],
    ['RAL 1015', 'Светлая слоновая кость', '#e6d2b5', 3],
    ['RAL 3020', 'Транспортный красный', '#bb1f10', 3],
    ['RAL 5010', 'Генциановый синий', '#0e4076', 3],
    ['RAL 6005', 'Зелёный мох', '#114232', 3],
    ['RAL 7016', 'Антрацитово-серый', '#383e42', 3],
    ['S 1050-Y90R', 'Алый', '#c23b2a', 2],
    ['S 0502-Y', 'Тёплый белый', '#eee7d8', 2],
    ['TVT 436L', 'Пыльная роза', '#c99a94', 1],
    ['00YY 18/346', 'Тёплый беж', '#d8c08a', 1],
  ].forEach(([code, name, rgb, card]) => colours.push({ id: cid++, code, name, rgb, cards: [card] }));
  const colourById = id => colours.find(c => c.id === +id);

  /* ---------- служебные расчёты цвета ---------- */
  function rgb2arr(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function lumOf(hex) { const [r, g, b] = rgb2arr(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function canLitres(code) { const m = String(code).match(/([\d.]+)/); return m ? parseFloat(m[1]) : 1; }

  // подбор паст под цвет → массив {code,rgb,ml,g,cost}
  function pastesFor(hex, volumeL, strength) {
    const [r, g, b] = rgb2arr(hex);
    const lum = lumOf(hex);
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    // доля пасты к объёму базы
    let frac = (1 - lum) * 0.03 + chroma * 0.035;
    frac = Math.max(0, Math.min(0.14, frac)) * (strength / 100);
    if (frac < 0.0015) return [];                        // почти чистая база
    const totalMl = frac * volumeL * 1000;
    // веса паст
    const w = {};
    const add = (c, v) => { if (v > 0) w[c] = (w[c] || 0) + v; };
    add('B', (1 - lum) * 0.9 + 0.05);
    add('Y', Math.max(0, (r + g) / 2 - b) / 255 * 1.4);
    add('OY', Math.max(0, (r * 0.8 + g * 0.5) - b) / 255 * 0.5);
    add('R', Math.max(0, r - (g + b) / 2) / 255 * 1.3);
    add('OR', Math.max(0, r - g) / 255 * 0.4);
    add('M', Math.max(0, r - g) / 255 * 0.3 + Math.max(0, b - g) / 255 * 0.3);
    add('BL', Math.max(0, b - (r + g) / 2) / 255 * 1.3);
    add('G', Math.max(0, g - (r + b) / 2) / 255 * 1.2);
    // верхние 3-4 пасты
    const top = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, v]) => s + v, 0) || 1;
    return top.map(([code, v]) => {
      const ct = cntByCode[code];
      const ml = totalMl * v / sum;
      return { code, rgb: ct.rgb, ml, g: ml * ct.sg, cost: ml / 1000 * ct.price };
    }).filter(it => it.ml > 0.05);
  }

  function calcRecipe(p) {
    // принимаем и строчные (GET /api/calc), и заглавные (POST dispense/orders) ключи
    const g = (a, b) => p[a] !== undefined ? p[a] : p[b];
    const product = productById(g('product', 'Product'));
    const colour = colourById(g('colour', 'Colour'));
    if (!product || !colour) return { _status: 404 };
    const qty = Math.max(1, +g('qty', 'Qty') || 1);
    const strength = Math.min(300, Math.max(1, +g('strength', 'Strength') || 100));
    const cunit = g('cunit', 'CUnit');
    const lum = lumOf(colour.rgb);
    const base = product.bases.length > 1 ? (lum > 0.72 ? product.bases[0] : product.bases[product.bases.length - 1]) : product.bases[0];
    let canObj = base.cans.find(c => c.id === +g('can', 'Can')) || base.cans[0];
    const custom = +g('custom', 'Custom') || 0;
    let volumeL;
    if (custom > 0) {
      volumeL = cunit === 'g' ? custom / (base.sg * 1000) : custom / 1000;
      canObj = { id: 0, code: cunit === 'g' ? (custom + ' г') : (custom + ' мл'), gravimetric: cunit === 'g' };
    } else {
      volumeL = canLitres(canObj.code) * qty;
    }
    const items = pastesFor(colour.rgb, volumeL, strength);
    const no_tint = items.length === 0;
    const total_ml = items.reduce((s, it) => s + it.ml, 0);
    const total_g = items.reduce((s, it) => s + it.g, 0);
    const cost_cnt = items.reduce((s, it) => s + it.cost, 0);
    const fill_pct = volumeL > 0 ? total_ml / (volumeL * 1000) * 100 : 0;
    const max_fill_pct = base.maxfill * 100;
    const markup = +(state.settings.markup || 0);
    const cost_base = Math.round(volumeL * 1500);
    const price = Math.round((cost_cnt + cost_base) * (1 + markup / 100));
    const warnings = [];
    if (max_fill_pct && fill_pct > max_fill_pct) warnings.push('Превышен максимум пасты для базы — выберите более прозрачную базу.');
    return {
      colour: { code: colour.code, name: colour.name, rgb: colour.rgb, cards: colour.cards },
      card_names: (colour.cards || []).map(id => (cards.find(k => k.id === id) || {}).name).filter(Boolean),
      product: product.name,
      base: { code: base.code, liquid: base.liquid, cans: base.cans },
      can: canObj, qty, strength,
      items, total_ml, total_g, cost_cnt, cost_base, markup, price,
      fill_pct, max_fill_pct, volume_l: volumeL, no_tint, warnings,
    };
  }

  /* ---------- дозатор: канистры и задания ---------- */
  function freshCanisters() {
    return colorants.map((c, i) => ({
      position: i + 1, cnt_code: c.code, rgb: c.rgb,
      cur_level: [1800, 2100, 950, 1200, 1500, 700, 1650, 400, 900, 1750, 1100, 1300][i] || 1000,
      max_level: 2500, warn_level: 500, min_level: 0, enabled: true,
    })).concat([13, 14, 15, 16].map(pos => ({ position: pos, cnt_code: '', rgb: '#eee', cur_level: 0, max_level: 2500, warn_level: 500, min_level: 0, enabled: false })));
  }
  const dispenser = { backend: 'sim', canisters: freshCanisters() };
  function posOf(code) { const c = dispenser.canisters.find(x => x.cnt_code === code); return c ? c.position : null; }
  const jobs = {}; let jobSeq = 100;

  /* ---------- история колеровок (примеры) ---------- */
  function dstr(daysAgo, hh, mm) {
    const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hh, mm, 0, 0);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  let orderSeq = 1;
  const orders = [];
  function seedOrder(daysAgo, hh, mm, prodId, colourCode, canCode, qty, customer) {
    const product = productById(prodId);
    const colour = colours.find(c => c.code === colourCode) || colours[0];
    const base = product.bases[0];
    const canObj = base.cans.find(c => c.code === canCode) || base.cans[0];
    const r = calcRecipe({ product: prodId, colour: colour.id, can: canObj.id, qty, strength: 100 });
    orders.push({
      id: orderSeq++, created: dstr(daysAgo, hh, mm),
      product: product.name, product_id: prodId, base: r.base.code, can: r.can.code, qty,
      colour_id: colour.id, colour_code: colour.code, colour_name: colour.name, rgb: colour.rgb,
      card: (r.card_names || []).join(', '), strength: 100,
      total_ml: r.total_ml, total_g: r.total_g, price: r.price,
      customer: customer || '', comment: '',
      items: r.items.map(it => ({ code: it.code, rgb: it.rgb, g: it.g, ml: it.ml })),
    });
  }
  seedOrder(0, 10, 15, 1, 'RAL 3020', '2.7 l', 1, 'Магазин на Абая');
  seedOrder(0, 12, 40, 2, 'S 1050-Y90R', '0.9 l', 2, '');
  seedOrder(1, 9, 5, 1, 'RAL 5010', '9 l', 1, 'ТОО СтройКом');
  seedOrder(1, 16, 20, 3, 'RAL 7016', '9 l', 2, 'Частный');
  seedOrder(2, 11, 0, 2, '00YY 18/346', '2.7 l', 1, '');
  seedOrder(3, 14, 30, 1, 'RAL 6005', '2.7 l', 3, 'Дача');
  seedOrder(5, 10, 10, 5, 'RAL 9016', '0.9 kg', 4, 'Мебельный цех');
  seedOrder(8, 15, 45, 1, 'TVT 436L', '0.9 l', 1, '');
  orders.reverse();

  /* ---------- статус ---------- */
  const status = () => ({
    has_db: true,
    trial: null,
    license: { required: false },
    meta: { database: 'Arcobaleno', system: 'Arcobaleno', colours: String(colours.length),
      recipes: '48230', products: String(products.length), cards: String(cards.length),
      imported: '12 300', source_file: 'Arcobaleno.exe' },
    import: { running: false },
    installer_hint: 'C:\\Users\\kolorist\\Downloads\\Arcobaleno.exe',
  });

  /* ---------- маршрутизация ---------- */
  const json = (data, st) => ({ data, status: st || 200 });
  function route(path, method, q, body) {
    // settings
    if (path === '/api/settings') {
      if (method === 'POST') Object.assign(state.settings, body || {});
      return json(state.settings);
    }
    if (path === '/api/status') return json(status());
    if (path === '/api/catalog') return json({
      currency: CUR, cards, colorants, products,
      colour_count: colours.length,
      meta: status().meta,
    });
    if (path === '/api/colours') {
      const qq = (q.get('q') || '').trim();
      const card = +q.get('card') || 0;
      const limit = +q.get('limit') || 240;
      let mode = 'list', list = colours.slice();
      if (card) list = list.filter(c => (c.cards || []).includes(card));
      if (/^#?[0-9a-fA-F]{6}$/.test(qq)) {
        mode = 'hex';
        const [tr, tg, tb] = rgb2arr(qq[0] === '#' ? qq : '#' + qq);
        list = list.map(c => { const [r, g, b] = rgb2arr(c.rgb); return { ...c, de: Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2) / 4.41 }; })
          .sort((a, b) => a.de - b.de);
      } else if (qq) {
        const s = qq.toLowerCase();
        list = list.filter(c => c.code.toLowerCase().includes(s) || (c.name || '').toLowerCase().includes(s));
      }
      return json({ items: list.slice(0, limit), total: list.length, mode });
    }
    if (path === '/api/calc') {
      const r = calcRecipe(Object.fromEntries(q));
      if (r._status === 404) return json({ error: 'нет рецептуры' }, 404);
      return json(r);
    }
    // дозатор
    if (path === '/api/dispenser') {
      const d = dispenser; d.backend = state.settings.dispenser_backend || 'sim';
      const low = d.canisters.filter(c => c.cnt_code && c.cur_level <= c.warn_level).length;
      const names = { sim: 'Симулятор дозатора', corob: 'Машина Corob (E4G/E5G)', none: 'Дозатор выключен' };
      return json({
        backend: d.backend, ready: d.backend !== 'none',
        status: d.backend === 'none' ? 'выключен' : (names[d.backend] + ' готов'),
        low_count: low, canisters: d.backend === 'none' ? [] : d.canisters,
      });
    }
    if (path === '/api/dispenser/test') {
      const addr = (body && body.addr) || state.settings.corob_addr;
      return json({ ok: true, addr, ms: 7, message: `Контроллер отвечает на ${addr} (демо). Связь есть.` });
    }
    if (path === '/api/dispenser/autofill' || path === '/api/dispenser/import-machine') {
      dispenser.canisters = freshCanisters(); return json({ ok: true });
    }
    if (path === '/api/dispenser/canisters') {
      if (Array.isArray(body)) dispenser.canisters = body.map(c => ({ ...c, rgb: (cntByCode[c.cnt_code] || {}).rgb || '#eee' }));
      return json({ ok: true });
    }
    if (path === '/api/dispenser/maintain') {
      const id = ++jobSeq; jobs[id] = { id, kind: 'maintain', start: Date.now(), dur: 2500, status: 'running', progress: 0, message: 'Выполняется…' };
      return json(jobObj(id));
    }
    if (path === '/api/dispenser/dispense') {
      const r = calcRecipe(body || {});
      const id = ++jobSeq;
      jobs[id] = {
        id, kind: 'dispense', start: Date.now(), dur: 3200, status: 'running', progress: 0,
        rgb: r.colour.rgb, colour_code: r.colour.code, colour_name: r.colour.name,
        product: r.product, base: r.base.code,
        items: r.items.map(it => ({ code: it.code, rgb: it.rgb, position: posOf(it.code), target_ml: it.ml, actual_ml: 0, available: posOf(it.code) != null })),
      };
      return json(jobObj(id));
    }
    let m = path.match(/^\/api\/dispenser\/job\/(\d+)(\/abort)?$/);
    if (m) {
      const id = +m[1]; const j = jobs[id]; if (!j) return json({ error: 'нет задания' }, 404);
      if (m[2]) { j.status = 'aborted'; j.aborted = true; return json(jobObj(id)); }
      return json(jobObj(id));
    }
    if (path === '/api/dispenser/log') {
      return { status: 200, text: demoLog() };
    }
    if (path === '/api/dispenser/log/clear') return json({ ok: true });
    // заказы
    if (path === '/api/orders' && method === 'POST') {
      const r = calcRecipe(body || {});
      const id = orderSeq++;
      orders.unshift({
        id, created: new Date().toISOString().slice(0, 19).replace('T', ' '),
        product: r.product, product_id: +body.Product, base: r.base.code, can: r.can.code, qty: r.qty,
        colour_id: +body.Colour, colour_code: r.colour.code, colour_name: r.colour.name, rgb: r.colour.rgb,
        card: (r.card_names || []).join(', '), strength: r.strength,
        total_ml: r.total_ml, total_g: r.total_g, price: r.price,
        customer: body.Customer || '', comment: body.Comment || '',
        items: r.items.map(it => ({ code: it.code, rgb: it.rgb, g: it.g, ml: it.ml })),
      });
      return json({ id });
    }
    if (path === '/api/orders') {
      const from = q.get('from'), to = q.get('to'), s = (q.get('q') || '').toLowerCase();
      let list = orders.slice();
      if (from) list = list.filter(o => o.created.slice(0, 10) >= from);
      if (to) list = list.filter(o => o.created.slice(0, 10) <= to);
      if (s) list = list.filter(o => (o.colour_code + o.colour_name + o.product + o.customer).toLowerCase().includes(s));
      return json(list);
    }
    m = path.match(/^\/api\/orders\/(\d+)$/);
    if (m) {
      const id = +m[1];
      if (method === 'DELETE') { const i = orders.findIndex(o => o.id === id); if (i >= 0) orders.splice(i, 1); return json({ ok: true }); }
      const o = orders.find(o => o.id === id); return o ? json(o) : json({ error: 'нет записи' }, 404);
    }
    // статистика
    if (path === '/api/stats') return json(statsData());
    // справочники: цены
    if (path === '/api/price/base') { if (method === 'POST') return json({ ok: true }); return json({}); }
    if (path === '/api/price/colorant') return json({ ok: true });
    // лицензия (в прототипе не требуется)
    if (path === '/api/license/activate') return json({ required: false, valid: true });
    // импорт (в прототипе база уже «загружена»)
    if (path === '/api/import/status') return json({ running: false, done: true });
    if (path === '/api/import/path') return json({ ok: true });
    return json({ error: 'не найдено' }, 404);
  }

  function jobObj(id) {
    const j = jobs[id];
    const el = Date.now() - j.start;
    if (!j.aborted) {
      j.progress = Math.min(100, Math.round(el / j.dur * 100));
      if (j.progress >= 100) { j.status = 'done'; j.message = j.kind === 'dispense' ? 'Готово. Снимите банку.' : 'Готово.'; }
      else j.message = j.kind === 'dispense' ? 'Дозирование…' : 'Выполняется…';
    }
    const out = { id: j.id, kind: j.kind, status: j.status, progress: j.aborted ? j.progress : j.progress, message: j.status === 'aborted' ? 'Прервано' : j.message,
      rgb: j.rgb, colour_code: j.colour_code, colour_name: j.colour_name, product: j.product, base: j.base };
    if (j.kind === 'dispense') out.items = j.items.map(it => ({ ...it, actual_ml: j.status === 'done' ? it.target_ml : it.target_ml * (j.progress / 100) }));
    return out;
  }

  function statsData() {
    const byCnt = {}, byCol = {}, byProd = {};
    orders.forEach(o => {
      (o.items || []).forEach(it => { byCnt[it.code] = byCnt[it.code] || { key: it.code, ml: 0, g: 0 }; byCnt[it.code].ml += it.ml; byCnt[it.code].g += it.g; });
      byCol[o.colour_code] = byCol[o.colour_code] || { key: o.colour_code, count: 0, extra: o.rgb }; byCol[o.colour_code].count++;
      byProd[o.product] = byProd[o.product] || { key: o.product, count: 0, extra: 0 }; byProd[o.product].count++; byProd[o.product].extra += o.qty;
    });
    const litres = orders.reduce((s, o) => s + canLitres(o.can) * o.qty * (/kg/i.test(o.can) ? 0 : 1), 0);
    const kg = orders.reduce((s, o) => s + (/kg/i.test(o.can) ? canLitres(o.can) * o.qty : 0), 0);
    return {
      currency: CUR, orders: orders.length, cans: orders.reduce((s, o) => s + o.qty, 0),
      litres, kg, revenue: orders.reduce((s, o) => s + (o.price || 0), 0),
      cost_cnt: orders.reduce((s, o) => s + (o.items || []).reduce((a, it) => a + it.ml / 1000 * (cntByCode[it.code] || { price: 0 }).price, 0), 0),
      colorants: Object.values(byCnt).sort((a, b) => b.ml - a.ml),
      colours: Object.values(byCol).sort((a, b) => b.count - a.count).slice(0, 10),
      products: Object.values(byProd).sort((a, b) => b.count - a.count),
    };
  }

  function demoLog() {
    return `[демо] Журнал обмена с машиной Corob
В реальной программе здесь построчно пишется каждый запрос к дозатору и его ответ
(с датой и временем), а также результат проверки связи и дозирования.

Пример записи:
[2026-10-30 16:17:40.499] ЧТЕНИЕ GET_DISP_STATUS [EXEC_B]
  ЗАПРОС:  <methodCall><methodName>EXEC_B</methodName> … GET_DISP_STATUS …
  ОТВЕТ:   HTTP 200 | ret_code=0 · disp_status: can_present=1, emergency=0

Файл журнала лежит рядом с программой: data\\corob.log — его можно сохранить и прислать.`;
  }

  /* ---------- перехват fetch ---------- */
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  window.fetch = async function (url, opts) {
    const u = String(url);
    if (u.startsWith('/api/') || u.includes('/api/')) {
      await delay(50);
      const parsed = new URL(u, location.origin);
      const method = (opts && opts.method) || 'GET';
      let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch { body = null; }
      const r = route(parsed.pathname, method, parsed.searchParams, body);
      if (r.text !== undefined) return new Response(r.text, { status: r.status, headers: { 'Content-Type': 'text/plain' } });
      return new Response(JSON.stringify(r.data ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch ? origFetch(url, opts) : Promise.reject(new Error('fetch недоступен'));
  };
})();
