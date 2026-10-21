'use strict';

// Lieferanten: der Schlüssel (key) darf sich nie ändern, der Name schon.
const SUPPLIERS = [
  { key: 'lekkerland', name: 'Lekkerland' },
  { key: 'tabacon', name: 'Tabacon' },
];
const VERSION = '1.0';
const STORAGE_KEY = 'bestellapp';
const PHOTO_MAX = 480; // längste Bildkante in Pixeln, hält die Fotos klein

const $ = sel => document.querySelector(sel);
const main = $('#main');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const byName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true });
const buzz = () => navigator.vibrate && navigator.vibrate(12);

// ---------- Zustand: Produkte, Zähler, Bestelllisten (localStorage) ----------

function emptyState() {
  const s = { suppliers: {}, ui: { supplier: SUPPLIERS[0].key, view: 'count', scroll: {}, lastBackup: null } };
  for (const sup of SUPPLIERS) s.suppliers[sup.key] = { products: [], order: null };
  return s;
}

function normalize(s) {
  const base = emptyState();
  s = s && typeof s === 'object' ? s : {};
  const out = { suppliers: {}, ui: Object.assign(base.ui, s.ui) };
  for (const sup of SUPPLIERS) {
    const src = (s.suppliers && s.suppliers[sup.key]) || {};
    out.suppliers[sup.key] = {
      products: Array.isArray(src.products) ? src.products : [],
      order: src.order && Array.isArray(src.order.items) ? src.order : null,
    };
  }
  if (!out.suppliers[out.ui.supplier]) out.ui.supplier = SUPPLIERS[0].key;
  if (out.ui.view !== 'order') out.ui.view = 'count';
  if (!out.ui.scroll || typeof out.ui.scroll !== 'object') out.ui.scroll = {};
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
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
let editing = false;
const cur = () => state.suppliers[state.ui.supplier];
const supName = () => SUPPLIERS.find(s => s.key === state.ui.supplier).name;

// ---------- Fotos (IndexedDB, Schlüssel = Produkt-ID) ----------

let dbPromise;
function db() {
  return dbPromise || (dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('bestellapp-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function photoTx(fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('fotos', 'readwrite');
    fn(tx.objectStore('fotos'));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const putPhoto = (id, blob) => photoTx(s => s.put(blob, id));
const deletePhoto = id => photoTx(s => s.delete(id));
const clearPhotos = () => photoTx(s => s.clear());

async function loadAllPhotos() {
  const d = await db();
  return new Promise((res, rej) => {
    const map = new Map();
    const req = d.transaction('fotos').objectStore('fotos').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res(map);
      map.set(c.key, c.value);
      c.continue();
    };
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

function thumb(p) {
  const url = p.photo && photoUrls.get(p.id);
  const letter = esc((p.name || '?').trim().charAt(0).toUpperCase());
  return `<span class="thumb">${url ? `<img src="${url}" alt="">` : letter}</span>`;
}

// ---------- Scrollposition je Lieferant und Ansicht merken ----------

const scrollKey = () => state.ui.supplier + ':' + state.ui.view;
let scrollTimer;
addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    state.ui.scroll[scrollKey()] = Math.round(scrollY);
    save();
  }, 250);
}, { passive: true });

function rememberScroll() {
  clearTimeout(scrollTimer);
  state.ui.scroll[scrollKey()] = Math.round(scrollY);
}

// ---------- Anzeige ----------

function render() {
  document.body.dataset.sup = state.ui.supplier;
  for (const b of document.querySelectorAll('[data-sup-tab]')) b.setAttribute('aria-selected', b.dataset.supTab === state.ui.supplier);
  for (const b of document.querySelectorAll('[data-view-tab]')) b.setAttribute('aria-selected', b.dataset.viewTab === state.ui.view);
  if (state.ui.view === 'order') renderOrder();
  else renderCount();
  scrollTo(0, state.ui.scroll[scrollKey()] || 0);
}

function updateBadges() {
  const sup = cur();
  const counted = sup.products.filter(p => p.count > 0).length;
  const open = sup.order ? sup.order.items.filter(i => !i.done).length : 0;
  $('#badgeCount').textContent = counted || '';
  $('#badgeOrder').textContent = open || '';
}

function countSummary() {
  const sup = cur();
  const counted = sup.products.filter(p => p.count > 0).length;
  return `${sup.products.length} Produkte · <b>${counted}</b> ausgewählt`;
}

function renderCount() {
  const sup = cur();
  updateBadges();
  if (!sup.products.length) {
    main.innerHTML = `<div class="empty">
      <p>Für <b>${esc(supName())}</b> sind noch keine Produkte angelegt.</p>
      <p>Leg sie in der Reihenfolge an, in der du durch den Laden läufst. Dann musst du später nur noch von oben nach unten durchgehen.</p>
      <button class="btn primary big" data-act="add">+ Erstes Produkt anlegen</button></div>`;
    return;
  }
  const n = sup.products.length;
  main.innerHTML = `
    <div class="bar">
      <div class="bar-text" id="countText">${editing ? 'Tippe ein Produkt an, um es zu ändern.' : countSummary()}</div>
      <button class="btn small${editing ? ' primary' : ''}" data-act="toggle-edit">${editing ? 'Fertig' : '✎ Bearbeiten'}</button>
    </div>
    <ul class="list">${sup.products.map((p, i) => editing ? editRow(p, i, n) : countRow(p)).join('')}</ul>
    ${editing
      ? '<button class="btn big" data-act="add">+ Produkt hinzufügen</button>'
      : '<button class="btn primary big confirm" data-act="confirm">Liste bestätigen</button>'}`;
}

const countRow = p => `
  <li class="row${p.count ? ' on' : ''}" data-id="${p.id}">
    ${thumb(p)}<span class="name">${esc(p.name)}</span>
    <span class="stepper">
      <button class="step" data-act="minus" aria-label="1 weniger"${p.count ? '' : ' disabled'}>−1</button>
      <output class="count">${p.count}</output>
      <button class="step plus" data-act="plus" aria-label="1 mehr">+1</button>
    </span>
  </li>`;

const editRow = (p, i, n) => `
  <li class="row edit" data-id="${p.id}">
    <span class="pos">${i + 1}</span>
    <button class="rowbtn" data-act="open">${thumb(p)}<span class="name">${esc(p.name)}</span></button>
    <button class="step" data-act="up" aria-label="nach oben"${i ? '' : ' disabled'}>▲</button>
    <button class="step" data-act="down" aria-label="nach unten"${i < n - 1 ? '' : ' disabled'}>▼</button>
    <button class="step del" data-act="delete" aria-label="löschen">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>
      </svg>
    </button>
  </li>`;

function renderOrder() {
  const o = cur().order;
  updateBadges();
  if (!o) {
    main.innerHTML = `<div class="empty">
      <p>Noch keine Bestellliste für <b>${esc(supName())}</b>.</p>
      <p>Geh unter „Durchgehen“ die Produkte durch und tippe ganz unten auf „Liste bestätigen“.</p></div>`;
    return;
  }
  const created = new Date(o.created).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  main.innerHTML = `
    <div class="bar"><div class="bar-text">Erstellt ${created}<br><span id="doneText"></span></div></div>
    <div class="progress"><span id="doneBar"></span></div>
    <ul class="list">${o.items.map((it, i) => `
      <li><button class="orow${it.done ? ' done' : ''}" role="checkbox" aria-checked="${it.done}" data-act="check" data-i="${i}">
        <span class="qty">${it.count}×</span><span class="name">${esc(it.name)}</span><span class="box"></span>
      </button></li>`).join('')}</ul>
    <p class="alldone" id="allDone" hidden>Alles eingegeben ✓</p>
    <button class="btn big ghost" data-act="clear-order">Bestellliste löschen</button>`;
  updateOrderProgress();
}

function updateOrderProgress() {
  const items = cur().order.items;
  const done = items.filter(i => i.done).length;
  $('#doneText').innerHTML = `<b>${done}</b> von ${items.length} eingegeben`;
  $('#doneBar').style.width = (items.length ? 100 * done / items.length : 0) + '%';
  $('#allDone').hidden = done < items.length;
  updateBadges();
}

// ---------- Aktionen ----------

function changeCount(id, delta, li) {
  const p = cur().products.find(x => x.id === id);
  if (!p) return;
  p.count = Math.max(0, p.count + delta);
  save();
  buzz();
  li.classList.toggle('on', p.count > 0);
  li.querySelector('.count').textContent = p.count;
  li.querySelector('[data-act=minus]').disabled = !p.count;
  $('#countText').innerHTML = countSummary();
  updateBadges();
}

function move(id, delta) {
  const list = cur().products;
  const i = list.findIndex(p => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save();
  renderCount();
  main.querySelector(`[data-id="${id}"]`).classList.add('moved');
}

async function confirmOrder() {
  const sup = cur();
  const items = sup.products.filter(p => p.count > 0);
  if (!items.length) {
    await ask({ title: 'Noch nichts ausgewählt', text: 'Tippe bei den Produkten, die bestellt werden sollen, auf +1.', yes: 'OK', no: null });
    return;
  }
  const pieces = items.reduce((n, p) => n + p.count, 0);
  let text = `${items.length} Produkte (${pieces} Stück) kommen in die Bestellliste für ${supName()}. Danach stehen alle Zähler wieder auf 0.`;
  if (sup.order) text += ' Die bisherige Bestellliste wird dabei ersetzt.';
  if (!await ask({ title: 'Bist du sicher?', text })) return;
  sup.order = {
    created: Date.now(),
    items: items.map(p => ({ id: p.id, name: p.name, count: p.count, done: false })).sort(byName),
  };
  for (const p of sup.products) p.count = 0;
  state.ui.scroll[state.ui.supplier + ':count'] = 0;
  state.ui.scroll[state.ui.supplier + ':order'] = 0;
  state.ui.view = 'order';
  save();
  render();
}

function toggleDone(i, btn) {
  const it = cur().order.items[i];
  it.done = !it.done;
  save();
  buzz();
  btn.classList.toggle('done', it.done);
  btn.setAttribute('aria-checked', it.done);
  updateOrderProgress();
}

async function clearOrder() {
  if (!await ask({ title: 'Bestellliste löschen?', text: `Die Bestellliste für ${supName()} wird gelöscht.`, yes: 'Löschen', no: 'Abbrechen', danger: true })) return;
  cur().order = null;
  save();
  render();
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
    case 'add': editing = true; return openProduct(null);
    case 'open': return openProduct(id);
    case 'up': return move(id, -1);
    case 'down': return move(id, 1);
    case 'delete': return deleteProduct(id);
    case 'confirm': return confirmOrder();
    case 'check': return toggleDone(+btn.dataset.i, btn);
    case 'clear-order': return clearOrder();
  }
});

$('.sup-tabs').innerHTML = SUPPLIERS.map(s => `<button role="tab" data-sup-tab="${s.key}">${esc(s.name)}</button>`).join('');
$('.sup-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-sup-tab]');
  if (!b || b.dataset.supTab === state.ui.supplier) return;
  rememberScroll();
  state.ui.supplier = b.dataset.supTab;
  editing = false;
  save();
  render();
});
$('.view-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view-tab]');
  if (!b || b.dataset.viewTab === state.ui.view) return;
  rememberScroll();
  state.ui.view = b.dataset.viewTab;
  editing = false;
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

// ---------- Produkt anlegen / bearbeiten ----------

const productDlg = $('#productDlg');
let pd = null; // { id, photo, insertAt }; photo: undefined = unverändert, Blob = neu, null = entfernen

function openProduct(id, insertAt) {
  const list = cur().products;
  const index = id ? list.findIndex(x => x.id === id) : -1;
  const p = index >= 0 ? list[index] : null;
  pd = { id: p ? p.id : null, photo: undefined };
  const max = p ? list.length : list.length + 1;
  $('#pTitle').textContent = p ? 'Produkt bearbeiten' : `Neues Produkt (${supName()})`;
  $('#pName').value = p ? p.name : '';
  $('#pPos').max = max;
  $('#pPos').value = p ? index + 1 : Math.min(insertAt ?? list.length, list.length) + 1;
  $('#pPosHint').textContent = `1 = ganz vorne, ${max} = ganz hinten`;
  $('#pNameHint').hidden = true;
  productDlg.querySelector('[data-pact=delete]').hidden = !p;
  productDlg.querySelector('[data-pact=save-next]').hidden = !!p;
  showPhotoPreview();
  if (!productDlg.open) productDlg.showModal();
  productDlg.scrollTop = 0;
}

let previewUrl = null;
function showPhotoPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  let url = null;
  if (pd.photo instanceof Blob) url = previewUrl = URL.createObjectURL(pd.photo);
  else if (pd.photo === undefined && pd.id) {
    const p = cur().products.find(x => x.id === pd.id);
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

async function saveProduct(next) {
  const name = $('#pName').value.trim().replace(/\s+/g, ' ');
  if (!name) {
    $('#pNameHint').hidden = false;
    $('#pName').focus();
    return;
  }
  const list = cur().products;
  let p, from = -1;
  if (pd.id) {
    from = list.findIndex(x => x.id === pd.id);
    p = list.splice(from, 1)[0];
    p.name = name;
  } else {
    p = { id: newId(), name, count: 0, photo: false };
  }
  let pos = parseInt($('#pPos').value, 10);
  if (!(pos >= 1)) pos = from >= 0 ? from + 1 : list.length + 1;
  const idx = Math.min(pos - 1, list.length);
  list.splice(idx, 0, p);
  try {
    if (pd.photo instanceof Blob) {
      await putPhoto(p.id, pd.photo);
      setPhotoUrl(p.id, pd.photo);
      p.photo = true;
    } else if (pd.photo === null && p.photo) {
      await deletePhoto(p.id);
      setPhotoUrl(p.id, null);
      p.photo = false;
    }
  } catch (err) {
    alert('Foto konnte nicht gespeichert werden: ' + err.message);
  }
  save();
  renderCount();
  const row = main.querySelector(`[data-id="${p.id}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center' });
    row.classList.add('moved');
  }
  if (next) openProduct(null, idx + 1);
  else productDlg.close();
}

async function deleteProduct(id) {
  const list = cur().products;
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return;
  const p = list[i];
  if (!await ask({ title: 'Produkt löschen?', text: `„${p.name}“ wird aus der Liste für ${supName()} entfernt.`, yes: 'Löschen', no: 'Abbrechen', danger: true })) return;
  list.splice(i, 1);
  if (p.photo) {
    setPhotoUrl(p.id, null);
    deletePhoto(p.id).catch(console.error);
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
    case 'save': return saveProduct(false);
    case 'save-next': return saveProduct(true);
    case 'delete': return deleteProduct(pd.id);
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

$('#menuBtn').addEventListener('click', () => {
  showLastBackup();
  menuDlg.showModal();
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
    const out = { app: 'bestellapp', version: 1, exported: new Date().toISOString(), suppliers: state.suppliers, photos: {} };
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
  const n = SUPPLIERS.reduce((sum, s) => sum + (((data.suppliers || {})[s.key] || {}).products || []).length, 0);
  if (!await ask({ title: 'Sicherung laden?', text: `Die Sicherung enthält ${n} Produkte. Alles, was gerade in der App ist, wird dadurch ersetzt.`, yes: 'Laden', no: 'Abbrechen', danger: true })) return;
  try {
    const fresh = normalize({ suppliers: data.suppliers, ui: { ...state.ui, scroll: {} } });
    await clearPhotos();
    for (const url of photoUrls.values()) URL.revokeObjectURL(url);
    photoUrls.clear();
    for (const [id, dataUrl] of Object.entries(data.photos || {})) {
      const blob = await (await fetch(dataUrl)).blob();
      await putPhoto(id, blob);
      setPhotoUrl(id, blob);
    }
    state = fresh;
    editing = false;
    save();
    menuDlg.close();
    render();
  } catch (err) {
    alert('Laden fehlgeschlagen: ' + err.message);
  }
});

// ---------- Start ----------

async function init() {
  render();
  try {
    const photos = await loadAllPhotos();
    const ids = new Set(SUPPLIERS.flatMap(s => state.suppliers[s.key].products.map(p => p.id)));
    for (const [id, blob] of photos) {
      if (ids.has(id)) setPhotoUrl(id, blob);
      else deletePhoto(id).catch(console.error); // Foto eines gelöschten Produkts
    }
    // Fotos in die schon angezeigte Liste einsetzen, ohne die Scrollposition zu verändern
    if (photoUrls.size && state.ui.view === 'count') {
      const y = scrollY;
      renderCount();
      scrollTo(0, y);
    }
  } catch (err) {
    console.error(err);
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
}
init();
