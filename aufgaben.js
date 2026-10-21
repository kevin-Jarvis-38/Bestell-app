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
  return out;
}

function appliesOn(t, k) {
  if (t.repeat === 'once') return t.date === k;
  if (t.created && k < t.created) return false; // wiederkehrende Aufgaben erst ab dem Tag, an dem sie angelegt wurden
  const info = dayInfo(k);
  if (t.shift !== 'any' && (info.kind !== 'work' || info.shift !== t.shift)) return false;
  if (t.repeat === 'daily') return true;
  if (t.repeat === 'workdays') return info.kind === 'work';
  if (t.repeat === 'weekly') return weekday(k) === t.weekday;
  return false;
}

const tasksFor = k => [...autoTasks(k), ...state.tasks.items.filter(t => appliesOn(t, k))];
const isTaskDone = (id, k) => (state.tasks.done[k] || []).includes(id);
const overdue = today => state.tasks.items
  .filter(t => t.repeat === 'once' && t.date < today && !isTaskDone(t.id, t.date))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

function repeatLabel(t) {
  const base = { once: 'einmalig', weekly: `jeden ${WD_LONG[t.weekday]}`, workdays: 'an jedem Arbeitstag', daily: 'jeden Tag' }[t.repeat];
  const shift = { frueh: ' · nur Frühschicht-Wochen', spaet: ' · nur Spätschicht-Wochen' }[t.shift] || '';
  return base + shift;
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
    ${late.length ? `<div class="sec">⏰ Noch offen von früher</div><ul class="list">${late.map(taskRow).join('')}</ul>` : ''}
    ${list.length
      ? `${late.length ? '<div class="sec">📅 Heute</div>' : ''}<ul class="list">${list.map(taskRow).join('')}</ul>`
      : late.length ? '' : `<div class="empty"><div class="empty-icon">${info.kind === 'weekend' ? '🛋️' : '✨'}</div><p>Für diesen Tag steht nichts an.</p></div>`}
    <p class="alldone" ${all.length && done === all.length ? '' : 'hidden'}>Alles erledigt ✓</p>
    <button class="btn big" data-act="task-add">+ Aufgabe</button>`;
  renderWeek();
  updateTaskBadge();
}

function taskRow({ t, k, late }) {
  const done = isTaskDone(t.id, k);
  let meta;
  if (t.auto) {
    const items = orderItems(t.auto);
    const entered = items.filter(p => isDone(p, t.auto)).length;
    meta = items.length ? `${items.length} Produkte in der Liste · ${entered} eingegeben` : 'Bestellliste ist noch leer';
  } else {
    meta = late ? `fällig ${fmtShort(t.date)}` : repeatLabel(t);
  }
  return `
    <li><div class="trow${done ? ' done' : ''}${t.auto ? ' auto-' + t.auto : ''}" data-task="${esc(t.id)}" data-day="${k}">
      <button class="tcheck" data-act="task-check" role="checkbox" aria-checked="${done}" aria-label="erledigt"><span class="box"></span></button>
      <button class="tbody" data-act="${t.auto ? 'task-go' : 'task-open'}">
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
  save();
  buzz();
  const y = scrollY;
  renderTasks();
  scrollTo(0, y);
  if (i >= 0) return;
  const row = main.querySelector(`[data-task="${CSS.escape(id)}"][data-day="${k}"]`);
  if (row) row.classList.add('just');
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
  ].map(([v, l]) => `<label class="chk"><input type="radio" name="repeat" value="${v}">${l}</label>`).join('');
  $(`#tRepeat input[value="${t ? t.repeat : 'once'}"]`).checked = true;
  $('#tShift').value = t ? t.shift : 'any';
  syncShiftField();
  taskDlg.querySelector('[data-tact=delete]').hidden = !t;
  taskDlg.showModal();
  taskDlg.scrollTop = 0;
}

function syncShiftField() {
  $('#tShiftField').hidden = $('#tRepeat input:checked').value === 'once';
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
    shift: repeat === 'once' ? 'any' : $('#tShift').value,
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
