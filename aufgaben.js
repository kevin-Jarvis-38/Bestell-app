'use strict';

// Aufgaben: Tagesansicht mit Schichtplan, automatischen Bestell-Aufgaben und eigenen Aufgaben.
// Nutzt Zustand und Hilfsfunktionen aus app.js (state, save, main, $, esc, ask, …).

// ---------- Schichtplan (wie scripts/schichtplan.py im JARVIS-Projekt) ----------

const FIRST_MONDAY = '2026-10-19'; // Frühschicht-Woche, danach wöchentlicher Wechsel
const SCHOOL_UNTIL = '2027-02-28'; // bis dahin mittwochs Berufsschule (außer in den Ferien)
const SHIFT_START = { frueh: '05:30', spaet: '09:00' };
const SHIFT_END = [null, '15:00', '16:00', '16:00', '16:00', '14:00', null]; // So … Sa
const FEIERTAGE = new Set(['2026-12-25', '2027-01-01', '2027-01-06', '2027-03-26', '2027-03-29', '2027-05-06', '2027-05-17', '2027-05-27']);
const FERIEN = [
  ['Herbstferien', '2026-11-02', '2026-11-06'],
  ['Buß- und Bettag (schulfrei)', '2026-11-18', '2026-11-18'],
  ['Weihnachtsferien', '2026-12-24', '2027-01-08'],
  ['Frühjahrsferien', '2027-02-08', '2027-02-12'],
  ['Osterferien', '2027-03-22', '2027-04-02'],
  ['Pfingstferien', '2027-05-18', '2027-05-28'],
  ['Sommerferien', '2027-08-02', '2027-09-13'],
];
const TASKS_COLOR = '#0ca678'; // Statusleiste im Aufgaben-Bereich
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// ---------- Datum (Tage als "JJJJ-MM-TT", immer Ortszeit) ----------

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseDay(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(k, n) {
  const d = parseDay(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
const weekday = k => parseDay(k).getDay(); // 0 = Sonntag
const mondayOf = k => addDays(k, -((weekday(k) + 6) % 7));
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
const fmtLong = k => parseDay(k).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = k => parseDay(k).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const monthLabel = k => parseDay(k).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

const todayOverride = new URLSearchParams(location.search).get('heute'); // nur für Tests und Screenshots
const todayKey = () => (/^\d{4}-\d{2}-\d{2}$/.test(todayOverride || '') ? todayOverride : dayKey(new Date()));

// ---------- Was an einem Tag gilt ----------

function shiftOfWeek(k) {
  const weeks = Math.floor(daysBetween(FIRST_MONDAY, mondayOf(k)) / 7);
  return ((weeks % 2) + 2) % 2 === 0 ? 'frueh' : 'spaet';
}

const ferienOf = k => (FERIEN.find(([, a, b]) => a <= k && k <= b) || [])[0] || null;

function dayInfo(k) {
  const wd = weekday(k);
  const ferien = ferienOf(k);
  if (wd === 0 || wd === 6) return { kind: 'weekend', label: 'Wochenende', icon: '🛋️', ferien };
  if (FEIERTAGE.has(k)) return { kind: 'holiday', label: 'Feiertag', icon: '🎉', ferien };
  if (wd === 3 && k <= SCHOOL_UNTIL && !ferien) return { kind: 'school', label: 'Berufsschule', time: '08:00–16:00', icon: '🎓', ferien };
  const shift = shiftOfWeek(k);
  return {
    kind: 'work',
    shift,
    label: shift === 'frueh' ? 'Frühschicht' : 'Spätschicht',
    time: `${SHIFT_START[shift]}–${SHIFT_END[wd]}`,
    icon: shift === 'frueh' ? '🌅' : '🌇',
    ferien,
  };
}

// Lekkerland: Spätschicht-Woche dienstags, Frühschicht-Woche mittwochs – außer der Mittwoch ist kein Arbeitstag
function lekkerlandDay(k) {
  const mon = mondayOf(k);
  const wed = addDays(mon, 2);
  return shiftOfWeek(mon) === 'frueh' && dayInfo(wed).kind === 'work' ? wed : addDays(mon, 1);
}

// Tabacon: freitags, an einem Feiertag einen Tag früher
function tabaconDay(k) {
  const fri = addDays(mondayOf(k), 4);
  return dayInfo(fri).kind === 'holiday' ? addDays(fri, -1) : fri;
}

function autoTasks(k) {
  const out = [];
  if (lekkerlandDay(k) === k) out.push({ id: 'auto-lekkerland', title: 'Lekkerland bestellen', auto: 'lekkerland' });
  if (tabaconDay(k) === k) out.push({ id: 'auto-tabacon', title: 'Tabacon bestellen', auto: 'tabacon' });
  if (out.length) out.unshift({ id: 'auto-auffuellen', title: 'Regale und Kühlschränke auffüllen', note: 'vor der Bestellung, für den Überblick' });
  return out;
}

function appliesOn(t, k) {
  if (t.repeat === 'pool') return false; // „Bei Gelegenheit“ steht in einem eigenen Bereich
  if (t.repeat === 'once') return t.date === k;
  if (t.created && k < t.created) return false; // wiederkehrende Aufgaben erst ab dem Tag, an dem sie angelegt wurden
  const info = dayInfo(k);
  if (t.shift === 'work' && info.kind !== 'work') return false;
  if ((t.shift === 'frueh' || t.shift === 'spaet') && (info.kind !== 'work' || info.shift !== t.shift)) return false;
  if (t.repeat === 'daily') return true;
  if (t.repeat === 'workdays') return info.kind === 'work';
  if (t.repeat === 'weekly') return weekday(k) === t.weekday;
  // Regelmäßig: ab dem ersten fälligen Arbeitstag, bis sie abgehakt ist; danach wieder nach `every` Tagen
  if (t.repeat === 'interval') {
    if (info.kind !== 'work') return false;
    return !t.lastDone || k === t.lastDone || daysBetween(t.lastDone, k) >= t.every;
  }
  return false;
}

// Reihenfolge: eigene Aufgaben, dann Auffüllen und Bestellungen, zum Schluss das Ende des Arbeitstags
function tasksFor(k) {
  const items = state.tasks.items.filter(t => appliesOn(t, k));
  return [...items.filter(t => !t.endOfDay), ...autoTasks(k), ...items.filter(t => t.endOfDay)];
}
const EVERY_LABEL = { 7: 'jede Woche', 14: 'alle 2 Wochen', 21: 'alle 3 Wochen', 28: 'alle 4 Wochen' };
// „Bei Gelegenheit“: am längsten nicht erledigte zuerst
const poolTasks = () => state.tasks.items.filter(t => t.repeat === 'pool').sort((a, b) => (a.lastDone || '').localeCompare(b.lastDone || ''));
const isTaskDone = (id, k) => (state.tasks.done[k] || []).includes(id);
const overdue = today => state.tasks.items
  .filter(t => t.repeat === 'once' && t.date < today && !isTaskDone(t.id, t.date))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

function repeatLabel(t) {
  if (t.repeat === 'pool') return t.lastDone ? `zuletzt ${fmtShort(t.lastDone)}` : 'noch nie erledigt';
  if (t.repeat === 'interval') return (EVERY_LABEL[t.every] || `alle ${t.every} Tage`) + (t.lastDone ? ` · zuletzt ${fmtShort(t.lastDone)}` : '');
  const base = { once: 'einmalig', weekly: `jeden ${WD_LONG[t.weekday]}`, workdays: 'an jedem Arbeitstag', daily: 'jeden Tag' }[t.repeat];
  const shift = { work: ' · nur Arbeitstage', frueh: ' · nur Frühschicht-Wochen', spaet: ' · nur Spätschicht-Wochen' }[t.shift] || '';
  return base + shift;
}

// ---------- Vorlage aus dem Berichtsheft (Wochenablauf laut Kevin, 21.10.2026) ----------

// since = Vorlagen-Version, mit der die Aufgabe dazukam; end = steht am Ende des Arbeitstags
const SEED_VERSION = 2;
const SEED = [
  { id: 'v-aufsperren', title: 'Laden aufsperren und Kasse vorbereiten', repeat: 'workdays', shift: 'frueh', since: 1 },
  { id: 'v-zeitungen', title: 'Zeitungen auslegen', repeat: 'workdays', shift: 'frueh', since: 1 },
  { id: 'v-aufbacken', title: 'Backwaren aufbacken', repeat: 'workdays', shift: 'frueh', since: 1 },
  { id: 'v-tankautomat', title: 'Tankautomaten auf Inhalt prüfen', repeat: 'workdays', shift: 'frueh', since: 1 },
  { id: 'v-mo-lieferung', title: 'Lieferung auspacken, buchen und verräumen', repeat: 'weekly', wd: 1, shift: 'work', since: 1 },
  { id: 'v-progas', title: 'ProGas: Daten der Autogas-Säule übermitteln', repeat: 'weekly', wd: 1, shift: 'work', since: 1 },
  { id: 'v-remission', title: 'Zeitungen remissionieren (retour)', repeat: 'weekly', wd: 1, shift: 'work', since: 1 },
  { id: 'v-lotto-abgabe', title: 'Lotto-Fahrer: Gewinnlose mitgeben, neue Lose, Plakate und Post annehmen', repeat: 'weekly', wd: 2, shift: 'work', since: 1 },
  { id: 'v-mi-lieferung', title: 'Lieferung auspacken, buchen und verräumen', repeat: 'weekly', wd: 3, shift: 'work', since: 1 },
  { id: 'v-do-gross', title: 'Ruhiger Tag: eine größere Aufgabe aus „Bei Gelegenheit“ erledigen', repeat: 'weekly', wd: 4, shift: 'work', since: 1 },
  { id: 'v-auslage', title: 'Auslage und Theke säubern', repeat: 'workdays', since: 1 },
  { id: 'v-mhd', title: 'Mindesthaltbarkeit (MHD) kontrollieren', repeat: 'interval', every: 14, since: 1 },
  { id: 'v-spuelmaschine', title: 'Spülmaschine säubern', repeat: 'interval', every: 14, since: 2 },
  { id: 'v-parkposi', title: 'Parkposi zahlen', repeat: 'workdays', end: true, since: 2 },
  { id: 'v-abrechnung', title: 'Abrechnung', repeat: 'workdays', end: true, since: 2 },
  { id: 'v-inv-lager', title: 'Teilinventur im Lager', repeat: 'pool', since: 1 },
  { id: 'v-inv-tabak', title: 'Inventur Tabakwaren', repeat: 'pool', since: 1 },
  { id: 'v-inv-getraenke', title: 'Inventur Getränke und Kastenwaren', repeat: 'pool', since: 1 },
  { id: 'v-lager', title: 'Lagerbestände prüfen und neu sortieren', repeat: 'pool', since: 1 },
  { id: 'v-preise', title: 'Preisauszeichnung kontrollieren und aktualisieren', repeat: 'pool', since: 1 },
  { id: 'v-stammdaten', title: 'Artikelstammdaten pflegen, neue Produkte anlegen', repeat: 'pool', since: 1 },
  { id: 'v-flaeche', title: 'Verkaufsfläche umgestalten, Aktionsware platzieren', repeat: 'pool', since: 1 },
  { id: 'v-ablage', title: 'Rechnungen und Lieferscheine ablegen', repeat: 'pool', since: 1 },
  { id: 'v-preisvergleich', title: 'Preise bei verschiedenen Lieferanten vergleichen', repeat: 'pool', since: 1 },
  { id: 'v-mhd-doku', title: 'Nicht verkaufsfähige Ware dokumentieren', repeat: 'pool', since: 1 },
  { id: 'v-saugen', title: 'Verkaufsraum saugen', repeat: 'pool', since: 1 },
  { id: 'v-gasflaschen', title: 'Gasflaschen bestellen', repeat: 'pool', since: 2 },
];
// Was sich an schon eingespielten Vorlagen-Aufgaben ändert (Wünsche des Nutzers vom 21.10.2026)
const SEED_UPDATES = {
  2: { changed: ['v-tankautomat', 'v-mhd', 'v-progas', 'v-lotto-abgabe'], removed: ['v-lotto-annahme', 'v-wischen'] },
};

const seedFields = s => ({
  title: s.title,
  repeat: s.repeat,
  weekday: s.wd ?? null,
  shift: s.shift || 'any',
  every: s.every || null,
  endOfDay: !!s.end,
});

// Neue Vorlagen-Aufgaben ergänzen und geänderte anpassen. Selbst gelöschte kommen nicht zurück,
// Aufgaben mit gleichem Namen (z. B. selbst angelegt) werden nicht doppelt angelegt.
function seedTasks() {
  const from = state.tasks.seed || 0;
  if (from >= SEED_VERSION) return;
  if (from > 0) {
    for (let v = from + 1; v <= SEED_VERSION; v++) {
      const u = SEED_UPDATES[v] || { changed: [], removed: [] };
      state.tasks.items = state.tasks.items.filter(t => !u.removed.includes(t.id));
      for (const id of u.changed) {
        const t = state.tasks.items.find(x => x.id === id);
        if (t) Object.assign(t, seedFields(SEED.find(s => s.id === id)));
      }
    }
  }
  const today = todayKey();
  const have = new Set(state.tasks.items.map(t => t.repeat + '|' + (t.weekday ?? '') + '|' + t.title.toLowerCase()));
  for (const s of SEED) {
    if (s.since <= from || state.tasks.items.some(t => t.id === s.id)) continue;
    if (have.has(s.repeat + '|' + (s.wd ?? '') + '|' + s.title.toLowerCase())) continue;
    state.tasks.items.push({ id: s.id, date: null, created: today, lastDone: null, ...seedFields(s) });
  }
  state.tasks.seed = SEED_VERSION;
  save();
}

// ---------- Anzeige ----------

let taskDay = todayKey();
let lastToday = todayKey();

// Die Liste eines Tages: heute zusätzlich die offenen einmaligen Aufgaben von früher
function dayEntries(k) {
  const late = k === todayKey() ? overdue(k).map(t => ({ t, k: t.date, late: true })) : [];
  return { late, list: tasksFor(k).map(t => ({ t, k })) };
}

function renderTasks() {
  const k = taskDay;
  const today = todayKey();
  const info = dayInfo(k);
  const { late, list } = dayEntries(k);
  const all = [...late, ...list];
  const done = all.filter(x => isTaskDone(x.t.id, x.k)).length;
  const kindClass = `kind-${info.kind}${info.shift ? ' shift-' + info.shift : ''}`;
  main.innerHTML = `
    <div class="day-card">
      <div class="day-date">${esc(fmtLong(k))}${k === today ? '<span class="today-pill">Heute</span>' : ''}</div>
      <div class="day-info">
        <span class="day-kind ${kindClass}">${info.icon} ${info.label}${info.time ? ' · ' + info.time : ''}</span>
        ${info.ferien ? `<span class="day-ferien">🏖️ ${esc(info.ferien)}</span>` : ''}
      </div>
    </div>
    ${all.length ? `
      <div class="bar"><div class="bar-text"><b>${done}</b> von ${all.length} erledigt</div></div>
      <div class="progress"><span style="width:${100 * done / all.length}%"></span></div>` : ''}
    ${late.length ? `<div class="sec">⏰ Noch offen von früher</div><ul class="list tlist">${late.map(taskRow).join('')}</ul>` : ''}
    ${list.length
      ? `${late.length ? '<div class="sec">📅 Heute</div>' : ''}<ul class="list tlist">${list.map(taskRow).join('')}</ul>`
      : late.length ? '' : `<div class="empty"><div class="empty-icon">${info.kind === 'weekend' ? '🛋️' : '✨'}</div><p>Für diesen Tag steht nichts an.</p></div>`}
    <p class="alldone" ${all.length && done === all.length ? '' : 'hidden'}>Alles erledigt ✓</p>
    ${poolSection(k, info)}
    <button class="btn big" data-act="task-add">+ Aufgabe</button>`;
  renderWeek();
  updateTaskBadge();
}

// „Bei Gelegenheit“ an Arbeitstagen; donnerstags (ruhiger Tag) aufgeklappt, sonst zugeklappt
const poolOpen = {};
function poolSection(k, info) {
  const pool = info.kind === 'work' ? poolTasks() : [];
  if (!pool.length) return '';
  const open = k in poolOpen ? poolOpen[k] : weekday(k) === 4;
  return `<details class="pool"${open ? ' open' : ''}>
    <summary>💡 Bei Gelegenheit <span class="pool-count">${pool.length}</span></summary>
    <p class="hint">Was am längsten her ist, steht oben.</p>
    <ul class="list">${pool.map(t => taskRow({ t, k })).join('')}</ul>
  </details>`;
}
main.addEventListener('toggle', e => {
  if (e.target.matches('details.pool')) poolOpen[taskDay] = e.target.open;
}, true);

function taskRow({ t, k, late }) {
  const done = isTaskDone(t.id, k);
  let meta;
  if (t.auto) {
    const items = orderItems(t.auto);
    const entered = items.filter(p => isDone(p, t.auto)).length;
    meta = items.length ? `${items.length} Produkte in der Liste · ${entered} eingegeben` : 'Bestellliste ist noch leer';
  } else if (t.note) {
    meta = t.note;
  } else {
    meta = late ? `fällig ${fmtShort(t.date)}` : repeatLabel(t);
  }
  const act = t.auto ? 'task-go' : t.note ? 'task-none' : 'task-open';
  return `
    <li><div class="trow${done ? ' done' : ''}${t.auto ? ' auto-' + t.auto : ''}" data-task="${esc(t.id)}" data-day="${k}">
      <button class="tcheck" data-act="task-check" role="checkbox" aria-checked="${done}" aria-label="erledigt"><span class="box"></span></button>
      <button class="tbody" data-act="${act}">
        <span class="ttitle">${t.auto ? (t.auto === 'lekkerland' ? '🛒 ' : '🚬 ') : ''}${esc(t.title)}</span>
        <small class="tmeta">${esc(meta)}</small>
        ${t.auto ? '<span class="tgo">Zur Bestellung ›</span>' : ''}
      </button>
    </div></li>`;
}

function dayState(k) {
  const list = tasksFor(k);
  if (!list.length) return '';
  return list.some(t => !isTaskDone(t.id, k)) ? 'open' : 'done';
}

function renderWeek() {
  const mon = mondayOf(taskDay);
  const today = todayKey();
  $('#monthBtn').textContent = monthLabel(taskDay) + ' ▾';
  $('#todayBtn').hidden = taskDay === today;
  $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const k = addDays(mon, i);
    return `<button class="wd${k === taskDay ? ' sel' : ''}${k === today ? ' today' : ''}" data-day="${k}">
      <small>${WD_SHORT[weekday(k)]}</small><b>${parseDay(k).getDate()}</b><i class="dot ${dayState(k)}"></i></button>`;
  }).join('');
}

function updateTaskBadge() {
  $('#today').textContent = fmtLong(todayKey()); // Datum in der Titelzeile, auch nach Mitternacht aktuell
  const { late, list } = dayEntries(todayKey());
  const open = [...late, ...list].filter(x => !isTaskDone(x.t.id, x.k)).length;
  $('#badgeTasks').textContent = open || '';
}

function showDay(k) {
  taskDay = k;
  if (state.ui.mode !== 'tasks') return;
  main.classList.remove('enter');
  void main.offsetWidth;
  main.classList.add('enter');
  renderTasks();
  scrollTo(0, 0);
}

// ---------- Aktionen ----------

function toggleTask(id, k) {
  const list = state.tasks.done[k] || (state.tasks.done[k] = []);
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  if (!list.length) delete state.tasks.done[k];
  // „Bei Gelegenheit“ und „Regelmäßig“ merken sich, wann sie zuletzt erledigt wurden
  const tracked = state.tasks.items.find(t => t.id === id && (t.repeat === 'pool' || t.repeat === 'interval'));
  if (tracked && i < 0) {
    tracked.prevDone = tracked.lastDone;
    tracked.lastDone = k;
  } else if (tracked && tracked.lastDone === k) {
    tracked.lastDone = tracked.prevDone || null;
  }
  const pool = tracked && tracked.repeat === 'pool';
  save();
  buzz();
  const y = scrollY;
  renderTasks();
  scrollTo(0, y);
  if (i >= 0) return;
  const row = main.querySelector(`[data-task="${CSS.escape(id)}"][data-day="${k}"]`);
  if (row) row.classList.add('just');
  if (pool) return;
  const { late, list: today } = dayEntries(taskDay);
  if ([...late, ...today].every(x => isTaskDone(x.t.id, x.k))) confetti();
}

function goToSupplier(sup) {
  rememberScroll();
  state.ui.mode = 'order';
  state.ui.supplier = sup;
  state.ui.view = 'count';
  editing = false;
  search = '';
  save();
  render();
}

main.addEventListener('click', e => {
  if (state.ui.mode !== 'tasks') return;
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const row = b.closest('[data-task]');
  switch (b.dataset.act) {
    case 'task-check': return toggleTask(row.dataset.task, row.dataset.day);
    case 'task-open': return openTask(row.dataset.task);
    case 'task-go': return goToSupplier(row.dataset.task.replace('auto-', ''));
    case 'task-add': return openTask(null);
  }
});

$('#weekStrip').addEventListener('click', e => {
  const b = e.target.closest('[data-day]');
  if (b) showDay(b.dataset.day);
});
$('.week-nav').addEventListener('click', e => {
  const b = e.target.closest('[data-wk]');
  if (b) showDay(addDays(taskDay, 7 * Number(b.dataset.wk)));
});
$('#todayBtn').addEventListener('click', () => showDay(todayKey()));

// Wischen nach links/rechts wechselt den Tag
let touch = null;
main.addEventListener('touchstart', e => {
  touch = state.ui.mode === 'tasks' && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
main.addEventListener('touchend', e => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 50) showDay(addDays(taskDay, dx < 0 ? 1 : -1));
}, { passive: true });

// Neuer Tag, während die App im Hintergrund offen war
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || lastToday === todayKey()) return;
  if (taskDay === lastToday) taskDay = todayKey();
  lastToday = todayKey();
  if (state.ui.mode === 'tasks') renderTasks();
  else updateTaskBadge();
});

// ---------- Monatsansicht ----------

const monthDlg = $('#monthDlg');
let monthCursor = null; // erster Tag des angezeigten Monats

function renderMonth() {
  const first = parseDay(monthCursor);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = todayKey();
  $('#monthTitle').textContent = monthLabel(monthCursor);
  let html = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<span class="mh">${d}</span>`).join('');
  html += '<span></span>'.repeat(lead);
  for (let i = 0; i < days; i++) {
    const k = addDays(monthCursor, i);
    const info = dayInfo(k);
    const cls = `md kind-${info.kind}${info.shift ? ' shift-' + info.shift : ''}${k === today ? ' today' : ''}${k === taskDay ? ' sel' : ''}`;
    html += `<button class="${cls}" data-day="${k}">${i + 1}<i class="dot ${dayState(k)}"></i></button>`;
  }
  $('#monthGrid').innerHTML = html;
}

$('#monthBtn').addEventListener('click', () => {
  monthCursor = taskDay.slice(0, 8) + '01';
  renderMonth();
  monthDlg.showModal();
});
monthDlg.addEventListener('click', e => {
  const day = e.target.closest('[data-day]');
  if (day) {
    monthDlg.close();
    return showDay(day.dataset.day);
  }
  const step = e.target.closest('[data-mm]');
  if (step) {
    const d = parseDay(monthCursor);
    d.setMonth(d.getMonth() + Number(step.dataset.mm));
    monthCursor = dayKey(d);
    renderMonth();
  }
});

// ---------- Aufgabe anlegen / bearbeiten ----------

const taskDlg = $('#taskDlg');
let td = null; // { id, anchor, wd }

function openTask(id) {
  const t = id ? state.tasks.items.find(x => x.id === id) : null;
  const anchor = t && t.repeat === 'once' ? t.date : taskDay;
  const wd = t && t.repeat === 'weekly' ? t.weekday : weekday(anchor);
  td = { id: t ? t.id : null, anchor, wd };
  $('#tTitle').textContent = t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
  $('#tName').value = t ? t.title : '';
  $('#tNameHint').hidden = true;
  $('#tRepeat').innerHTML = [
    ['once', `Nur am ${fmtShort(anchor)}`],
    ['weekly', `Jeden ${WD_LONG[wd]}`],
    ['workdays', 'An jedem Arbeitstag'],
    ['daily', 'Jeden Tag'],
    ['interval', 'Regelmäßig, z. B. alle 2 Wochen (bleibt stehen, bis erledigt)'],
    ['pool', 'Bei Gelegenheit (ohne festen Tag)'],
  ].map(([v, l]) => `<label class="chk"><input type="radio" name="repeat" value="${v}">${l}</label>`).join('');
  $(`#tRepeat input[value="${t ? t.repeat : 'once'}"]`).checked = true;
  $('#tShift').value = t ? t.shift : 'any';
  $('#tEvery').value = String(t && t.every ? t.every : 14);
  syncShiftField();
  taskDlg.querySelector('[data-tact=delete]').hidden = !t;
  taskDlg.showModal();
  taskDlg.scrollTop = 0;
}

function syncShiftField() {
  const repeat = $('#tRepeat input:checked').value;
  $('#tShiftField').hidden = ['once', 'pool', 'interval'].includes(repeat);
  $('#tEveryField').hidden = $('#tEveryHint').hidden = repeat !== 'interval';
}
$('#tRepeat').addEventListener('change', syncShiftField);

function saveTask() {
  const title = $('#tName').value.trim().replace(/\s+/g, ' ');
  if (!title) {
    $('#tNameHint').hidden = false;
    $('#tName').focus();
    return;
  }
  const repeat = $('#tRepeat input:checked').value;
  let t = td.id && state.tasks.items.find(x => x.id === td.id);
  if (!t) {
    const today = todayKey();
    t = { id: newId(), created: taskDay < today ? taskDay : today };
    state.tasks.items.push(t);
  }
  Object.assign(t, {
    title,
    repeat,
    date: repeat === 'once' ? td.anchor : null,
    weekday: repeat === 'weekly' ? td.wd : null,
    shift: ['once', 'pool', 'interval'].includes(repeat) ? 'any' : $('#tShift').value,
    every: repeat === 'interval' ? Number($('#tEvery').value) : null,
  });
  save();
  taskDlg.close();
  const y = scrollY;
  renderTasks();
  scrollTo(0, y);
}

async function deleteTask() {
  const t = state.tasks.items.find(x => x.id === td.id);
  if (!t) return;
  const text = t.repeat === 'once' ? `„${t.title}“ wird gelöscht.` : `„${t.title}“ verschwindet an allen Tagen.`;
  if (!await ask({ title: 'Aufgabe löschen?', text, yes: 'Löschen', no: 'Abbrechen', danger: true })) return;
  state.tasks.items = state.tasks.items.filter(x => x.id !== t.id);
  for (const k of Object.keys(state.tasks.done)) {
    state.tasks.done[k] = state.tasks.done[k].filter(id => id !== t.id);
    if (!state.tasks.done[k].length) delete state.tasks.done[k];
  }
  save();
  taskDlg.close();
  renderTasks();
}

taskDlg.addEventListener('click', e => {
  const b = e.target.closest('[data-tact]');
  if (!b) return;
  switch (b.dataset.tact) {
    case 'save': return saveTask();
    case 'cancel': return taskDlg.close();
    case 'delete': return deleteTask();
  }
});

// Alte Haken aufräumen: nach 120 Tagen verschwinden sie samt erledigter einmaliger Aufgaben
function pruneTasks() {
  const cutoff = addDays(todayKey(), -120);
  state.tasks.items = state.tasks.items.filter(t => !(t.repeat === 'once' && t.date < cutoff && isTaskDone(t.id, t.date)));
  for (const k of Object.keys(state.tasks.done)) if (k < cutoff) delete state.tasks.done[k];
}
pruneTasks();
