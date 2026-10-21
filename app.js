'use strict';

// Lieferanten: der Schlüssel (key) darf sich nie ändern, der Name schon.
// color = Farbe der Handy-Statusleiste
const SUPPLIERS = [
  { key: 'lekkerland', name: 'Lekkerland', color: '#e03131' },
  { key: 'tabacon', name: 'Tabacon', color: '#1c7ed6' },
];
const VERSION = '3.0';
const STORAGE_KEY = 'bestellapp';
const PHOTO_MAX = 480; // längste Bildkante in Pixeln, hält die Fotos klein
const BACKUP_DAYS = 7; // so alt darf die letzte Sicherung sein, bevor die App daran erinnert
const SNAPSHOT_DAYS = 7; // Abstand der automatischen Wiederherstellungspunkte
const SNAPSHOT_KEEP = 4;
const EMOJIS = ['🥐', '🍞', '🥨', '🍰', '🧊', '🥤', '🧃', '⚡', '🍺', '🍷', '🍫', '🍬', '🍭', '🥜', '🍦', '🚬', '🔥', '🎟️', '📰', '🧴', '🧻', '🔋', '🛒', '📦'];

const $ = sel => document.querySelector(sel);
const main = $('#main');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const byName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true });
const buzz = () => navigator.vibrate && navigator.vibrate(12);
const isProduct = e => e.kind === 'product';
const isSection = e => e.kind === 'section';
const sectionLabel = s => (s.emoji ? `<span class="emoji">${esc(s.emoji)}</span>` : '') + esc(s.name);
const fmtDateTime = ts => new Date(ts).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const TRASH = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

// ---------- Zustand (localStorage) ----------
// route:  der Laufweg durch den Laden, gemeinsam für alle Lieferanten. Er enthält Abschnitte
//         { id, kind: 'section', name, emoji } und Produkte
//         { id, kind: 'product', name, photo, soll, sup: { lekkerland: true, … }, count: { lekkerland: 0, … } }.
// orders: je Lieferant { started, done: { produktId: Menge beim Abhaken } }. Die Bestellliste selbst sind alle
//         Produkte mit Zähler > 0; abgehakt ist ein Produkt, solange seine Menge noch der beim Abhaken entspricht.
// tasks:  eigene Aufgaben { items: [{ id, title, repeat, date, weekday, shift, created }], done: { "JJJJ-MM-TT": [ids] } },
//         siehe aufgaben.js.

const emptyOrder = () => ({ started: null, done: {} });

function emptyState() {
  const s = {
    v: 3, route: [], orders: {}, tasks: { items: [], done: {} },
    ui: { mode: 'tasks', supplier: SUPPLIERS[0].key, view: 'count', scroll: {}, lastBackup: null, newSup: null },
  };
  for (const sup of SUPPLIERS) s.orders[sup.key] = emptyOrder();
  return s;
}

function normalizeTasks(t) {
  const out = { items: [], done: {} };
  if (!t || typeof t !== 'object') return out;
  for (const x of Array.isArray(t.items) ? t.items : []) {
    if (!x || !x.id || !x.title) continue;
    out.items.push({
      id: String(x.id),
      title: String(x.title),
      repeat: ['once', 'weekly', 'workdays', 'daily'].includes(x.repeat) ? x.repeat : 'once',
      date: x.date ? String(x.date) : null,
      weekday: Number.isInteger(x.weekday) ? x.weekday : null,
      shift: ['frueh', 'spaet'].includes(x.shift) ? x.shift : 'any',
      created: x.created ? String(x.created) : null,
    });
  }
  for (const [k, ids] of Object.entries(t.done || {})) if (Array.isArray(ids) && ids.length) out.done[k] = ids.map(String);
  return out;
}

function normalizeOrder(o, route, k) {
  const order = emptyOrder();
  if (!o || typeof o !== 'object') return order;
  if (Array.isArray(o.items)) {
    // Bis Version 2.1 war die Bestellliste eine feste Kopie und die Zähler standen danach auf 0
    order.started = Number.isFinite(o.created) ? o.created : null;
    for (const it of o.items) {
      const p = route.find(e => isProduct(e) && e.id === it.id);
      if (!p || p.count[k] > 0) continue;
      p.sup[k] = true;
      p.count[k] = Math.max(0, parseInt(it.count, 10) || 0);
      if (it.done) order.done[p.id] = p.count[k];
    }
    return order;
  }
  order.started = Number.isFinite(o.started) ? o.started : null;
  for (const [id, n] of Object.entries(o.done || {})) if (Number.isInteger(n)) order.done[id] = n;
  return order;
}

function fixEntry(e) {
  if (e.kind === 'section') return { id: e.id, kind: 'section', name: String(e.name || ''), emoji: String(e.emoji || '').slice(0, 8) };
  const p = { id: e.id, kind: 'product', name: String(e.name || ''), photo: !!e.photo, soll: null, sup: {}, count: {} };
  if (Number.isInteger(e.soll) && e.soll >= 0) p.soll = e.soll;
  for (const s of SUPPLIERS) {
    p.sup[s.key] = !!(e.sup && e.sup[s.key]);
    p.count[s.key] = Math.max(0, parseInt(e.count && e.count[s.key], 10) || 0);
  }
  return p;
}

// Version 1 hatte zwei getrennte Listen. Gleichnamige Produkte werden zu einem zusammengelegt.
function migrateV1(suppliers) {
  const route = [];
  const seen = new Map();
  for (const sup of SUPPLIERS) {
    for (const old of (suppliers[sup.key] && suppliers[sup.key].products) || []) {
      const key = String(old.name).trim().toLowerCase();
      let p = seen.get(key);
      if (!p) {
        p = fixEntry({ id: old.id, kind: 'product', name: old.name, photo: old.photo });
        route.push(p);
        seen.set(key, p);
      } else if (!p.photo && old.photo) {
        p.id = old.id; // Foto des anderen Eintrags übernehmen
        p.photo = true;
      }
      p.sup[sup.key] = true;
      p.count[sup.key] = Math.max(0, parseInt(old.count, 10) || 0);
    }
  }
  return route;
}

function normalize(s) {
  s = s && typeof s === 'object' ? s : {};
  const base = emptyState();
  const out = { v: 3, route: [], orders: {}, ui: Object.assign(base.ui, s.ui) };
  if (Array.isArray(s.route)) out.route = s.route.filter(e => e && e.id).map(fixEntry);
  else if (s.suppliers) out.route = migrateV1(s.suppliers);
  for (const sup of SUPPLIERS) {
    const o = s.orders ? s.orders[sup.key] : s.suppliers && s.suppliers[sup.key] && s.suppliers[sup.key].order;
    out.orders[sup.key] = normalizeOrder(o, out.route, sup.key);
  }
  out.tasks = normalizeTasks(s.tasks);
  if (out.ui.mode !== 'order') out.ui.mode = 'tasks';
  if (!SUPPLIERS.some(x => x.key === out.ui.supplier)) out.ui.supplier = SUPPLIERS[0].key;
  if (out.ui.view !== 'order') out.ui.view = 'count';
  if (!out.ui.scroll || typeof out.ui.scroll !== 'object') out.ui.scroll = {};
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // Alten Stand aufheben, bevor er in den gemeinsamen Laufweg umgebaut wird
      if (s && !Array.isArray(s.route) && s.suppliers && !localStorage.getItem(STORAGE_KEY + '-v1')) {
        localStorage.setItem(STORAGE_KEY + '-v1', raw);
      }
      return normalize(s);
    }
  } catch (e) {
    console.error(e);
  }
  return emptyState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Speichern hat nicht geklappt: ' + e.message);
  }
}

let state = loadState();
state.ui.mode = 'tasks'; // die App startet immer bei den Aufgaben von heute
let editing = false;
let search = '';
const supName = () => SUPPLIERS.find(s => s.key === state.ui.supplier).name;
const orderItems = k => state.route.filter(e => isProduct(e) && e.sup[k] && e.count[k] > 0).sort(byName);
const isDone = (p, k) => state.orders[k].done[p.id] === p.count[k];

// Was der aktuelle Lieferant beim Durchgehen sieht: seine Produkte und die Abschnitte, in denen welche stehen
function visibleRoute(k) {
  const out = [];
  let pendingSection = null;
  for (const e of state.route) {
    if (isSection(e)) pendingSection = e;
    else if (e.sup[k]) {
      if (pendingSection) out.push(pendingSection);
      pendingSection = null;
      out.push(e);
    }
  }
  return out;
}

// ---------- IndexedDB: Fotos (Schlüssel = Produkt-ID) und Wiederherstellungspunkte (Schlüssel = Zeitpunkt) ----------

let dbPromise;
function db() {
  return dbPromise || (dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('bestellapp-fotos', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('fotos')) r.result.createObjectStore('fotos');
      if (!r.result.objectStoreNames.contains('punkte')) r.result.createObjectStore('punkte');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function writeTx(store, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    fn(tx.objectStore(store));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const putPhoto = (id, blob) => writeTx('fotos', s => s.put(blob, id));
const deletePhoto = id => writeTx('fotos', s => s.delete(id));
const clearPhotos = () => writeTx('fotos', s => s.clear());

async function readAll(store) {
  const d = await db();
  return new Promise((res, rej) => {
    const map = new Map();
    const req = d.transaction(store).objectStore(store).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res(map);
      map.set(c.key, c.value);
      c.continue();
    };
    req.onerror = () => rej(req.error);
  });
}
const loadAllPhotos = () => readAll('fotos');

async function readKeys(store) {
  const d = await db();
  return new Promise((res, rej) => {
    const req = d.transaction(store).objectStore(store).getAllKeys();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const photoUrls = new Map();
function setPhotoUrl(id, blob) {
  if (photoUrls.has(id)) URL.revokeObjectURL(photoUrls.get(id));
  if (blob) photoUrls.set(id, URL.createObjectURL(blob));
  else photoUrls.delete(id);
}

async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden'));
      i.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Ohne Foto: Anfangsbuchstabe auf einer Farbe, die sich aus dem Namen ergibt
const hue = s => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7);
function thumb(p) {
  const url = p.photo && photoUrls.get(p.id);
  if (url) return `<span class="thumb"><img src="${url}" alt=""></span>`;
  const letter = esc((p.name || '?').trim().charAt(0).toUpperCase());
  return `<span class="thumb letter" style="--h:${hue(p.name)}">${letter}</span>`;
}

// ---------- Kopfzeile, Scrollposition, Abschnitts-Knöpfe ----------

// Die Titelzeile scrollt weg, der Rest der Kopfzeile bleibt stehen (--head = stehender Teil)
const header = $('.top');
new ResizeObserver(() => {
  const titleH = $('#titleRow').offsetHeight;
  document.documentElement.style.setProperty('--title-h', titleH + 'px');
  document.documentElement.style.setProperty('--head', header.offsetHeight - titleH + 'px');
}).observe(header);

const scrollKey = () => (state.ui.mode === 'tasks' ? 'tasks' : state.ui.supplier + ':' + state.ui.view);
let scrollTimer;
let chipFrame = 0;
addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    state.ui.scroll[scrollKey()] = Math.round(scrollY);
    save();
  }, 250);
  if (!chipFrame) chipFrame = requestAnimationFrame(() => { chipFrame = 0; markChip(); });
}, { passive: true });

function rememberScroll() {
  clearTimeout(scrollTimer);
  state.ui.scroll[scrollKey()] = Math.round(scrollY);
}

function renderChips() {
  const chips = $('#secChips');
  const route = editing ? state.route : visibleRoute(state.ui.supplier);
  const sections = state.ui.mode === 'order' && state.ui.view === 'count' && !search ? route.filter(isSection) : [];
  chips.hidden = !sections.length;
  chips.innerHTML = sections.map(s => `<button data-sec="${s.id}">${s.emoji ? esc(s.emoji) + ' ' : ''}${esc(s.name)}</button>`).join('');
  markChip();
}

// Hebt den Abschnitt hervor, in dem man gerade ist
function markChip() {
  const chips = $('#secChips');
  if (chips.hidden) return;
  let active = null;
  const limit = header.getBoundingClientRect().bottom + 30;
  for (const el of main.querySelectorAll('[id^="sec-"]')) {
    if (el.getBoundingClientRect().top <= limit) active = el.id.slice(4);
    else break;
  }
  for (const b of chips.children) {
    const on = b.dataset.sec === active;
    if (on === b.classList.contains('on')) continue;
    b.classList.toggle('on', on);
    if (on) chips.scrollLeft = b.offsetLeft - (chips.clientWidth - b.offsetWidth) / 2;
  }
}

$('#secChips').addEventListener('click', e => {
  const b = e.target.closest('[data-sec]');
  const target = b && document.getElementById('sec-' + b.dataset.sec);
  if (target) target.scrollIntoView({ block: 'start' });
});

// ---------- Anzeige ----------

function render() {
  const tasks = state.ui.mode === 'tasks';
  document.body.dataset.mode = state.ui.mode;
  document.body.dataset.sup = state.ui.supplier;
  for (const b of document.querySelectorAll('[data-mode-tab]')) b.setAttribute('aria-current', b.dataset.modeTab === state.ui.mode ? 'page' : 'false');
  $('#appTitle').textContent = tasks ? 'Aufgaben' : 'Bestellung';
  document.querySelector('meta[name=theme-color]').content = tasks ? TASKS_COLOR : SUPPLIERS.find(s => s.key === state.ui.supplier).color;
  main.classList.remove('enter');
  void main.offsetWidth; // Einblend-Animation neu starten
  main.classList.add('enter');
  if (tasks) {
    renderChips();
    renderTasks();
    scrollTo(0, 0);
    return;
  }
  updateTaskBadge();
  for (const b of document.querySelectorAll('[data-sup-tab]')) b.setAttribute('aria-selected', b.dataset.supTab === state.ui.supplier);
  for (const b of document.querySelectorAll('[data-view-tab]')) b.setAttribute('aria-selected', b.dataset.viewTab === state.ui.view);
  if (state.ui.view === 'order') renderOrder();
  else renderCount();
  scrollTo(0, state.ui.scroll[scrollKey()] || 0);
  markChip();
}

function updateBadges() {
  const k = state.ui.supplier;
  const items = orderItems(k);
  $('#badgeCount').textContent = items.length || '';
  $('#badgeOrder').textContent = items.filter(p => !isDone(p, k)).length || '';
}

function countSummary() {
  const k = state.ui.supplier;
  const products = state.route.filter(e => isProduct(e) && e.sup[k]);
  return `${products.length} Produkte · <b>${products.filter(p => p.count[k] > 0).length}</b> ausgewählt`;
}

function backupNotice() {
  if (!state.route.some(isProduct)) return '';
  const last = state.ui.lastBackup;
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  if (days !== null && days < BACKUP_DAYS) return '';
  return `<div class="notice"><span>${days === null ? 'Noch keine Sicherung gespeichert.' : `Letzte Sicherung vor ${days} Tagen.`}</span>
    <button class="btn small" data-act="backup">Jetzt sichern</button></div>`;
}

function renderCount() {
  const k = state.ui.supplier;
  updateBadges();
  if (!state.route.length) {
    main.innerHTML = `<div class="empty">
      <div class="empty-icon">🛒</div>
      <p>Es sind noch keine Produkte angelegt.</p>
      <p>Leg sie in der Reihenfolge an, in der du durch den Laden läufst. Bei jedem Produkt wählst du, bei welchem Lieferanten es bestellt wird.</p>
      <button class="btn primary big" data-act="add">+ Erstes Produkt anlegen</button>
      <button class="btn big" data-act="add-section">+ Mit einem Abschnitt beginnen</button></div>`;
    renderChips();
    return;
  }
  if (!editing && !state.route.some(e => isProduct(e) && e.sup[k])) {
    main.innerHTML = `<div class="empty">
      <div class="empty-icon">📦</div>
      <p>Bei <b>${esc(supName())}</b> ist noch kein Produkt dabei.</p>
      <p>Tippe auf „Bearbeiten“, öffne ein Produkt und setze den Haken bei ${esc(supName())}.</p>
      <button class="btn primary big" data-act="toggle-edit">✎ Bearbeiten</button></div>`;
    renderChips();
    return;
  }
  main.innerHTML = `${backupNotice()}
    <div class="bar">
      <div class="bar-text" id="countText">${editing ? 'Laufweg für alle Lieferanten. Tippe einen Eintrag an, um ihn zu ändern.' : countSummary()}</div>
      <button class="btn small${editing ? ' primary' : ''}" data-act="toggle-edit">${editing ? 'Fertig' : '✎ Bearbeiten'}</button>
    </div>
    <div class="search">
      <input id="search" placeholder="Produkt suchen" value="${esc(search)}" autocomplete="off" enterkeyhint="search">
      <button class="clear" data-act="clear-search" aria-label="Suche leeren"${search ? '' : ' hidden'}>×</button>
    </div>
    <ul class="list" id="list"></ul>
    ${editing
      ? '<div class="add-btns"><button class="btn big" data-act="add">+ Produkt</button><button class="btn big" data-act="add-section">+ Abschnitt</button></div>'
      : '<button class="btn primary big confirm" data-act="to-order">Zur Bestellliste →</button>'}`;
  renderList();
}

function renderList() {
  const k = state.ui.supplier;
  const route = editing ? state.route : visibleRoute(k);
  const q = search.trim().toLowerCase();
  const items = q ? route.filter(e => isProduct(e) && e.name.toLowerCase().includes(q)) : route;
  const pos = new Map(state.route.map((e, i) => [e, i]));
  $('#list').innerHTML = items.length
    ? items.map(e => editing ? editRow(e, pos.get(e), state.route.length) : isSection(e) ? sectionHeading(e) : countRow(e, k)).join('')
    : '<li class="none">Nichts gefunden.</li>';
  main.querySelector('[data-act=clear-search]').hidden = !search;
  renderChips();
}

const sectionHeading = s => `<li class="sec" id="sec-${s.id}">${sectionLabel(s)}</li>`;

function countRow(p, k) {
  const pills = (p.soll !== null ? `<small class="soll">Soll ${p.soll}</small>` : '')
    + (p.count[k] && isDone(p, k) ? '<small class="entered">✓ eingegeben</small>' : '');
  return `
  <li class="row${p.count[k] ? ' on' : ''}" data-id="${p.id}">
    ${thumb(p)}<span class="name">${esc(p.name)}${pills ? `<span class="pills">${pills}</span>` : ''}</span>
    <span class="stepper">
      <button class="step" data-act="minus" aria-label="1 weniger"${p.count[k] ? '' : ' disabled'}>−1</button>
      <output class="count">${p.count[k]}</output>
      <button class="step plus" data-act="plus" aria-label="1 mehr">+1</button>
    </span>
  </li>`;
}

function editRow(e, i, n) {
  const tools = `
    <button class="step" data-act="up" aria-label="nach oben"${i ? '' : ' disabled'}>▲</button>
    <button class="step" data-act="down" aria-label="nach unten"${i < n - 1 ? '' : ' disabled'}>▼</button>
    <button class="step del" data-act="delete" aria-label="löschen">${TRASH}</button>`;
  if (isSection(e)) {
    return `<li class="row edit section" id="sec-${e.id}" data-id="${e.id}">
      <span class="pos">${i + 1}</span><button class="rowbtn" data-act="open"><span class="name">${sectionLabel(e)}</span></button>${tools}</li>`;
  }
  const tags = SUPPLIERS.filter(s => e.sup[s.key]).map(s => `<span class="tag tag-${s.key}">${esc(s.name)}</span>`).join('');
  const soll = e.soll !== null ? `<span>Soll ${e.soll}</span>` : '';
  return `<li class="row edit" data-id="${e.id}">
    <span class="pos">${i + 1}</span>
    <button class="rowbtn" data-act="open">${thumb(e)}<span class="name">${esc(e.name)}<small class="meta">${soll}${tags}</small></span></button>${tools}</li>`;
}

function renderOrder() {
  const k = state.ui.supplier;
  const o = state.orders[k];
  const items = orderItems(k);
  updateBadges();
  renderChips();
  if (!items.length) {
    main.innerHTML = `<div class="empty">
      <div class="empty-icon">📝</div>
      <p>Die Bestellliste für <b>${esc(supName())}</b> ist leer.</p>
      <p>Tippe unter „Durchgehen“ bei den Produkten auf +1. Sie erscheinen dann hier automatisch, alphabetisch sortiert.</p></div>`;
    return;
  }
  main.innerHTML = `
    <div class="bar">
      <div class="bar-text">${o.started ? `Begonnen ${orderDate(o.started)}<br>` : ''}<span id="doneText"></span></div>
      <button class="btn small" data-act="share">Teilen</button>
    </div>
    <div class="progress"><span id="doneBar"></span></div>
    <ul class="list">${items.map(p => orderRow(p, k)).join('')}</ul>
    <p class="alldone" id="allDone" hidden>Alles eingegeben ✓</p>
    <button class="btn big ghost" data-act="clear-order">Bestellliste löschen</button>`;
  updateOrderProgress();
}

function orderRow(p, k) {
  const checked = state.orders[k].done[p.id];
  const done = checked === p.count[k];
  const changed = checked !== undefined && !done;
  return `
    <li><button class="orow${done ? ' done' : ''}" role="checkbox" aria-checked="${done}" data-act="check" data-id="${p.id}">
      <span class="qty">${p.count[k]}×</span>
      <span class="name">${esc(p.name)}${changed ? `<small class="changed">geändert, vorher ${checked}×</small>` : ''}</span>
      <span class="box"></span>
    </button></li>`;
}

const orderDate = ts => new Date(ts).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function updateOrderProgress() {
  const k = state.ui.supplier;
  const items = orderItems(k);
  const done = items.filter(p => isDone(p, k)).length;
  $('#doneText').innerHTML = `<b>${done}</b> von ${items.length} eingegeben`;
  $('#doneBar').style.width = (items.length ? 100 * done / items.length : 0) + '%';
  $('#allDone').hidden = done < items.length;
  updateBadges();
}

// ---------- Aktionen ----------

function changeCount(id, delta, li) {
  const k = state.ui.supplier;
  const p = state.route.find(x => x.id === id);
  if (!p) return;
  p.count[k] = Math.max(0, p.count[k] + delta);
  const o = state.orders[k];
  if (!p.count[k]) delete o.done[p.id];
  if (delta > 0 && !o.started) o.started = Date.now();
  if (!orderItems(k).length) state.orders[k] = emptyOrder();
  save();
  buzz();
  li.outerHTML = countRow(p, k);
  main.querySelector(`[data-id="${id}"] .count`).classList.add('pop');
  $('#countText').innerHTML = countSummary();
  updateBadges();
}

function move(id, delta) {
  const route = state.route;
  const i = route.findIndex(e => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= route.length) return;
  [route[i], route[j]] = [route[j], route[i]];
  save();
  renderCount();
  main.querySelector(`[data-id="${id}"]`).classList.add('moved');
}

async function goToOrder() {
  if (!orderItems(state.ui.supplier).length) {
    await ask({ title: 'Noch nichts ausgewählt', text: 'Tippe bei den Produkten, die bestellt werden sollen, auf +1.', yes: 'OK', no: null });
    return;
  }
  rememberScroll();
  state.ui.view = 'order';
  search = '';
  save();
  render();
}

function toggleDone(id, btn) {
  const k = state.ui.supplier;
  const p = state.route.find(e => e.id === id);
  if (!p) return;
  const done = !isDone(p, k);
  if (done) state.orders[k].done[id] = p.count[k];
  else delete state.orders[k].done[id];
  save();
  buzz();
  btn.parentElement.outerHTML = orderRow(p, k);
  if (done) main.querySelector(`[data-id="${id}"]`).classList.add('just');
  updateOrderProgress();
  if (done && orderItems(k).every(x => isDone(x, k))) confetti();
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = devicePixelRatio || 1;
  const w = innerWidth, h = innerHeight;
  c.width = w * dpr;
  c.height = h * dpr;
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const colors = [getComputedStyle(document.body).getPropertyValue('--accent').trim(), '#ffd43b', '#51cf66', '#4dabf7', '#f783ac', '#ff922b'];
  const parts = Array.from({ length: 150 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * 100,
    y: h * 0.7,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 15 - 7,
    w: 6 + Math.random() * 6,
    h: 9 + Math.random() * 8,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  requestAnimationFrame(function frame(t) {
    g.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 0.38;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (t - start < 3200) requestAnimationFrame(frame);
    else c.remove();
  });
}

async function clearOrder() {
  const k = state.ui.supplier;
  if (!await ask({
    title: 'Bestellliste löschen?',
    text: `Alle Zähler für ${supName()} gehen auf 0 und die Haken verschwinden. Mach das, wenn die Bestellung abgeschickt ist.`,
    yes: 'Löschen',
    no: 'Abbrechen',
    danger: true,
  })) return;
  for (const e of state.route) if (isProduct(e)) e.count[k] = 0;
  state.orders[k] = emptyOrder();
  state.ui.scroll[k + ':count'] = 0;
  state.ui.scroll[k + ':order'] = 0;
  state.ui.view = 'count';
  save();
  render();
}

async function shareOrder() {
  const k = state.ui.supplier;
  const o = state.orders[k];
  const title = `Bestellung ${supName()}`;
  const text = title + (o.started ? ` (${orderDate(o.started)})` : '') + '\n'
    + orderItems(k).map(p => `${p.count[k]}× ${p.name}`).join('\n');
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // Teilen-Fenster wurde geschlossen
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    await ask({ title: 'Kopiert', text: 'Die Liste ist in der Zwischenablage. Du kannst sie jetzt z. B. in WhatsApp einfügen.', yes: 'OK', no: null });
  } catch {
    alert(text);
  }
}

main.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const li = btn.closest('[data-id]');
  const id = li && li.dataset.id;
  switch (btn.dataset.act) {
    case 'plus': return changeCount(id, 1, li);
    case 'minus': return changeCount(id, -1, li);
    case 'toggle-edit': editing = !editing; return renderCount();
    case 'add': editing = true; return openEntry(null, undefined, 'product');
    case 'add-section': editing = true; return openEntry(null, undefined, 'section');
    case 'open': return openEntry(id);
    case 'up': return move(id, -1);
    case 'down': return move(id, 1);
    case 'delete': return deleteEntry(id);
    case 'to-order': return goToOrder();
    case 'check': return toggleDone(id, btn);
    case 'clear-order': return clearOrder();
    case 'share': return shareOrder();
    case 'backup': return openMenu();
    case 'clear-search':
      search = '';
      $('#search').value = '';
      return renderList();
  }
});

main.addEventListener('input', e => {
  if (e.target.id !== 'search') return;
  search = e.target.value;
  renderList();
});

$('.sup-tabs').innerHTML = SUPPLIERS.map(s => `<button role="tab" data-sup-tab="${s.key}">${esc(s.name)}</button>`).join('');
$('.sup-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-sup-tab]');
  if (!b || b.dataset.supTab === state.ui.supplier) return;
  rememberScroll();
  state.ui.supplier = b.dataset.supTab;
  editing = false;
  search = '';
  save();
  render();
});
$('#modeNav').addEventListener('click', e => {
  const b = e.target.closest('[data-mode-tab]');
  if (!b || b.dataset.modeTab === state.ui.mode) return;
  rememberScroll();
  state.ui.mode = b.dataset.modeTab;
  editing = false;
  search = '';
  save();
  render();
});
$('.view-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view-tab]');
  if (!b || b.dataset.viewTab === state.ui.view) return;
  rememberScroll();
  state.ui.view = b.dataset.viewTab;
  editing = false;
  search = '';
  save();
  render();
});

// ---------- Sicherheitsabfrage ----------

function ask({ title, text, yes = 'Ja', no = 'Nein', danger = false }) {
  const d = $('#askDlg');
  $('#askTitle').textContent = title;
  $('#askText').textContent = text;
  $('#askYes').textContent = yes;
  $('#askYes').className = 'btn big ' + (danger ? 'danger' : 'primary');
  $('#askNo').textContent = no || '';
  $('#askNo').hidden = !no;
  d.returnValue = '';
  return new Promise(res => {
    d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
    d.showModal();
  });
}

// ---------- Produkt oder Abschnitt anlegen / bearbeiten ----------

const productDlg = $('#productDlg');
let pd = null; // { id, kind, photo }; photo: undefined = unverändert, Blob = neu, null = entfernen

// Position und Abschnitt im Fenster beziehen sich auf den Laufweg ohne den bearbeiteten Eintrag
const routeWithout = id => state.route.filter(e => e.id !== id);

function sectionBefore(route, index) {
  for (let i = Math.min(index, route.length) - 1; i >= 0; i--) if (isSection(route[i])) return route[i];
  return null;
}

function endOfSection(route, sectionId) {
  let i = route.findIndex(e => e.id === sectionId);
  if (i < 0) return route.length;
  for (i++; i < route.length && !isSection(route[i]); i++);
  return i;
}

function fillSectionSelect(route, index) {
  const current = sectionBefore(route, index);
  $('#pSec').innerHTML = (current ? '' : '<option value="">– vor dem ersten Abschnitt –</option>')
    + route.filter(isSection).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('#pSec').value = current ? current.id : '';
}

function openEntry(id, insertAt, kind = 'product') {
  const index = id ? state.route.findIndex(e => e.id === id) : -1;
  const e = index >= 0 ? state.route[index] : null;
  if (e) kind = e.kind;
  const isProd = kind === 'product';
  const rest = routeWithout(e && e.id);
  const at = e ? index : Math.min(insertAt ?? rest.length, rest.length);
  pd = { id: e ? e.id : null, kind, photo: undefined };

  $('#pTitle').textContent = isProd ? (e ? 'Produkt bearbeiten' : 'Neues Produkt') : (e ? 'Abschnitt bearbeiten' : 'Neuer Abschnitt');
  $('#pName').value = e ? e.name : '';
  $('#pName').placeholder = isProd ? 'z. B. Marlboro Rot 10 €' : 'z. B. Backwaren';
  $('#pPos').max = rest.length + 1;
  $('#pPos').value = at + 1;
  $('#pPosHint').textContent = isProd
    ? `1 = ganz vorne, ${rest.length + 1} = ganz hinten`
    : `1 = ganz vorne, ${rest.length + 1} = ganz hinten. Alles darunter gehört zu diesem Abschnitt.`;
  $('#pNameHint').hidden = true;
  $('#pSupHint').hidden = true;
  $('#pPhotoRow').hidden = !isProd;
  $('#pProductFields').hidden = !isProd;
  $('#pEmojiField').hidden = isProd;
  if (!isProd) pickEmoji(e ? e.emoji : '');
  if (isProd) {
    $('#pSoll').value = e && e.soll !== null ? e.soll : '';
    const sup = e ? e.sup : (state.ui.newSup || { [state.ui.supplier]: true });
    for (const cb of productDlg.querySelectorAll('[name=sup]')) cb.checked = !!sup[cb.value];
    $('#pSecField').hidden = !rest.some(isSection);
    fillSectionSelect(rest, at);
    showPhotoPreview();
  }
  productDlg.querySelector('[data-pact=delete]').hidden = !e;
  productDlg.querySelector('[data-pact=save-next]').hidden = !(isProd && !e);
  if (!productDlg.open) productDlg.showModal();
  productDlg.scrollTop = 0;
}

$('#pSup').innerHTML = SUPPLIERS.map(s => `<label class="chk"><input type="checkbox" name="sup" value="${s.key}">${esc(s.name)}</label>`).join('');

$('#pEmoji').innerHTML = ['', ...EMOJIS].map(em => `<button type="button" data-emoji="${em}" aria-label="${em || 'kein Symbol'}">${em || '–'}</button>`).join('');
function pickEmoji(emoji) {
  for (const b of $('#pEmoji').children) b.classList.toggle('on', b.dataset.emoji === emoji);
}
$('#pEmoji').addEventListener('click', e => {
  const b = e.target.closest('[data-emoji]');
  if (b) pickEmoji(b.dataset.emoji);
});

// Abschnitt gewählt: Produkt ans Ende dieses Abschnitts setzen
$('#pSec').addEventListener('change', () => {
  if (!pd || !$('#pSec').value) return;
  const rest = routeWithout(pd.id);
  const index = endOfSection(rest, $('#pSec').value);
  $('#pPos').value = index + 1;
  fillSectionSelect(rest, index);
});

// Position geändert: passenden Abschnitt anzeigen
$('#pPos').addEventListener('input', () => {
  if (!pd || pd.kind !== 'product') return;
  const pos = parseInt($('#pPos').value, 10);
  if (pos >= 1) fillSectionSelect(routeWithout(pd.id), pos - 1);
});

let previewUrl = null;
function showPhotoPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  let url = null;
  if (pd.photo instanceof Blob) url = previewUrl = URL.createObjectURL(pd.photo);
  else if (pd.photo === undefined && pd.id) {
    const p = state.route.find(x => x.id === pd.id);
    if (p && p.photo) url = photoUrls.get(p.id);
  }
  $('#pPhoto').innerHTML = url ? `<img src="${url}" alt="">` : '<span>Kein Foto</span>';
  productDlg.querySelector('[data-pact=rmphoto]').hidden = !url;
}

async function onPhotoPicked(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pd) return;
  try {
    pd.photo = await shrinkImage(file);
    showPhotoPreview();
  } catch (err) {
    alert(err.message);
  }
}
$('#camInput').addEventListener('change', onPhotoPicked);
$('#galInput').addEventListener('change', onPhotoPicked);

async function saveEntry(next) {
  const isProd = pd.kind === 'product';
  const name = $('#pName').value.trim().replace(/\s+/g, ' ');
  if (!name) {
    $('#pNameHint').hidden = false;
    $('#pName').focus();
    return;
  }
  let sup = null;
  if (isProd) {
    sup = {};
    for (const cb of productDlg.querySelectorAll('[name=sup]')) sup[cb.value] = cb.checked;
    if (!Object.values(sup).some(Boolean)) {
      $('#pSupHint').hidden = false;
      return;
    }
  }
  const route = state.route;
  let e, from = -1;
  if (pd.id) {
    from = route.findIndex(x => x.id === pd.id);
    e = route.splice(from, 1)[0];
    e.name = name;
  } else {
    e = fixEntry({ id: newId(), kind: pd.kind, name });
  }
  if (!isProd) {
    const on = $('#pEmoji .on');
    e.emoji = on ? on.dataset.emoji : '';
  }
  if (isProd) {
    for (const s of SUPPLIERS) {
      e.sup[s.key] = sup[s.key];
      if (!sup[s.key]) {
        e.count[s.key] = 0;
        delete state.orders[s.key].done[e.id];
      }
    }
    const soll = parseInt($('#pSoll').value, 10);
    e.soll = soll >= 0 ? soll : null;
    if (!pd.id) state.ui.newSup = sup; // beim nächsten neuen Produkt dieselben Haken vorschlagen
  }
  let pos = parseInt($('#pPos').value, 10);
  if (!(pos >= 1)) pos = from >= 0 ? from + 1 : route.length + 1;
  const idx = Math.min(pos - 1, route.length);
  route.splice(idx, 0, e);
  if (isProd) {
    try {
      if (pd.photo instanceof Blob) {
        await putPhoto(e.id, pd.photo);
        setPhotoUrl(e.id, pd.photo);
        e.photo = true;
      } else if (pd.photo === null && e.photo) {
        await deletePhoto(e.id);
        setPhotoUrl(e.id, null);
        e.photo = false;
      }
    } catch (err) {
      alert('Foto konnte nicht gespeichert werden: ' + err.message);
    }
  }
  save();
  renderCount();
  const row = main.querySelector(`[data-id="${e.id}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center' });
    row.classList.add('moved');
  }
  if (next) openEntry(null, idx + 1, 'product');
  else productDlg.close();
}

async function deleteEntry(id) {
  const i = state.route.findIndex(x => x.id === id);
  if (i < 0) return;
  const e = state.route[i];
  let text;
  if (isSection(e)) {
    text = `Die Überschrift „${e.name}“ wird entfernt. Die Produkte darunter bleiben erhalten.`;
  } else {
    const names = SUPPLIERS.filter(s => e.sup[s.key]).map(s => s.name);
    text = `„${e.name}“ wird gelöscht` + (names.length > 1
      ? `, und zwar bei ${names.join(' und ')}. Soll es nur bei einem Lieferanten wegfallen, öffne das Produkt und nimm dort den Haken raus.`
      : '.');
  }
  const title = isSection(e) ? 'Abschnitt löschen?' : 'Produkt löschen?';
  if (!await ask({ title, text, yes: 'Löschen', no: 'Abbrechen', danger: true })) return;
  state.route.splice(i, 1);
  for (const s of SUPPLIERS) delete state.orders[s.key].done[e.id];
  if (e.photo) {
    setPhotoUrl(e.id, null);
    deletePhoto(e.id).catch(console.error);
  }
  save();
  if (productDlg.open) productDlg.close();
  renderCount();
}

productDlg.addEventListener('click', e => {
  const b = e.target.closest('[data-pact]');
  if (!b) return;
  switch (b.dataset.pact) {
    case 'cam': return $('#camInput').click();
    case 'gal': return $('#galInput').click();
    case 'rmphoto': pd.photo = null; return showPhotoPreview();
    case 'cancel': return productDlg.close();
    case 'save': return saveEntry(false);
    case 'save-next': return saveEntry(true);
    case 'delete': return deleteEntry(pd.id);
  }
});
productDlg.addEventListener('close', () => { pd = null; });

// ---------- Sicherung ----------

const menuDlg = $('#menuDlg');
$('#versionText').textContent = 'Version ' + VERSION;

function showLastBackup() {
  $('#lastBackup').textContent = state.ui.lastBackup
    ? 'Letzte Sicherung: ' + new Date(state.ui.lastBackup).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Noch keine Sicherung gespeichert.';
}

function openMenu() {
  showLastBackup();
  renderSnapshots();
  menuDlg.showModal();
}

// ---------- Automatische Wiederherstellungspunkte ----------

const SNAPSHOT_REASONS = { weekly: 'automatisch', restore: 'vor dem Wiederherstellen', import: 'vor dem Laden einer Sicherung' };

async function takeSnapshot(reason) {
  const ids = new Set(state.route.filter(p => isProduct(p) && p.photo).map(p => p.id));
  const snap = { created: Date.now(), reason, route: state.route, orders: state.orders, tasks: state.tasks, photos: {} };
  for (const [id, blob] of await loadAllPhotos()) if (ids.has(id)) snap.photos[id] = blob;
  await writeTx('punkte', s => s.put(snap, snap.created));
  const old = (await readKeys('punkte')).sort((a, b) => b - a).slice(SNAPSHOT_KEEP);
  if (old.length) await writeTx('punkte', s => old.forEach(k => s.delete(k)));
}

async function weeklySnapshot() {
  if (!state.route.some(isProduct) && !state.tasks.items.length) return;
  const newest = Math.max(0, ...await readKeys('punkte'));
  if (Date.now() - newest >= SNAPSHOT_DAYS * 864e5) await takeSnapshot('weekly');
}

async function renderSnapshots() {
  const list = $('#snapList');
  try {
    const snaps = [...(await readAll('punkte')).values()].sort((a, b) => b.created - a.created);
    list.innerHTML = snaps.length
      ? snaps.map(s => `<button type="button" class="snap" data-snap="${s.created}">
          <span><b>${fmtDateTime(s.created)}</b><small>${s.route.filter(isProduct).length} Produkte · ${((s.tasks && s.tasks.items) || []).length} Aufgaben · ${SNAPSHOT_REASONS[s.reason] || ''}</small></span>
          <span class="go">Zurückholen</span></button>`).join('')
      : '<p class="hint">Noch keiner. Der erste entsteht automatisch, sobald Produkte angelegt sind.</p>';
  } catch (err) {
    list.innerHTML = `<p class="hint error">Konnte nicht gelesen werden: ${esc(err.message)}</p>`;
  }
}

async function replaceAll(route, orders, tasks, photos) {
  await clearPhotos();
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  photoUrls.clear();
  for (const [id, blob] of photos) {
    await putPhoto(id, blob);
    setPhotoUrl(id, blob);
  }
  state = normalize({ route, orders, tasks, ui: { ...state.ui, scroll: {} } });
  editing = false;
  search = '';
  save();
  menuDlg.close();
  render();
}

$('#snapList').addEventListener('click', async e => {
  const b = e.target.closest('[data-snap]');
  if (!b) return;
  const snap = (await readAll('punkte')).get(Number(b.dataset.snap));
  if (!snap) return;
  const n = snap.route.filter(isProduct).length;
  if (!await ask({
    title: 'Stand zurückholen?',
    text: `Die App springt zurück auf den Stand vom ${fmtDateTime(snap.created)} (${n} Produkte). Der jetzige Stand wird vorher selbst als Wiederherstellungspunkt gespeichert.`,
    yes: 'Zurückholen',
    no: 'Abbrechen',
  })) return;
  try {
    await takeSnapshot('restore');
    await replaceAll(snap.route, snap.orders, snap.tasks, Object.entries(snap.photos || {}));
  } catch (err) {
    alert('Zurückholen fehlgeschlagen: ' + err.message);
  }
});
$('#menuBtn').addEventListener('click', openMenu);
// Erinnerung oben ausblenden, sobald gesichert wurde
menuDlg.addEventListener('close', () => {
  if (state.ui.view === 'count' && main.querySelector('.notice') && !backupNotice()) main.querySelector('.notice').remove();
});

const blobToDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

$('#exportBtn').addEventListener('click', async () => {
  try {
    const photos = await loadAllPhotos();
    const out = { app: 'bestellapp', version: 3, exported: new Date().toISOString(), route: state.route, orders: state.orders, tasks: state.tasks, photos: {} };
    for (const [id, blob] of photos) out.photos[id] = await blobToDataUrl(blob);
    const file = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `bestellapp-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    state.ui.lastBackup = Date.now();
    save();
    showLastBackup();
  } catch (err) {
    alert('Sicherung fehlgeschlagen: ' + err.message);
  }
});

$('#importBtn').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!data || data.app !== 'bestellapp') throw new Error('Das ist keine Sicherung dieser App.');
  } catch (err) {
    alert('Sicherung kann nicht gelesen werden: ' + err.message);
    return;
  }
  // Sicherungen der alten Fassung (zwei Listen) werden dabei automatisch umgebaut
  const fresh = normalize({ route: data.route, suppliers: data.suppliers, orders: data.orders, tasks: data.tasks, ui: { ...state.ui, scroll: {} } });
  const n = fresh.route.filter(isProduct).length;
  const text = `Die Sicherung enthält ${n} Produkte und ${fresh.tasks.items.length} Aufgaben. Alles, was gerade in der App ist, wird dadurch ersetzt.`;
  if (!await ask({ title: 'Sicherung laden?', text, yes: 'Laden', no: 'Abbrechen', danger: true })) return;
  try {
    const photos = [];
    for (const [id, dataUrl] of Object.entries(data.photos || {})) photos.push([id, await (await fetch(dataUrl)).blob()]);
    if (state.route.some(isProduct) || state.tasks.items.length) await takeSnapshot('import');
    await replaceAll(fresh.route, fresh.orders, fresh.tasks, photos);
  } catch (err) {
    alert('Laden fehlgeschlagen: ' + err.message);
  }
});

// ---------- Start ----------

async function init() {
  save(); // hält einen eventuell umgebauten alten Stand sofort fest
  render();
  try {
    const photos = await loadAllPhotos();
    const ids = new Set(state.route.filter(isProduct).map(p => p.id));
    for (const [id, blob] of photos) {
      if (ids.has(id)) setPhotoUrl(id, blob);
      else deletePhoto(id).catch(console.error); // Foto eines gelöschten Produkts
    }
    // Fotos in die schon angezeigte Liste einsetzen, ohne die Scrollposition zu verändern
    if (photoUrls.size && state.ui.mode === 'order' && state.ui.view === 'count' && $('#list')) {
      const y = scrollY;
      renderList();
      scrollTo(0, y);
    }
    await weeklySnapshot();
  } catch (err) {
    console.error(err);
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
}
document.addEventListener('DOMContentLoaded', init); // erst wenn auch aufgaben.js geladen ist
