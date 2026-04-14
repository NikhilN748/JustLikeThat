const DS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── IndexedDB Auto-Backup ───
const IDB_NAME = 'HoursTrackerBackup';
const IDB_VERSION = 1;
const IDB_STORE = 'backups';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(data) {
  try {
    const idb = await openIDB();
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, 'latest');
    tx.objectStore(IDB_STORE).put(new Date().toISOString(), 'savedAt');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) { /* silent */ }
}

async function idbLoad() {
  try {
    const idb = await openIDB();
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get('latest');
    return new Promise((res) => { req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); });
  } catch (e) { return null; }
}

async function idbClear() {
  try {
    const idb = await openIDB();
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
  } catch (e) { /* silent */ }
}

// ─── File System Access API auto-save (Chrome only) ───
let _fileHandle = null;

async function pickSaveFile() {
  try {
    _fileHandle = await window.showSaveFilePicker({
      suggestedName: 'hours_tracker_autosave.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });
    localStorage.setItem('ht_autosave_enabled', '1');
    showExportToast('Auto-save file linked');
    await fileAutoSave();
  } catch (e) {
    if (e.name !== 'AbortError') showExportToast('Could not set up auto-save');
  }
}

async function fileAutoSave() {
  if (!_fileHandle) return;
  try {
    const writable = await _fileHandle.createWritable();
    const payload = buildFullBackupPayload();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
  } catch (e) { /* permission revoked or tab closed — silent */ }
}

async function restoreFromFile() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });
    const file = await handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !data.db) { await iosAlert('Invalid backup file.'); return; }
    const ok = await iosConfirm('Restore this file? This will replace current data.', { okLabel: 'Restore', danger: true });
    if (!ok) return;
    applyRestoredBackup(data);
    showExportToast('Restored from file');
  } catch (e) {
    if (e.name !== 'AbortError') await iosAlert('Could not read file.');
  }
}

function buildFullBackupPayload() {
  return {
    app: 'Hours Tracker',
    version: 2,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    hourlyRate,
    currency,
    overtimeThresholdHours,
    overtimeRate,
    breakReminderHours,
    autoBreakMins,
    roundingIncrementMins,
    roundingMode,
    scheduledStartTime,
    lateGraceMins,
    longShiftAlertHours,
    missedClockOutHours,
    clients,
    projects,
    tags,
    dailySchedule,
    themePreference,
    db
  };
}

let weekOffset = 0;
let calMonthOffset = 0;
let editKey = null;
let hourlyRate = parseFloat(localStorage.getItem('ht_rate') || '0');
let currency = localStorage.getItem('ht_currency') || 'USD';
let clockedIn = false;
let clockInTime = null;
let clockInKey = null;
let activeSessionIndex = null;
let clockInterval = null;
let onBreak = false;
let breakStartTime = null;
let breakTimerInterval = null;
let sheetSnapshot = null;
let clients = loadCollection('ht_clients');
let projects = loadCollection('ht_projects');
let tags = loadCollection('ht_tags');
let selectedClientFilter = localStorage.getItem('ht_filter_client') || '';
let selectedProjectFilter = localStorage.getItem('ht_filter_project') || '';
let showOvertimeBar = localStorage.getItem('ht_show_overtime_bar') !== 'false'; // default: visible
let overtimeThresholdHours = parseFloat(localStorage.getItem('ht_overtime_threshold') || '40');
let overtimeRate = parseFloat(localStorage.getItem('ht_overtime_rate') || '1.5');
let breakReminderHours = parseFloat(localStorage.getItem('ht_break_reminder_hours') || '6');
let autoBreakMins = parseInt(localStorage.getItem('ht_auto_break_mins') || '30', 10) || 0;
let roundingIncrementMins = parseInt(localStorage.getItem('ht_rounding_increment_mins') || '15', 10) || 15;
let roundingMode = localStorage.getItem('ht_rounding_mode') || 'nearest';
let scheduledStartTime = localStorage.getItem('ht_scheduled_start_time') || '09:00';
let lateGraceMins = parseInt(localStorage.getItem('ht_late_grace_mins') || '10', 10) || 10;
let longShiftAlertHours = parseFloat(localStorage.getItem('ht_long_shift_alert_hours') || '10');
let missedClockOutHours = parseFloat(localStorage.getItem('ht_missed_clock_out_hours') || '14');

const CURRENCIES = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹'
};

function curSym() { return CURRENCIES[currency] || '$'; }

function loadCollection(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function persistCollection(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function collectionItemId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNamedItems(items, prefix) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      id: item?.id || collectionItemId(prefix),
      name: String(item?.name || '').trim(),
      clientId: prefix === 'project' ? (item?.clientId || '') : undefined,
      rate: prefix === 'project' ? (parseFloat(item?.rate) || 0) : undefined
    }))
    .filter(item => item.name)
    .map(item => {
      if (prefix === 'project') return { id: item.id, name: item.name, clientId: item.clientId, rate: item.rate || 0 };
      return { id: item.id, name: item.name };
    });
}

function syncCollections() {
  clients = normalizeNamedItems(clients, 'client');
  projects = normalizeNamedItems(projects, 'project');
  tags = normalizeNamedItems(tags, 'tag');
  persistCollection('ht_clients', clients);
  persistCollection('ht_projects', projects);
  persistCollection('ht_tags', tags);
}

function namesToItems(text, existingItems, prefix) {
  const existingByName = new Map((existingItems || []).map(item => [item.name.toLowerCase(), item]));
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(name => existingByName.get(name.toLowerCase()) || { id: collectionItemId(prefix), name });
}

function projectLineParts(line) {
  const raw = String(line || '').trim();
  if (!raw) return { clientName: '', projectName: '' };
  const parts = raw.split('>').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { clientName: parts[0], projectName: parts.slice(1).join(' > ') };
  return { clientName: '', projectName: raw };
}

function projectsFromText(text, existingProjects, currentClients) {
  const existingByName = new Map((existingProjects || []).map(item => [`${(item.clientId || '')}|${item.name.toLowerCase()}`, item]));
  const clientByName = new Map((currentClients || []).map(item => [item.name.toLowerCase(), item]));
  return String(text || '')
    .split(/\r?\n/)
    .map(line => projectLineParts(line))
    .filter(item => item.projectName)
    .map(item => {
      const client = item.clientName ? clientByName.get(item.clientName.toLowerCase()) : null;
      const key = `${client?.id || ''}|${item.projectName.toLowerCase()}`;
      const existing = existingByName.get(key);
      return existing || {
        id: collectionItemId('project'),
        name: item.projectName,
        clientId: client?.id || ''
      };
    });
}

function saveMetadataLists() {}
function renderMetadataSettings() {}

function optionsHtml(items, selectedId, placeholder) {
  const base = [`<option value="">${esc(placeholder)}</option>`];
  return base.concat((items || []).map(item =>
    `<option value="${esc(item.id)}"${item.id === selectedId ? ' selected' : ''}>${esc(item.name)}</option>`
  )).join('');
}

function projectOptionsHtml(selectedId) {
  const base = [`<option value="">None</option>`];
  return base.concat((projects || []).map(item => {
    const client = findNamedItem(clients, item.clientId);
    const label = client ? `${client.name} > ${item.name}` : item.name;
    return `<option value="${esc(item.id)}"${item.id === selectedId ? ' selected' : ''}>${esc(label)}</option>`;
  })).join('');
}

function money(mins) {
  if (!(hourlyRate > 0) || !(mins > 0)) return '';
  return `${curSym()}${(hourlyRate * mins / 60).toFixed(2)}`;
}


function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

const _el = {};
function $(id) {
  return _el[id] || (_el[id] = document.getElementById(id));
}

function iosAlert(message, title) {
  return iosDialog({ title: title || '', message, buttons: [{ label: 'OK', value: true, primary: true }] });
}
function iosConfirm(message, opts) {
  opts = opts || {};
  return iosDialog({
    title: opts.title || '',
    message,
    buttons: [
      { label: opts.cancelLabel || 'Cancel', value: false },
      { label: opts.okLabel || 'OK', value: true, primary: !opts.danger, danger: !!opts.danger }
    ]
  });
}
function iosDialog({ title, message, buttons }) {
  return new Promise(resolve => {
    let overlay = document.getElementById('iosAlertOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'iosAlertOverlay';
      overlay.className = 'ios-alert-overlay';
      document.body.appendChild(overlay);
    }
    const btnHtml = buttons.map((b, i) => {
      const cls = 'ia-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      return `<button class="${cls}" data-idx="${i}">${esc(b.label)}</button>`;
    }).join('');
    overlay.innerHTML = `
      <div class="ios-alert" role="alertdialog" aria-modal="true">
        <div class="ia-body">
          ${title ? `<div class="ia-title">${esc(title)}</div>` : ''}
          ${message ? `<div class="ia-msg">${esc(message)}</div>` : ''}
        </div>
        <div class="ia-btns">${btnHtml}</div>
      </div>`;
    overlay.classList.add('open');
    const cleanup = (val) => {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') {
        const primary = buttons.find(b => b.primary);
        cleanup(primary ? primary.value : buttons[buttons.length - 1].value);
      }
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelectorAll('.ia-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        cleanup(buttons[idx].value);
      });
    });
  });
}

function iosPrompt(message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let overlay = document.getElementById('iosAlertOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'iosAlertOverlay';
      overlay.className = 'ios-alert-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="ios-alert" role="alertdialog" aria-modal="true">
        <div class="ia-body">
          ${opts.title ? `<div class="ia-title">${esc(opts.title)}</div>` : ''}
          <div class="ia-msg">${esc(message)}</div>
          <input type="text" id="iosPromptInput" placeholder="${esc(opts.placeholder || '')}" style="width:90%;margin-top:10px;padding:8px 12px;border:1px solid var(--separator);border-radius:8px;font-size:16px;font-family:var(--font);background:var(--bg);color:var(--label);text-align:center;">
        </div>
        <div class="ia-btns">
          <button class="ia-btn" id="iosPromptCancel">Cancel</button>
          <button class="ia-btn danger" id="iosPromptOk">${esc(opts.okLabel || 'OK')}</button>
        </div>
      </div>`;
    overlay.classList.add('open');
    const input = document.getElementById('iosPromptInput');
    setTimeout(() => input.focus(), 100);
    const cleanup = (val) => {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(null);
      else if (e.key === 'Enter') cleanup(input.value.trim());
    };
    document.addEventListener('keydown', onKey);
    document.getElementById('iosPromptCancel').addEventListener('click', () => cleanup(null));
    document.getElementById('iosPromptOk').addEventListener('click', () => cleanup(input.value.trim()));
  });
}

const PRESETS = {};
const SCHEMA_VERSION = 4;

function loadStoredData() {
  try {
    const raw = localStorage.getItem('ht_db4');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version && parsed.entries && typeof parsed.entries === 'object') {
      return { version: parsed.version, entries: parsed.entries };
    }
    return { version: 1, entries: parsed };
  } catch (e) {
    console.error('Corrupted db, starting fresh', e);
    return null;
  }
}

function sessionLegacyId(sourceKey, index, session) {
  return `legacy:${sourceKey || 'unknown'}:${index}:${session?.in || ''}:${session?.out || ''}`;
}

function normalizeSession(session, sourceKey = '', index = 0) {
  const s = session && typeof session === 'object' ? session : {};
  return {
    id: s.id || sessionLegacyId(sourceKey, index, s),
    in: s.in || '',
    out: s.out || '',
    brk: parseInt(s.brk, 10) || 0,
    inISO: s.inISO || '',
    outISO: s.outISO || '',
    clientId: s.clientId || '',
    projectId: s.projectId || '',
    tagIds: Array.isArray(s.tagIds) ? s.tagIds.filter(Boolean) : [],
    timezone: s.timezone || '',
    createdAt: s.createdAt || s.inISO || '',
    updatedAt: s.updatedAt || s.outISO || s.inISO || '',
    source: s.source || 'manual'
  };
}

function findNamedItem(items, id) {
  return (items || []).find(item => item.id === id) || null;
}

function sessionMatchesFilters(session, filters = {}) {
  const clientId = filters.clientId != null ? filters.clientId : selectedClientFilter;
  const projectId = filters.projectId != null ? filters.projectId : selectedProjectFilter;
  if (clientId && session?.clientId !== clientId) return false;
  if (projectId && session?.projectId !== projectId) return false;
  return true;
}

function renderProjectSummary() {}
function getProjectSummaries() { return []; }

function getWeeklyIssues(days) {
  const issues = [];
  let breakFlags = 0;
  let longShiftFlags = 0;

  (days || []).forEach(day => {
    const key = typeof day === 'string' ? day : dk(day);
    const entry = getEntry(key);
    getSessions(entry).forEach(session => {
      const total = getSessionTotalMins(key, session);
      if (total >= breakReminderHours * 60 && !(session.brk > 0)) breakFlags++;
      if (total > MAX_SESSION_MINS) longShiftFlags++;
    });
  });

  const open = findLatestOpenSession();
  if (open) issues.push('Active shift still open');
  // break reminder message suppressed
  if (longShiftFlags) issues.push(`${longShiftFlags} unusually long shift${longShiftFlags !== 1 ? 's' : ''}`);
  return issues;
}

function getAttendanceFlags(dayKey) {
  const entry = getEntry(dayKey);
  const sessions = getSessions(entry).filter(session => session.in);
  const flags = [];
  if (!sessions.length) return flags;

  const firstSession = sessions[0];
  const { start } = getSessionBounds(dayKey, firstSession);
  const scheduled = parseSessionDateTime(dayKey, scheduledStartTime, '');
  if (start && scheduled) {
    const lateBy = Math.floor((start - scheduled) / 60000);
    if (lateBy > lateGraceMins) {
      flags.push({ type: 'late', label: `Late by ${lateBy}m` });
    }
  }

  sessions.forEach(session => {
    const total = getSessionTotalMins(dayKey, session);
    if (total > longShiftAlertHours * 60) {
      flags.push({ type: 'long', label: `Long shift ${fmtMins(total)}` });
    }
  });

  const open = getOpenSession(entry);
  if (open) {
    const bounds = getSessionBounds(dayKey, open);
    if (bounds.start) {
      const openMins = Math.floor((new Date() - bounds.start) / 60000);
      if (openMins > missedClockOutHours * 60) {
        flags.push({ type: 'missed', label: 'Possible missed clock-out' });
      }
    }
  }

  return flags;
}

function getAttendanceSummary(days) {
  const summary = { late: 0, long: 0, missed: 0 };
  (days || []).forEach(day => {
    const key = typeof day === 'string' ? day : dk(day);
    getAttendanceFlags(key).forEach(flag => {
      if (flag.type === 'late') summary.late++;
      if (flag.type === 'long') summary.long++;
      if (flag.type === 'missed') summary.missed++;
    });
  });
  return summary;
}

async function maybeRecoverMissedClockOut() {
  const open = findLatestOpenSession();
  if (!open || !open.start) return;
  const elapsedMins = Math.floor((new Date() - open.start) / 60000);
  if (elapsedMins <= missedClockOutHours * 60) return;

  const recoveryKey = `${open.key}:${open.index}:${open.start.toISOString()}`;
  if (localStorage.getItem('ht_lastMissedClockOutPrompt') === recoveryKey) return;
  localStorage.setItem('ht_lastMissedClockOutPrompt', recoveryKey);

  const closeNow = await iosConfirm(
    `An open shift started ${fmt12(open.session.in)} on ${open.key} and has been running for ${fmtMins(elapsedMins)}. Close it now?`,
    { okLabel: 'Close Shift', title: 'Missed clock-out detected' }
  );
  if (!closeNow) return;

  const entry = getEntry(open.key);
  if (!entry.sessions[open.index] || entry.sessions[open.index].out) return;
  const now = new Date();
  entry.sessions[open.index].out = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  entry.sessions[open.index].outISO = now.toISOString();
  entry.sessions[open.index] = applyAutoBreakToSession(entry.sessions[open.index], open.key);
  setEntry(open.key, entry);
  persist();

  if (clockInKey === open.key && activeSessionIndex === open.index) {
    clockedIn = false;
    clockInTime = null;
    clockInKey = null;
    activeSessionIndex = null;
    saveClockState();
    syncClockUI();
  }

  renderWeek();
  if ($('page-clock').classList.contains('active')) renderClockPage();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  showExportToast('Recovered missed clock-out');
}


function renderPayrollReview(days) {
  const review = getPayrollReview(days);
  $('payrollReviewSub').textContent = review.issues.length
    ? `${review.issues.length} issue${review.issues.length !== 1 ? 's' : ''} need attention before payroll`
    : 'Current pay period looks ready for payroll';
  $('payrollOpenCount').textContent = String(review.open);
  $('payrollSubmittedCount').textContent = String(review.submitted);
  $('payrollApprovedCount').textContent = String(review.approved);
  $('payrollLockedCount').textContent = String(review.locked);
  $('payrollIssues').innerHTML = review.issues.length
    ? review.issues.map(item => `<div class="payroll-issue">${esc(item)}</div>`).join('')
    : `<div class="payroll-issue" style="background:rgba(52,199,89,0.12);color:var(--green);">No payroll blockers detected for this pay period.</div>`;
}

function openPayrollReviewSheet() {
  const days = getPayPeriodKeys();
  const review = getPayrollReview(days);
  $('payrollSheetSub').textContent = `${review.keys.length} day pay period • ${review.issues.length} issue${review.issues.length !== 1 ? 's' : ''}`;

  const rows = [];
  review.keys.forEach(key => {
    const entry = getEntry(key);
    if (!hasAnyData(entry)) return;
    const mins = getWorkedMins(entry, key);
    const status = payrollStatusMeta(getEntryStatus(key));
    const note = entry.note ? ` • ${entry.note}` : '';
    rows.push(`
      <div class="review-item">
        <div class="review-item-title">${key} • ${status.label}</div>
        <div class="review-item-sub">${fmtMins(mins) || '—'}${note}</div>
      </div>
    `);
  });

  review.issues.forEach(issue => {
    rows.push(`
      <div class="review-item">
        <div class="review-item-title">Issue</div>
        <div class="review-item-sub">${esc(issue)}</div>
      </div>
    `);
  });

  $('payrollReviewList').innerHTML = rows.join('') || `
    <div class="review-item">
      <div class="review-item-title">No time recorded</div>
      <div class="review-item-sub">This pay period does not have any entries yet.</div>
    </div>
  `;
  $('payrollOverlay').classList.add('open');
}

function closePayrollReviewSheet() {
  $('payrollOverlay').classList.remove('open');
}

function filteredDaySegments(dayKey, filters = {}) {
  return getDaySessionSegments(dayKey).filter(seg => sessionMatchesFilters(seg.session, filters));
}

function renderFilterControls() {}



function sessionMetaText(session) {
  const parts = [];
  const project = findNamedItem(projects, session?.projectId);
  const client = findNamedItem(clients, session?.clientId || project?.clientId);
  const sessionTags = (session?.tagIds || [])
    .map(id => findNamedItem(tags, id))
    .filter(Boolean)
    .map(item => item.name);

  if (client) parts.push(client.name);
  if (project) parts.push(project.name);
  if (sessionTags.length) parts.push(sessionTags.join(', '));
  return parts.join(' • ');
}

function normalizeEntry(entry, sourceKey = '') {
  if (!entry || typeof entry !== 'object') {
    return { sessions: [], note: '', lockedAt: '', status: 'open', dayType: 'work' };
  }

  if (Array.isArray(entry.sessions)) {
    return {
      sessions: entry.sessions.map((s, index) => normalizeSession(s, sourceKey, index)),
      note: entry.note || '',
      lockedAt: entry.lockedAt || '',
      status: entry.status || 'open',
      dayType: entry.dayType || 'work'
    };
  }

  if (entry.in || entry.out) {
    return {
      sessions: [normalizeSession({
        id: entry.id || '',
        in: entry.in || '',
        out: entry.out || '',
        brk: parseInt(entry.brk, 10) || 0,
        inISO: entry.inISO || '',
        outISO: entry.outISO || '',
        clientId: entry.clientId || '',
        projectId: entry.projectId || '',
        tagIds: entry.tagIds || [],
        timezone: entry.timezone || '',
        createdAt: entry.createdAt || '',
        updatedAt: entry.updatedAt || '',
        source: entry.source || 'manual'
      }, sourceKey, 0)],
      note: entry.note || '',
      lockedAt: entry.lockedAt || '',
      status: entry.status || 'open',
      dayType: entry.dayType || 'work'
    };
  }

  return {
    sessions: [],
    note: entry.note || '',
    lockedAt: entry.lockedAt || '',
    status: entry.status || 'open',
    dayType: entry.dayType || 'work'
  };
}

function migrateEntries(rawEntries) {
  const clean = {};
  Object.entries(rawEntries || {}).forEach(([key, entry]) => {
    const normalized = normalizeEntry(entry, key);
    if (normalized.sessions.length || normalized.note) {
      clean[key] = normalized;
    }
  });
  return clean;
}

const loaded = loadStoredData();
let db = loaded && loaded.entries && typeof loaded.entries === 'object'
  ? migrateEntries(loaded.entries)
  : JSON.parse(JSON.stringify(PRESETS));

if (!db || typeof db !== 'object') {
  db = JSON.parse(JSON.stringify(PRESETS));
}

function persist() {
  try {
    const wrapper = { version: SCHEMA_VERSION, entries: db };
    localStorage.setItem('ht_db4', JSON.stringify(wrapper));
  } catch (e) {
    iosAlert('Could not save data. Storage may be full or disabled. Please export a backup.', 'Storage error');
  }
  // Mirror to IndexedDB
  idbSave(buildFullBackupPayload());
  // Auto-save to file if linked
  if (_fileHandle) fileAutoSave();
}

try {
  const raw = localStorage.getItem('ht_db4');
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && (!parsed.version || parsed.version < SCHEMA_VERSION)) persist();
  } else {
    persist();
  }
} catch (e) {}

function p2(n) { return String(n).padStart(2,'0'); }
function dk(d) { return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
function dayStartFromKey(dayKey) {
  const [year, month, day] = (dayKey || '').split('-').map(Number);
  if ([year, month, day].some(n => Number.isNaN(n))) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}
function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function toLocalInputValue(dateLike) {
  if (!dateLike) return '';
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (isNaN(d)) return '';
  return `${dk(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function parseSessionDateTime(dayKey, timeStr, isoStr) {
  if (isoStr) {
    const parsed = new Date(isoStr);
    if (!isNaN(parsed)) return parsed;
  }
  if (!dayKey || !timeStr) return null;
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hours, mins] = timeStr.split(':').map(Number);
  if ([year, month, day, hours, mins].some(n => Number.isNaN(n))) return null;
  return new Date(year, month - 1, day, hours, mins, 0, 0);
}

function minsBetween(a, b) {
  if (!a || !b) return 0;
  const [ah,am] = a.split(':').map(Number);
  const [bh,bm] = b.split(':').map(Number);
  let d = (bh*60+bm)-(ah*60+am);
  if (d < 0) d += 1440;
  return d;
}

function fmtMins(m) {
  if (!m || m <= 0) return '—';
  return `${Math.floor(m/60)}h ${p2(m%60)}m`;
}

function fmt12(t) {
  if (!t) return '—';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${p2(m)} ${h>=12?'PM':'AM'}`;
}

function fmtSecs(s) {
  const h = p2(Math.floor(s/3600));
  const m = p2(Math.floor((s%3600)/60));
  const sec = p2(s%60);
  return `${h}:${m}<span class="c-secs">:${sec}</span>`;
}

function weekStartsOnMonday() {
  return (localStorage.getItem('ht_weekStart') || 'monday') === 'monday';
}

function weekDays(offset) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const dow = today.getDay();
  const startMon = weekStartsOnMonday();
  const back = startMon ? ((dow + 6) % 7) : dow;
  const base = new Date(today);
  base.setDate(today.getDate() - back);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + offset*7 + i);
    return d;
  });
}

function getEntry(key) {
  return normalizeEntry(db[key], key);
}

function setEntry(key, entry) {
  const clean = normalizeEntry(entry, key);
  if (!clean.sessions.length && !clean.note) delete db[key];
  else db[key] = clean;
}

function hasAnyData(entry) {
  const e = normalizeEntry(entry);
  return e.sessions.some(s => s.in || s.out) || !!e.note || (e.dayType && e.dayType !== 'work');
}

function getSessions(entry) {
  return normalizeEntry(entry).sessions;
}

function getClosedSessions(entry) {
  return getSessions(entry).filter(s => s.in && s.out);
}

function getOpenSession(entry) {
  return getSessions(entry).find(s => s.in && !s.out) || null;
}

function getSessionBounds(dayKey, session) {
  if (!session?.in) return { start: null, end: null };

  const start = parseSessionDateTime(dayKey, session.in, session.inISO);
  let end = null;
  if (session.out) {
    end = parseSessionDateTime(dayKey, session.out, session.outISO);
    if (start && end && !session.outISO && end < start) {
      end = addDays(end, 1);
    }
  }

  return { start, end };
}

function getSessionTotalMins(dayKey, session) {
  const { start, end } = getSessionBounds(dayKey, session);
  if (start && end) return Math.max(0, Math.floor((end - start) / 60000));
  return minsBetween(session?.in, session?.out);
}

function getSessionMins(dayKey, session) {
  if (!session?.in || !session?.out) return 0;

  const mins = getSessionTotalMins(dayKey, session);
  return roundMins(Math.max(0, mins - (session.brk || 0)));
}

function getWorkedMins(entry, dayKey = '') {
  return getClosedSessions(entry).reduce((sum, s) => {
    return sum + getSessionMins(dayKey, s);
  }, 0);
}

function getDaySessionSegments(dayKey) {
  const dayStart = dayStartFromKey(dayKey);
  if (!dayStart) return [];
  const dayEnd = addDays(dayStart, 1);
  const segments = [];

  Object.entries(db || {}).forEach(([sourceKey, entry]) => {
    getSessions(entry).forEach((session, index) => {
      if (!session?.in) return;
      const { start, end } = getSessionBounds(sourceKey, session);
      if (!start) return;

      if (!end) {
        const now = new Date();
        if (start < dayEnd && now > dayStart) {
          const segStart = start > dayStart ? start : dayStart;
          const segEnd = now < dayEnd ? now : dayEnd;
          if (segStart < segEnd) {
            segments.push({
              sourceKey,
              index,
              session,
              start: segStart,
              end: segEnd,
              segmentMins: 0,
              workedMins: 0,
              breakMins: 0,
              running: true
            });
          }
        }
        return;
      }

      const segStart = start > dayStart ? start : dayStart;
      const segEnd = end < dayEnd ? end : dayEnd;
      if (segEnd <= segStart) return;

      const totalMins = Math.max(1, getSessionTotalMins(sourceKey, session));
      const segmentMins = Math.floor((segEnd - segStart) / 60000);
      const breakMins = Math.min(session.brk || 0, (session.brk || 0) * (segmentMins / totalMins));
      segments.push({
        sourceKey,
        index,
        session,
        start: segStart,
        end: segEnd,
        segmentMins,
        workedMins: Math.max(0, segmentMins - breakMins),
        breakMins,
        running: false
      });
    });
  });

  return segments.sort((a, b) => a.start - b.start);
}

function getWorkedMinsForDay(dayKey, filters = {}) {
  return Math.round(filteredDaySegments(dayKey, filters).reduce((sum, seg) => sum + seg.workedMins, 0));
}

function getTotalBreakForDay(dayKey, filters = {}) {
  return Math.round(filteredDaySegments(dayKey, filters).reduce((sum, seg) => sum + seg.breakMins, 0));
}

function hasAnyDataForDay(dayKey, filters = {}) {
  const includeNotes = !filters.clientId && !filters.projectId;
  if (includeNotes && hasAnyData(getEntry(dayKey))) return true;
  return filteredDaySegments(dayKey, filters).length > 0;
}

function getDaySessionCount(dayKey, filters = {}) {
  const uniq = new Set(filteredDaySegments(dayKey, filters).map(seg => `${seg.sourceKey}:${seg.index}`));
  return uniq.size;
}

function getDayDisplayRange(dayKey, filters = {}) {
  const segments = filteredDaySegments(dayKey, filters);
  if (!segments.length) return { text: '', count: 0 };
  const first = segments[0];
  const last = segments[segments.length - 1];
  const startText = `${p2(first.start.getHours())}:${p2(first.start.getMinutes())}`;
  const endText = last.running || !last.end
    ? 'Running'
    : `${p2(last.end.getHours())}:${p2(last.end.getMinutes())}`;
  return { text: `${fmt12(startText)} – ${endText === 'Running' ? 'Running' : fmt12(endText)}`, count: getDaySessionCount(dayKey, filters) };
}

function getFirstInForDay(dayKey, filters = {}) {
  const first = filteredDaySegments(dayKey, filters)[0];
  return first ? `${p2(first.start.getHours())}:${p2(first.start.getMinutes())}` : '';
}

function getLastOutForDay(dayKey, filters = {}) {
  const segments = filteredDaySegments(dayKey, filters);
  if (!segments.length) return '';
  const last = segments[segments.length - 1];
  if (last.running || !last.end) return '';
  return `${p2(last.end.getHours())}:${p2(last.end.getMinutes())}`;
}

function updateSessionDateTime(session, field, value) {
  const isoField = field + 'ISO';
  if (!value) {
    session[field] = '';
    session[isoField] = '';
    return;
  }
  const date = new Date(value);
  if (isNaN(date)) {
    session[field] = '';
    session[isoField] = '';
    return;
  }
  session[field] = `${p2(date.getHours())}:${p2(date.getMinutes())}`;
  session[isoField] = date.toISOString();
}

function applyAutoBreakToSession(session, dayKey) {
  return session;
}

function roundMins(mins) {
  return mins > 0 ? mins : 0;
}

function getPayPeriodKeys(offset = weekOffset) {
  return weekDays(offset).map(d => dk(d));
}

function isEntryLocked(key) {
  const entry = getEntry(key);
  return !!entry.lockedAt || entry.status === 'locked';
}

function getEntryStatus(key) {
  return getEntry(key).status || 'open';
}

function setEntryStatus(key, status, extra = {}) {
  const entry = getEntry(key);
  entry.status = status;
  if (status === 'locked') entry.lockedAt = extra.lockedAt || new Date().toISOString();
  else if (status !== 'locked') entry.lockedAt = '';
  setEntry(key, entry);
}

function getPayrollReview(days) {
  const keys = (days || []).map(d => typeof d === 'string' ? d : dk(d));
  const issues = getWeeklyIssues(keys);
  let approved = 0;
  let open = 0;
  let locked = 0;
  let submitted = 0;

  keys.forEach(key => {
    const entry = getEntry(key);
    if (!hasAnyData(entry)) return;
    const status = getEntryStatus(key);
    if (status === 'approved') approved++;
    else if (status === 'submitted') submitted++;
    else if (status === 'locked') locked++;
    else open++;
  });

  return { issues, approved, submitted, locked, open, keys };
}

function payrollStatusMeta(status) {
  const value = status || 'open';
  if (value === 'submitted') return { label: 'Submitted', cls: 'submitted' };
  if (value === 'approved') return { label: 'Approved', cls: 'approved' };
  if (value === 'locked') return { label: 'Paid ✓', cls: 'locked' };
  return { label: 'Open', cls: 'open' };
}

async function submitWeekForApproval() {
  const review = getPayrollReview(getPayPeriodKeys());
  review.keys.forEach(key => {
    const entry = getEntry(key);
    if (hasAnyData(entry) && !isEntryLocked(key)) setEntryStatus(key, 'submitted');
  });
  persist();
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
}

async function approveWeek() {
  const review = getPayrollReview(getPayPeriodKeys());
  if (review.issues.length) {
    const ok = await iosConfirm(`There are ${review.issues.length} payroll issue(s). Approve anyway?`, { okLabel: 'Approve', title: 'Payroll review' });
    if (!ok) return;
  }
  review.keys.forEach(key => {
    const entry = getEntry(key);
    if (hasAnyData(entry) && !isEntryLocked(key)) setEntryStatus(key, 'approved');
  });
  persist();
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
}

async function lockWeek() {
  const review = getPayrollReview(getPayPeriodKeys());
  const ok = await iosConfirm(
    'Mark this week as Paid? Paid entries are locked and can no longer be edited.',
    { okLabel: 'Mark as Paid', danger: true, title: '💰 Mark Week as Paid' }
  );
  if (!ok) return;
  review.keys.forEach(key => {
    const entry = getEntry(key);
    if (hasAnyData(entry)) setEntryStatus(key, 'locked', { lockedAt: new Date().toISOString() });
  });
  persist();
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  showExportToast('Week marked as Paid ✓');
}

const MAX_SESSION_MINS = 16 * 60;

function getSessionWarnings(dayKey, session, index) {
  const warnings = [];
  const totalMins = getSessionTotalMins(dayKey, session);

  if ((session.brk || 0) > totalMins && totalMins > 0) {
    warnings.push(`Session ${index + 1} has a break longer than the shift.`);
  }
  if (totalMins > MAX_SESSION_MINS) {
    warnings.push(`Session ${index + 1} is ${fmtMins(totalMins)} long. Please confirm this long shift is correct.`);
  }

  return warnings;
}

function findLatestOpenSession() {
  let latest = null;

  Object.entries(db || {}).forEach(([key, entry]) => {
    getSessions(entry).forEach((session, index) => {
      if (!session?.in || session.out) return;
      const { start } = getSessionBounds(key, session);
      if (!start || isNaN(start)) return;
      if (!latest || start > latest.start) {
        latest = { key, index, start, session };
      }
    });
  });

  return latest;
}

function getTotalBreak(entry) {
  return getClosedSessions(entry).reduce((sum, s) => sum + (s.brk || 0), 0);
}

function getFirstIn(entry) {
  const sessions = getSessions(entry).filter(s => s.in);
  return sessions.length ? sessions[0].in : '';
}

function getLastOut(entry) {
  const sessions = getSessions(entry).filter(s => s.in);
  if (!sessions.length) return '';
  const last = sessions[sessions.length - 1];
  return last.out || '';
}

function getDisplayRange(entry) {
  const sessions = getSessions(entry).filter(s => s.in);
  if (!sessions.length) return { text: '', count: 0 };
  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  if (sessions.length === 1) {
    if (first.in && first.out) return { text: `${fmt12(first.in)} – ${fmt12(first.out)}`, count: 1 };
    if (first.in && !first.out) return { text: `${fmt12(first.in)} – Running`, count: 1 };
  }

  const endText = last.out ? fmt12(last.out) : 'Running';
  return { text: `${fmt12(first.in)} – ${endText}`, count: sessions.length };
}

function calcSessionMins(session) {
  if (!session?.in || !session?.out) return 0;
  return getSessionMins(editKey || '', session);
}

function switchTab(name) {
  ['tracker','calendar','clock','settings'].forEach(n => {
    document.getElementById('page-'+n).classList.remove('active');
    const tabBtn = document.getElementById('tab-'+n);
    tabBtn.classList.remove('active');
    tabBtn.setAttribute('aria-selected', 'false');
  });
  document.getElementById('page-'+name).classList.add('active');
  const activeBtn = document.getElementById('tab-'+name);
  activeBtn.classList.add('active');
  activeBtn.setAttribute('aria-selected', 'true');
  if (name === 'calendar') renderCalendar();
  if (name === 'clock') renderClockPage();
  if (name === 'settings') {
    document.getElementById('rateInput').value = hourlyRate.toFixed(2);
    renderDailyScheduleSettings();
  }
  // Hide floating week nav when not on tracker tab
  const floatNav = document.getElementById('floatWeekNav');
  if (floatNav && name !== 'tracker') {
    floatNav.classList.remove('visible');
    floatNav.setAttribute('aria-hidden', 'true');
  }
  
  // Slider calculation
  const TABS = ['tracker','calendar','clock','settings'];
  const idx = TABS.indexOf(name);
  if (idx !== -1) {
    window._activeTabIndex = idx;
    const slider = document.getElementById('tabSlider');
    if (slider) slider.style.transform = `translateX(${idx * 100}%)`;
  }
}

// ── Drag Slider Logic ──
(function initTabDragging() {
  window._activeTabIndex = 0;
  // Use a slight timeout to ensure DOM is fully ready
  setTimeout(() => {
    const tabBar = document.getElementById('tabBar');
    const slider = document.getElementById('tabSlider');
    if (!tabBar || !slider) return;

    const TABS = ['tracker','calendar','clock','settings'];
    let isDragging = false;

    tabBar.addEventListener('pointerdown', (e) => {
      // Only care about touch or left click
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      isDragging = true;
      slider.classList.add('dragging');
      try { tabBar.setPointerCapture(e.pointerId); } catch(err){}
    });

    tabBar.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const rect = tabBar.getBoundingClientRect();
      const tabWidth = (rect.width - 16) / 4; 
      let rawIndex = (e.clientX - rect.left - 8) / tabWidth;
      rawIndex = Math.max(0, Math.min(3, rawIndex - 0.5));
      slider.style.transform = `translateX(${rawIndex * 100}%)`;
    });

    tabBar.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      slider.classList.remove('dragging');
      try { tabBar.releasePointerCapture(e.pointerId); } catch(err){}

      const rect = tabBar.getBoundingClientRect();
      const tabWidth = (rect.width - 16) / 4;
      let newIndex = Math.floor((e.clientX - rect.left - 8) / tabWidth);
      newIndex = Math.max(0, Math.min(3, newIndex));
      
      switchTab(TABS[newIndex]);
    });

    tabBar.addEventListener('pointercancel', (e) => {
      if (!isDragging) return;
      isDragging = false;
      slider.classList.remove('dragging');
      slider.style.transform = `translateX(${window._activeTabIndex * 100}%)`;
    });
  }, 100);
})();

function renderWeek() {
  const filters = { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  const days = weekDays(weekOffset);
  const first = days[0], last = days[6];
  const sameMonth = first.getMonth() === last.getMonth();
  const wkDatesText = sameMonth
    ? `${MO[first.getMonth()]} ${first.getDate()} – ${last.getDate()}`
    : `${MO[first.getMonth()]} ${first.getDate()} – ${MO[last.getMonth()]} ${last.getDate()}`;
  const wkYearText = String(first.getFullYear());

  document.getElementById('wkDates').textContent = wkDatesText;
  document.getElementById('wkYear').textContent = wkYearText;

  // Keep the floating nav in sync
  const floatDates = document.getElementById('floatWkDates');
  const floatYear = document.getElementById('floatWkYear');
  if (floatDates) floatDates.textContent = wkDatesText;
  if (floatYear) floatYear.textContent = wkYearText;

  const todayKey = dk(new Date());
  let totalMins = 0, logged = 0;
  const list = document.getElementById('dayList');
  list.innerHTML = '';

  days.forEach(d => {
    const key = dk(d);
    const e = getEntry(key);
    const isToday = key === todayKey;
    const hasData = hasAnyDataForDay(key, filters);
    const worked = getWorkedMinsForDay(key, filters);

    if (worked > 0) {
      totalMins += worked;
      logged++;
    }

    const earn = money(worked);
    const range = getDayDisplayRange(key, filters);
    const sessionCount = getDaySessionCount(key, filters);
    const breakMins = getTotalBreakForDay(key, filters);
    const note = e.note || '';
    const sessionMeta = getSessions(e).filter(session => sessionMatchesFilters(session, filters)).map(sessionMetaText).filter(Boolean);
    const status = payrollStatusMeta(getEntryStatus(key));
    const circClass = isToday ? 'is-today' : hasData ? 'has-data' : '';

    const dayType = getDayStatus(key);
    const subParts = [];
    if (dayType !== 'work') subParts.push(dayType.charAt(0).toUpperCase() + dayType.slice(1));
    if (sessionCount > 1) subParts.push(`${sessionCount} sessions`);
    if (breakMins > 0) subParts.push(`${breakMins} min break`);
    if (sessionMeta.length) subParts.push(esc(sessionMeta[0]));
    if (note) subParts.push(esc(note));

    const isPaid = isEntryLocked(key);
    const row = document.createElement('div');
    row.className = 'day-row';
    row.onclick = () => openSheet(key, d);

    if (isPaid) {
      row.style.opacity = '0.6';
      row.style.cursor = 'default';
      row.innerHTML = `
        <div class="day-circle ${circClass}">
          <span class="dc-name">${DS[d.getDay()]}</span>
          <span class="dc-num">${d.getDate()}</span>
        </div>
        <div class="day-mid">
          <div class="day-row-top">
            <div class="day-time-str" style="color:var(--tertiary);">Hours locked</div>
            <span class="day-status-pill locked">Paid ✓</span>
          </div>
        </div>
        <div class="day-right">
          <div class="day-hrs ${worked?'':'zero'}">${worked ? `<span class="day-hrs-sym">${curSym()}</span>${(hourlyRate * worked / 60).toFixed(0)}` : '—'}</div>
          ${worked ? `<div class="day-earn">${fmtMins(worked)}</div>` : ''}
        </div>
        <span class="material-symbols-outlined day-chev" style="font-size:16px;">lock</span>`;
    } else {
      row.innerHTML = `
        <div class="day-circle ${circClass}">
          <span class="dc-name">${DS[d.getDay()]}</span>
          <span class="dc-num">${d.getDate()}</span>
        </div>
        <div class="day-mid">
          <div class="day-row-top">
            <div class="day-time-str ${hasData?'':'empty'}">
              ${hasData ? esc(range.text || 'Tap to edit') : 'Tap to add hours'}
            </div>
            ${hasAnyData(e) ? `<span class="day-status-pill ${status.cls}">${status.label}</span>` : ''}
          </div>
          ${subParts.length ? `<div class="day-sub">${subParts.join(' · ')}</div>` : ''}
        </div>
        <div class="day-right">
          <div class="day-hrs ${worked?'':'zero'}">${worked ? `<span class="day-hrs-sym">${curSym()}</span>${(hourlyRate > 0 ? (hourlyRate * worked / 60).toFixed(0) : fmtMins(worked))}` : '—'}</div>
          ${worked && hourlyRate > 0 ? `<div class="day-earn">${fmtMins(worked)}</div>` : (worked ? '' : '')}
        </div>
        <span class="material-symbols-outlined day-chev" style="font-size:18px;color:var(--outline);">chevron_right</span>`;
    }
    list.appendChild(row);
  });

  // Update banner: earnings is primary, hours is subtitle
  const weeklyEarn = money(totalMins);
  const earnDisplay = weeklyEarn ? weeklyEarn.replace(/^[^0-9]/, '') : '—'; // strip leading currency symbol (it's in bannerSym span)
  document.getElementById('totalEarn').textContent = earnDisplay;
  const bannerSym = document.getElementById('bannerSym');
  if (bannerSym) bannerSym.textContent = weeklyEarn ? curSym() : '';
  document.getElementById('totalHrs').textContent = totalMins > 0 ? fmtMins(totalMins) + ' tracked' : 'No hours logged';
  const avg = logged > 0 ? Math.round(totalMins / logged) : 0;
  document.getElementById('avgTxt').textContent = `Avg ${avg ? fmtMins(avg) : '—'} / day`;
  const daysEl = document.getElementById('daysLogged');
  if (daysEl) daysEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;">timer</span> ${logged} day${logged!==1?'s':''} logged${selectedClientFilter || selectedProjectFilter ? ' (filtered)' : ''}`;
  renderProjectSummary(days, filters);
  renderPayrollReview(days);
  renderOvertimeBar(totalMins);
}

function renderOvertimeBar(totalMins) {
  const wrap = document.getElementById('overtimeBarWrap');
  if (!wrap) return;
  if (!showOvertimeBar) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  const thresholdMins = overtimeThresholdHours * 60;
  const pct = Math.min(100, (totalMins / thresholdMins) * 100);
  const fill = document.getElementById('otBarFill');
  const label = document.getElementById('otBarLabel');
  const sub = document.getElementById('otBarSub');

  if (fill) {
    fill.style.width = pct + '%';
    if (pct >= 100) {
      fill.style.background = 'linear-gradient(90deg,#ba1a1a,#dc2626)'; // over threshold → red
    } else if (pct >= 80) {
      fill.style.background = 'linear-gradient(90deg,#ca8a04,#facc15)'; // approaching → amber
    } else {
      fill.style.background = 'linear-gradient(90deg,#16a34a,#22c55e)'; // normal → green
    }
  }

  if (label) label.textContent = `${fmtMins(totalMins)} / ${overtimeThresholdHours}h`;

  if (sub) {
    if (totalMins >= thresholdMins) {
      const overMins = totalMins - thresholdMins;
      sub.textContent = `${fmtMins(overMins)} overtime this week`;
      sub.style.color = 'var(--red)';
    } else {
      const remainMins = thresholdMins - totalMins;
      sub.textContent = `${fmtMins(remainMins)} until overtime`;
      sub.style.color = 'var(--tertiary)';
    }
  }
}

function saveOvertimeBarPref(checked) {
  showOvertimeBar = checked;
  localStorage.setItem('ht_show_overtime_bar', checked ? 'true' : 'false');
  const otTrack = document.getElementById('overtimeBarToggleTrack');
  const otThumb = document.getElementById('overtimeBarToggleThumb');
  if (otTrack) otTrack.style.background = checked ? '#ca8a04' : 'var(--fill)';
  if (otThumb) otThumb.style.left = checked ? '22px' : '2px';
  renderWeek();
}

function changeWeek(dir) {
  weekOffset += dir;
  renderWeek();
}

function openWeekJumper() {
  const input = document.getElementById('weekJumpInput');
  if (!input) return;
  // Set the input to the Monday of the current viewed week
  const days = weekDays(weekOffset);
  input.value = dk(days[0]);
  input.showPicker ? input.showPicker() : input.click();
}

function jumpToDate(dateStr) {
  if (!dateStr) return;
  const target = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  // Calculate how many weeks apart the target is from current week offset
  const todayWeekStart = weekDays(0)[0];
  const diffMs = target.getTime() - todayWeekStart.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  weekOffset = diffWeeks;
  renderWeek();
  showToast(`Jumped to week of ${MO[target.getMonth()]} ${target.getDate()}`);
}

function changeMonth(dir) {
  calMonthOffset += dir;
  renderCalendar();
}

// ═══════════════════════════════════════
//  CALENDAR CUSTOM DATE RANGE
// ═══════════════════════════════════════
let calRangeMode = false;

function toggleCalendarRangeMode() {
  calRangeMode = !calRangeMode;
  const panel       = document.getElementById('calRangePanel');
  const monthNav    = document.getElementById('calMonthNavWrap');
  const monthlySumm = document.getElementById('calMonthlySummary');
  const gridWrap    = document.getElementById('calGridWrap');
  const btn         = document.getElementById('calRangeToggleBtn');

  if (calRangeMode) {
    if (panel)       panel.style.display = 'block';
    if (monthNav)    monthNav.style.display = 'none';
    if (monthlySumm) monthlySumm.style.display = 'none';
    if (gridWrap)    gridWrap.style.display = 'none';
    if (btn)         btn.style.color = 'var(--blue)';
    // Pre-fill with current month range
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const fromInput = document.getElementById('rangeFromInput');
    const toInput   = document.getElementById('rangeToInput');
    if (fromInput && !fromInput.value) fromInput.value = dk(firstOfMonth);
    if (toInput   && !toInput.value)   toInput.value   = dk(today);
    calcDateRange();
  } else {
    if (panel)       panel.style.display = 'none';
    if (monthNav)    monthNav.style.display = 'block';
    if (monthlySumm) monthlySumm.style.display = '';
    if (gridWrap)    gridWrap.style.display = 'block';
    if (btn)         btn.style.color = '';
    renderCalendar();
  }
}

function calcDateRange() {
  const fromVal = document.getElementById('rangeFromInput')?.value;
  const toVal   = document.getElementById('rangeToInput')?.value;
  const result  = document.getElementById('rangeResult');
  const empty   = document.getElementById('rangeEmpty');
  if (!fromVal || !toVal) return;

  const from = new Date(fromVal + 'T00:00:00');
  const to   = new Date(toVal   + 'T23:59:59');
  if (from > to) return;

  const filters = { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  let totalMins = 0, daysWorked = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const key = dk(cur);
    const worked = getWorkedMinsForDay(key, filters);
    if (worked > 0) { totalMins += worked; daysWorked++; }
    cur.setDate(cur.getDate() + 1);
  }

  const totalDays = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
  const label = `${MO[from.getMonth()]} ${from.getDate()} – ${MO[to.getMonth()]} ${to.getDate()}${from.getFullYear() !== to.getFullYear() ? ', '+to.getFullYear() : ''}`;

  document.getElementById('rangeResultLabel').textContent = label;
  document.getElementById('rangeResultDays').textContent  = `${totalDays} day${totalDays!==1?'s':''}`;

  if (totalMins > 0) {
    if (result) result.style.display = 'block';
    if (empty)  empty.style.display  = 'none';
    const avgMins = daysWorked > 0 ? Math.round(totalMins / daysWorked) : 0;
    document.getElementById('rangeResultHrs').textContent        = fmtMins(totalMins);
    document.getElementById('rangeResultDaysWorked').textContent = `${daysWorked} day${daysWorked!==1?'s':''} worked`;
    document.getElementById('rangeResultEarn').textContent       = hourlyRate > 0 ? (money(totalMins) || '—') : '—';
    document.getElementById('rangeResultAvg').textContent        = avgMins ? `Avg ${fmtMins(avgMins)} / day` : '—';
  } else {
    if (result) result.style.display = 'none';
    if (empty)  empty.style.display  = 'block';
  }
}

function setRangePreset(preset) {
  const today = new Date();
  let from, to = new Date(today);

  if (preset === 'last7') {
    from = new Date(today); from.setDate(today.getDate() - 6);
  } else if (preset === 'last30') {
    from = new Date(today); from.setDate(today.getDate() - 29);
  } else if (preset === 'thisMonth') {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (preset === 'lastMonth') {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    to   = new Date(today.getFullYear(), today.getMonth(), 0);
  } else if (preset === 'last3months') {
    from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  } else if (preset === 'thisYear') {
    from = new Date(today.getFullYear(), 0, 1);
  }

  if (!from) return;
  const fromInput = document.getElementById('rangeFromInput');
  const toInput   = document.getElementById('rangeToInput');
  if (fromInput) fromInput.value = dk(from);
  if (toInput)   toInput.value   = dk(to);

  // Highlight active chip
  document.querySelectorAll('.range-chip').forEach(c => c.classList.remove('active'));
  event?.target?.classList.add('active');

  calcDateRange();
}

function openMonthPicker() {
  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
  let selMonth = viewDate.getMonth();
  let selYear = viewDate.getFullYear();
  const currentYear = today.getFullYear();

  const years = [];
  for (let y = currentYear - 10; y <= currentYear + 5; y++) years.push(y);

  let overlay = document.getElementById('monthPickerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'monthPickerOverlay';
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
  }

  const monthsHtml = MONTHS_FULL.map((m, i) =>
    `<button class="mp-item${i === selMonth ? ' selected' : ''}" data-month="${i}">${m}</button>`
  ).join('');
  const yearsHtml = years.map(y =>
    `<button class="mp-item${y === selYear ? ' selected' : ''}" data-year="${y}">${y}</button>`
  ).join('');

  overlay.innerHTML = `
    <div class="mp-sheet" role="dialog" aria-modal="true" aria-label="Jump to month and year">
      <div class="sh-handle"></div>
      <div class="mp-nav">
        <button class="sh-btn cancel" id="mpCancel">Cancel</button>
        <span class="mp-title">Jump to</span>
        <button class="sh-btn save" id="mpDone">Done</button>
      </div>
      <div class="mp-cols">
        <div class="mp-col" id="mpMonthCol">${monthsHtml}</div>
        <div class="mp-col" id="mpYearCol">${yearsHtml}</div>
      </div>
    </div>`;

  const monthCol = overlay.querySelector('#mpMonthCol');
  const yearCol = overlay.querySelector('#mpYearCol');

  const selM = monthCol.querySelector('.selected');
  const selY = yearCol.querySelector('.selected');
  if (selM) monthCol.scrollTop = selM.offsetTop - monthCol.clientHeight / 2 + selM.clientHeight / 2;
  if (selY) yearCol.scrollTop = selY.offsetTop - yearCol.clientHeight / 2 + selY.clientHeight / 2;

  monthCol.addEventListener('click', (e) => {
    const btn = e.target.closest('.mp-item');
    if (!btn) return;
    const prev = monthCol.querySelector('.selected');
    if (prev === btn) return;
    if (prev) prev.classList.remove('selected');
    btn.classList.add('selected');
    selMonth = parseInt(btn.dataset.month, 10);
  });

  yearCol.addEventListener('click', (e) => {
    const btn = e.target.closest('.mp-item');
    if (!btn) return;
    const prev = yearCol.querySelector('.selected');
    if (prev === btn) return;
    if (prev) prev.classList.remove('selected');
    btn.classList.add('selected');
    selYear = parseInt(btn.dataset.year, 10);
  });

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => { overlay.innerHTML = ''; }, 200);
    document.removeEventListener('keydown', onKey);
  };
  const apply = () => {
    const now = new Date();
    calMonthOffset = (selYear - now.getFullYear()) * 12 + (selMonth - now.getMonth());
    close();
    renderCalendar();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') apply();
  };

  overlay.querySelector('#mpCancel').addEventListener('click', close);
  overlay.querySelector('#mpDone').addEventListener('click', apply);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.classList.add('open');
}

function renderCalendar() {
  const filters = { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  $('calMonthName').innerHTML = `${MONTHS_FULL[month]} <span class="cal-month-chev">▾</span>`;
  $('calMonthYear').textContent = year;

  const startMon = weekStartsOnMonday();
  const dowLabels = startMon ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  $('calDowRow').innerHTML = dowLabels.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const firstDay = new Date(year, month, 1);
  const firstDow = firstDay.getDay();
  const leading = startMon ? ((firstDow + 6) % 7) : firstDow;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const todayKey = dk(today);
  const grid = $('calGrid');
  grid.innerHTML = '';

  let monthMins = 0;
  let logged = 0;

  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = 0; i < leading; i++) {
    const dayNum = prevMonthDays - leading + 1 + i;
    const cell = document.createElement('button');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<span class="cal-num">${dayNum}</span>`;
    const prevDate = new Date(year, month - 1, dayNum);
    cell.onclick = () => openSheet(dk(prevDate), prevDate);
    grid.appendChild(cell);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const key = dk(date);
    const worked = getWorkedMinsForDay(key, filters);
    const hasData = hasAnyDataForDay(key, filters);

    if (worked > 0) {
      monthMins += worked;
      logged++;
    }

    const isToday = key === todayKey;
    let cls = 'cal-cell';
    if (hasData) cls += ' has-data';
    if (isToday) cls += ' is-today';

    const hoursLabel = worked > 0 ? `${(worked/60).toFixed(1)}h` : '';
    const cell = document.createElement('button');
    cell.className = cls;
    cell.innerHTML = `<span class="cal-num">${d}</span>${hoursLabel ? `<span class="cal-hrs">${hoursLabel}</span>` : ''}`;
    cell.onclick = () => openSheet(key, date);
    grid.appendChild(cell);
  }

  const used = leading + daysInMonth;
  const trailing = (7 - (used % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const nextDate = new Date(year, month + 1, i);
    const cell = document.createElement('button');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<span class="cal-num">${i}</span>`;
    cell.onclick = () => openSheet(dk(nextDate), nextDate);
    grid.appendChild(cell);
  }

  $('calTotalHrs').textContent = monthMins > 0 ? fmtMins(monthMins) : '0h 00m';
  $('calTotalEarn').textContent = money(monthMins) || '—';
  $('calDaysLogged').textContent = `${logged} day${logged!==1?'s':''} logged`;
  const avg = logged > 0 ? Math.round(monthMins / logged) : 0;
  $('calAvgTxt').textContent = `Avg ${avg ? fmtMins(avg) : '—'} / day`;
}

function renderClockPage() {
  const now = new Date();
  const key = dk(now);
  const worked = getWorkedMinsForDay(key);
  const dayRange = getDayDisplayRange(key);
  const attendanceFlags = getAttendanceFlags(key);

  $('td-date').textContent = `${DL[now.getDay()]}, ${MO[now.getMonth()]} ${now.getDate()}`;
  $('td-in').textContent = getFirstInForDay(key) ? fmt12(getFirstInForDay(key)) : '—';
  $('td-out').textContent = getLastOutForDay(key) ? fmt12(getLastOutForDay(key)) : (dayRange.text.includes('Running') ? 'Running' : '—');
  $('td-hrs').textContent = worked ? fmtMins(worked) : '—';

  if (attendanceFlags.length && !clockedIn) $('cLbl').textContent = attendanceFlags.map(flag => flag.label).join(' • ');
  syncClockUI();
}

function syncClockUI() {
  const dot = $('cDot');
  const st  = $('cStatus');

  // ── Update clock-page slider state ──
  const sliderWrap  = document.getElementById('cSliderWrap');
  const sliderLabel = document.getElementById('cSliderLabel');
  const sliderIcon  = document.getElementById('cSliderIcon');
  if (sliderWrap) {
    if (clockedIn) {
      sliderWrap.classList.remove('out-state');
      sliderWrap.classList.add('in-state');
      if (sliderLabel) sliderLabel.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;">swipe_right</span> SLIDE TO CLOCK OUT';
      if (sliderIcon)  sliderIcon.textContent = 'stop';
    } else {
      sliderWrap.classList.remove('in-state');
      sliderWrap.classList.add('out-state');
      if (sliderLabel) sliderLabel.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;">swipe_right</span> SLIDE TO CLOCK IN';
      if (sliderIcon)  sliderIcon.textContent = 'play_arrow';
    }
  }

  if (clockedIn && clockInTime) {
    dot.classList.add('on');
    st.textContent = 'Currently clocked in';
    st.classList.add('on');
    $('ci-in').textContent = fmt12(`${p2(clockInTime.getHours())}:${p2(clockInTime.getMinutes())}`);
  } else {
    dot.classList.remove('on');
    st.textContent = 'Not clocked in';
    st.classList.remove('on');
    $('cTimer').innerHTML = '00:00<span class="c-secs">:00</span>';
    $('cLbl').textContent = 'Slide to start';
    $('ci-in').textContent  = '—';
    $('ci-dur').textContent = '—';
    $('ci-earn').textContent = '—';
  }

  // Show/hide break button
  const breakWrap = document.getElementById('breakBtnWrap');
  if (breakWrap) breakWrap.style.display = clockedIn ? 'block' : 'none';
  syncBreakUI();
}

function syncBreakUI() {
  const btn = document.getElementById('breakBtn');
  const lbl = document.getElementById('breakBtnLabel');
  const icon = document.getElementById('breakBtnIcon');
  const timerLbl = document.getElementById('breakTimerLbl');
  if (!btn) return;
  if (onBreak) {
    btn.style.background = 'rgba(186,26,26,0.1)';
    btn.style.color = 'var(--red)';
    if (icon) icon.textContent = 'play_circle';
    if (lbl) lbl.textContent = 'END BREAK';
    if (timerLbl) timerLbl.style.display = 'block';
  } else {
    btn.style.background = 'rgba(234,179,8,0.12)';
    btn.style.color = '#ca8a04';
    if (icon) icon.textContent = 'pause_circle';
    if (lbl) lbl.textContent = 'START BREAK';
    if (timerLbl) timerLbl.style.display = 'none';
  }
}

function toggleBreak() {
  if (!clockedIn) return;
  if (!onBreak) {
    // Start break
    onBreak = true;
    breakStartTime = new Date();
    clearInterval(breakTimerInterval);
    breakTimerInterval = setInterval(() => {
      if (!breakStartTime) return;
      const elapsed = Math.floor((Date.now() - breakStartTime.getTime()) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const el = document.getElementById('breakTimerVal');
      if (el) el.textContent = `${m}:${p2(s)}`;
    }, 1000);
  } else {
    // End break — calculate minutes and add to current session
    onBreak = false;
    clearInterval(breakTimerInterval);
    if (breakStartTime && clockInKey != null && activeSessionIndex != null) {
      const elapsed = Math.max(1, Math.round((Date.now() - breakStartTime.getTime()) / 60000));
      const entry = getEntry(clockInKey);
      const sessions = getSessions(entry);
      if (sessions[activeSessionIndex]) {
        sessions[activeSessionIndex].brk = (sessions[activeSessionIndex].brk || 0) + elapsed;
        setEntry(clockInKey, { ...entry, sessions });
        persist();
        showToast(`Break recorded: ${elapsed} min`);
      }
    }
    breakStartTime = null;
  }
  syncBreakUI();
}

function saveClockState() {
  if (clockedIn && clockInTime && clockInKey && activeSessionIndex != null) {
    localStorage.setItem('ht_clockState', JSON.stringify({
      inISO: clockInTime.toISOString(),
      key: clockInKey,
      index: activeSessionIndex
    }));
  } else {
    localStorage.removeItem('ht_clockState');
  }
}

function restoreClockState() {
  try {
    let recovered = false;
    const raw = localStorage.getItem('ht_clockState');
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.inISO && s.key && s.index != null) {
        const entry = getEntry(s.key);
        const sessions = entry.sessions || [];
        const current = sessions[s.index];

        if (current && current.in && !current.out) {
          clockedIn = true;
          clockInTime = new Date(s.inISO);
          clockInKey = s.key;
          activeSessionIndex = s.index;
          startClockTimer();
          recovered = true;
        }
      }
    }

    if (!recovered) {
      const open = findLatestOpenSession();
      if (open) {
        clockedIn = true;
        clockInTime = open.start;
        clockInKey = open.key;
        activeSessionIndex = open.index;
        saveClockState();
        startClockTimer();
        setTimeout(() => showExportToast('Recovered active clock session'), 300);
      } else {
        localStorage.removeItem('ht_clockState');
      }
    }
  } catch (e) {
    localStorage.removeItem('ht_clockState');
  }
}

function startClockTimer() {
  if (clockInterval) clearInterval(clockInterval);

  const tick = () => {
    if (!clockedIn || !clockInTime) return;
    const elapsed = Math.floor((new Date() - clockInTime) / 1000);
    $('cTimer').innerHTML = fmtSecs(elapsed);
    $('cLbl').textContent = 'Session active';
    $('ci-dur').textContent = fmtMins(Math.floor(elapsed / 60));
    $('ci-earn').textContent = money(Math.floor(elapsed / 60)) || '—';
  };

  tick();
  clockInterval = setInterval(tick, 1000);
}

// ═══════════════════════════════════════
//  TOAST + UNDO
// ═══════════════════════════════════════
let _toastTimer = null;
let _lastClockAction = null; // { type: 'in'|'out', key, sessionIndex, sessionSnapshot }

function showToast(msg, withUndo = false) {
  const el = document.getElementById('toastEl');
  const msgEl = document.getElementById('toastMsg');
  const undoBtn = document.getElementById('toastUndoBtn');
  if (!el || !msgEl) return;
  clearTimeout(_toastTimer);
  msgEl.textContent = msg;
  if (undoBtn) undoBtn.style.display = withUndo ? 'inline-block' : 'none';
  el.style.pointerEvents = withUndo ? 'auto' : 'none';
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  _toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => { if (undoBtn) undoBtn.style.display = 'none'; el.style.pointerEvents = 'none'; }, 300);
  }, withUndo ? 5000 : 2500);
}

function undoLastClock() {
  if (!_lastClockAction) return;
  clearTimeout(_toastTimer);
  const el = document.getElementById('toastEl');
  if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(20px)'; }

  const { type, key, sessionIndex } = _lastClockAction;
  _lastClockAction = null;

  if (type === 'in') {
    // Undo clock-in: remove the session we added, reset clock state
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = null;
    onBreak = false;
    clearInterval(breakTimerInterval);
    breakStartTime = null;
    const entry = getEntry(key);
    if (entry.sessions && entry.sessions[sessionIndex]) {
      entry.sessions.splice(sessionIndex, 1);
      setEntry(key, entry);
      persist();
    }
    clockedIn = false;
    clockInTime = null;
    clockInKey = null;
    activeSessionIndex = null;
    saveClockState();
    syncClockUI();
    renderWeek();
    if ($('page-clock').classList.contains('active')) renderClockPage();
    showToast('Clock in undone');
  } else if (type === 'out') {
    // Undo clock-out: reopen the session (remove out time) and re-enter clocked-in state
    const entry = getEntry(key);
    if (entry.sessions && entry.sessions[sessionIndex]) {
      const s = entry.sessions[sessionIndex];
      s.out = '';
      s.outISO = '';
      entry.sessions[sessionIndex] = s;
      setEntry(key, entry);
      persist();
      // Restore clock state
      clockedIn = true;
      clockInKey = key;
      clockInTime = s.inISO ? new Date(s.inISO) : new Date();
      activeSessionIndex = sessionIndex;
      saveClockState();
      startClockTimer();
      syncClockUI();
      renderWeek();
      if ($('page-clock').classList.contains('active')) renderClockPage();
      showToast('Clock out undone');
    }
  }
}

async function toggleClock() {
  if (!clockedIn) {
    clockedIn = true;
    clockInTime = new Date();
    clockInKey = dk(clockInTime);
    if (isEntryLocked(clockInKey)) {
      clockedIn = false;
      clockInTime = null;
      clockInKey = null;
      iosAlert('Today has been marked as Paid ✓. Paid periods cannot be edited.', 'Paid & Locked');
      return;
    }
    const inStr = `${p2(clockInTime.getHours())}:${p2(clockInTime.getMinutes())}`;

    const entry = getEntry(clockInKey);
    entry.sessions.push({ in: inStr, out: '', brk: 0, inISO: clockInTime.toISOString(), outISO: '' });
    activeSessionIndex = entry.sessions.length - 1;
    setEntry(clockInKey, entry);

    persist();
    saveClockState();
    startClockTimer();
    syncClockUI();
    renderWeek();
    if ($('page-calendar').classList.contains('active')) renderCalendar();
    if ($('page-clock').classList.contains('active')) renderClockPage();
    // Save undo snapshot and show toast
    _lastClockAction = { type: 'in', key: clockInKey, sessionIndex: activeSessionIndex };
    showToast('Clocked in ✓', true);
    sendSwScheduleUpdate();
  } else {
    const outTime = new Date();
    const outStr = `${p2(outTime.getHours())}:${p2(outTime.getMinutes())}`;
    const elapsedMins = clockInTime ? Math.floor((outTime - clockInTime) / 60000) : 0;
    if (isEntryLocked(clockInKey)) {
      iosAlert('This shift belongs to a Paid period and cannot be updated.', 'Paid & Locked');
      return;
    }

    if (elapsedMins > MAX_SESSION_MINS) {
      const ok = await iosConfirm(`This session is ${fmtMins(elapsedMins)} long. Clock out anyway?`, { okLabel: 'Clock Out', title: 'Long shift detected' });
      if (!ok) return;
    }

    // Stop break if active
    if (onBreak) {
      onBreak = false;
      clearInterval(breakTimerInterval);
      breakStartTime = null;
    }

    const entry = getEntry(clockInKey);
    const _undoKey = clockInKey;
    const _undoIdx = activeSessionIndex;

    if (entry.sessions[activeSessionIndex]) {
      entry.sessions[activeSessionIndex].out = outStr;
      entry.sessions[activeSessionIndex].outISO = outTime.toISOString();
      entry.sessions[activeSessionIndex] = applyAutoBreakToSession(entry.sessions[activeSessionIndex], clockInKey);
      setEntry(clockInKey, entry);
      persist();
    }

    if (clockInterval) clearInterval(clockInterval);
    clockInterval = null;
    clockedIn = false;
    clockInTime = null;
    clockInKey = null;
    activeSessionIndex = null;
    saveClockState();
    syncClockUI();
    renderClockPage();
    renderWeek();
    if ($('page-calendar').classList.contains('active')) renderCalendar();
    // Save undo snapshot and show toast
    _lastClockAction = { type: 'out', key: _undoKey, sessionIndex: _undoIdx };
    showToast('Clocked out ✓', true);
    sendSwScheduleUpdate();
  }
}

function buildSessionCard(session, index) {
  const mins = calcSessionMins(session);
  const bounds = getSessionBounds(editKey || '', session);
  const metaText = '';
  return `
    <div class="session-card">
      <div class="session-head">
        <div class="session-title">Session ${index + 1}</div>
        <div class="session-total">${mins ? fmtMins(mins) : '—'}</div>
      </div>
      <div class="session-fields">
        <div class="session-row">
          <label>Start</label>
          <input type="datetime-local" value="${esc(toLocalInputValue(bounds.start))}" onchange="updateSessionField(${index}, 'in', this.value)">
        </div>
        <div class="session-row">
          <label>End</label>
          <input type="datetime-local" value="${esc(toLocalInputValue(bounds.end))}" onchange="updateSessionField(${index}, 'out', this.value)">
        </div>
        <div class="session-row">
          <label>Break</label>
          <div style="display:flex;align-items:center;gap:4px;">
            <input type="number" min="0" max="480" value="${session.brk || 0}" onchange="updateSessionField(${index}, 'brk', this.value)">
            <span class="f-unit">min</span>
          </div>
        </div>
      </div>
      ${metaText ? `<div class="session-actions"><div class="session-meta">${esc(metaText)}</div></div>` : ''}
      <div class="session-actions">
        <button class="session-remove-btn" onclick="removeSession(${index})">Remove Session</button>
      </div>
    </div>
  `;
}

function renderSessionsEditor() {
  if (!editKey) return;
  const entry = getEntry(editKey);
  const list = $('sessionsList');

  if (!entry.sessions.length) {
    entry.sessions.push(normalizeSession({ in: '', out: '', brk: 0, inISO: '', outISO: '' }, editKey, 0));
  }

  list.innerHTML = entry.sessions.map((s, i) => buildSessionCard(s, i)).join('');
  calcSheet();
}

function updateSessionField(index, field, value) {
  if (!editKey) return;
  const entry = getEntry(editKey);
  if (!entry.sessions[index]) return;

  if (field === 'brk') {
    entry.sessions[index][field] = Math.min(480, Math.max(0, parseInt(value, 10) || 0));
  } else if (field === 'clientId' || field === 'projectId') {
    entry.sessions[index][field] = value || '';
    if (field === 'projectId') {
      const project = findNamedItem(projects, entry.sessions[index].projectId);
      if (project?.clientId) entry.sessions[index].clientId = project.clientId;
    }
  } else {
    updateSessionDateTime(entry.sessions[index], field, value);
  }

  setEntry(editKey, entry);
  renderSessionsEditor();
}

function toggleSessionTag(index, tagId) {
  if (!editKey) return;
  const entry = getEntry(editKey);
  const session = entry.sessions[index];
  if (!session) return;

  const set = new Set(session.tagIds || []);
  if (set.has(tagId)) set.delete(tagId);
  else set.add(tagId);
  session.tagIds = Array.from(set);

  setEntry(editKey, entry);
  renderSessionsEditor();
}

function addSession() {
  if (!editKey) return;
  const entry = getEntry(editKey);
  entry.sessions.push(normalizeSession({ in: '', out: '', brk: 0, inISO: '', outISO: '' }, editKey, entry.sessions.length));
  setEntry(editKey, entry);
  renderSessionsEditor();
}

function removeSession(index) {
  if (!editKey) return;
  const entry = getEntry(editKey);
  entry.sessions.splice(index, 1);
  setEntry(editKey, entry);
  renderSessionsEditor();
}

function sheetCurrentValues() {
  const note = $('f-note').value;
  const dayTypeSelect = $('f-dayType');
  const dayType = dayTypeSelect ? dayTypeSelect.value : 'work';
  const entry = getEntry(editKey || '');
  return JSON.stringify({ note, dayType, sessions: entry.sessions });
}

function openSheet(key, dateObj) {
  if (isEntryLocked(key)) {
    iosAlert('This week has been marked as Paid ✓. Paid hours cannot be edited.', 'Paid & Locked');
    return;
  }
  editKey = key;
  const e = getEntry(key);
  const dow = dateObj.getDay();

  $('shTitle').textContent = DL[dow];
  $('shSub').textContent = `${DS[dow]}, ${MO[dateObj.getMonth()]} ${dateObj.getDate()}`;
  $('f-note').value = e.note || '';
  const dayTypeSelect = $('f-dayType');
  if (dayTypeSelect) dayTypeSelect.value = e.dayType || 'work';

  renderSessionsEditor();
  sheetSnapshot = sheetCurrentValues();
  $('overlay').classList.add('open');
}

async function closeSheet(force) {
  if (!force && sheetSnapshot !== null && sheetCurrentValues() !== sheetSnapshot) {
    const ok = await iosConfirm('Discard changes?', { okLabel: 'Discard', danger: true });
    if (!ok) return;
  }
  $('overlay').classList.remove('open');
  editKey = null;
  sheetSnapshot = null;
}

$('overlay').addEventListener('click', function(e) {
  if (e.target === this) closeSheet();
});

$('payrollOverlay').addEventListener('click', function(e) {
  if (e.target === this) closePayrollReviewSheet();
});

function calcSheet() {
  if (!editKey) {
    $('sr-val').textContent = '—';
    $('sr-pay').textContent = '';
    return;
  }
  const entry = getEntry(editKey);
  const mins = getWorkedMins(entry, editKey);
  $('sr-val').textContent = mins ? fmtMins(mins) : '—';
  $('sr-pay').textContent = money(mins);
}

async function saveEntry() {
  if (!editKey) return;
  if (isEntryLocked(editKey)) {
    iosAlert('This week has been marked as Paid ✓. Paid hours cannot be edited.', 'Paid & Locked');
    return;
  }

  const entry = getEntry(editKey);
  entry.note = $('f-note').value.trim();
  const dayTypeSelect = $('f-dayType');
  if (dayTypeSelect) entry.dayType = dayTypeSelect.value || 'work';
  entry.sessions = entry.sessions
    .map(s => ({
      id: s.id || '',
      in: s.in || '',
      out: s.out || '',
      brk: Math.min(480, Math.max(0, parseInt(s.brk, 10) || 0)),
      inISO: s.inISO || '',
      outISO: s.outISO || '',
      clientId: s.clientId || '',
      projectId: s.projectId || '',
      tagIds: Array.isArray(s.tagIds) ? s.tagIds.filter(Boolean) : [],
      timezone: s.timezone || '',
      createdAt: s.createdAt || '',
      updatedAt: new Date().toISOString(),
      source: s.source || 'manual'
    }))
    .map(s => applyAutoBreakToSession(s, editKey))
    .filter(s => s.in || s.out || s.brk || s.clientId || s.projectId || (s.tagIds && s.tagIds.length));

  const badSession = entry.sessions.find(s => (s.in && !s.out) || (!s.in && s.out));
  if (badSession) {
    iosAlert('Each session must have both start and end time.');
    return;
  }

  const invalidRange = entry.sessions.find(s => s.inISO && s.outISO && new Date(s.outISO) < new Date(s.inISO));
  if (invalidRange) {
    iosAlert('A session ends before it starts. Please correct the date or time.');
    return;
  }

  const overlaps = getSessionOverlaps(entry.sessions, editKey);
  if (overlaps.length) {
    const ok = await iosConfirm(overlaps.join('\n'), { okLabel: 'Save Anyway', title: 'Overlapping sessions' });
    if (!ok) return;
  }

  const warnings = entry.sessions.flatMap((s, index) => getSessionWarnings(editKey, s, index));
  if (warnings.length) {
    const ok = await iosConfirm(warnings.join('\n'), { okLabel: 'Save Anyway', title: 'Review session' });
    if (!ok) return;
  }

  setEntry(editKey, entry);
  persist();
  closeSheet(true);
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  if ($('page-clock').classList.contains('active')) renderClockPage();
}

async function removeEntry() {
  if (!editKey) return;
  if (isEntryLocked(editKey)) {
    iosAlert('This week has been marked as Paid ✓. Paid hours cannot be removed.', 'Paid & Locked');
    return;
  }
  const ok = await iosConfirm('Remove this entry?', { okLabel: 'Remove', danger: true });
  if (!ok) return;
  delete db[editKey];
  persist();
  closeSheet(true);
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  if ($('page-clock').classList.contains('active')) renderClockPage();
}

function saveRate() {
  const v = parseFloat($('rateInput').value) || 0;
  hourlyRate = Math.max(0, v);
  $('rateInput').value = hourlyRate.toFixed(2);
  localStorage.setItem('ht_rate', hourlyRate);
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  if ($('page-clock').classList.contains('active')) renderClockPage();
}

function saveCurrency() {
  currency = $('currencySelect').value || 'USD';
  localStorage.setItem('ht_currency', currency);
  $('rateSym').textContent = curSym();
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  if ($('page-clock').classList.contains('active')) renderClockPage();
}

function saveWeekStart() {
  const v = $('weekStartSelect').value || 'monday';
  localStorage.setItem('ht_weekStart', v);
  weekOffset = 0;
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
}

function saveOvertimeThreshold() {
  const v = parseFloat($('overtimeThresholdInput').value) || 40;
  overtimeThresholdHours = Math.max(1, Math.min(168, v));
  $('overtimeThresholdInput').value = overtimeThresholdHours;
  localStorage.setItem('ht_overtime_threshold', overtimeThresholdHours);
  renderWeek();
}

function saveOvertimeRate() {
  const v = parseFloat($('overtimeRateInput').value) || 1.5;
  overtimeRate = Math.max(1, Math.min(5, v));
  $('overtimeRateInput').value = overtimeRate;
  localStorage.setItem('ht_overtime_rate', overtimeRate);
  renderWeek();
}

async function clearAll() {
  const typed = await iosPrompt('Type DELETE to permanently erase all data. This cannot be undone.', {
    title: 'Clear All Data',
    placeholder: 'Type DELETE'
  });
  if (typed !== 'DELETE') {
    if (typed !== null && typed !== '') await iosAlert('You must type DELETE exactly to proceed.');
    return;
  }

  db = {};
  persist();
  idbClear();
  localStorage.removeItem('ht_clockState');
  clockedIn = false;
  clockInTime = null;
  clockInKey = null;
  activeSessionIndex = null;
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  renderWeek();
  if ($('page-clock').classList.contains('active')) renderClockPage();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g,'""') + '"';
}

function buildCSV() {
  const filters = { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  const days = weekDays(weekOffset);
  const header = ['Date','Day','Status','Rounded Hours','Start','End','Break (min)','Earnings','Sessions','Clients/Projects/Tags','Note'];
  let csv = header.map(csvCell).join(',') + '\n';

  days.forEach(d => {
    const key = dk(d);
    const e = getEntry(key);
    if (!hasAnyDataForDay(key, filters)) return;

    const worked = getWorkedMinsForDay(key, filters);
    const earn = money(worked);
    const meta = getSessions(e).filter(session => sessionMatchesFilters(session, filters)).map(sessionMetaText).filter(Boolean).join(' | ');
    const status = payrollStatusMeta(getEntryStatus(key)).label;
    const row = [
      key,
      DL[d.getDay()],
      status,
      worked ? fmtMins(worked) : '',
      fmt12(getFirstInForDay(key, filters)),
      getLastOutForDay(key, filters) ? fmt12(getLastOutForDay(key, filters)) : '',
      getTotalBreakForDay(key, filters) || 0,
      earn,
      getDaySessionCount(key, filters),
      meta,
      e.note || ''
    ];
    csv += row.map(csvCell).join(',') + '\n';
  });

  return csv;
}

function exportCSV() {
  const csv = buildCSV();
  const days = weekDays(weekOffset);
  const filename = `hours_${dk(days[0])}.csv`;
  downloadCSV(csv, filename);
}

function showExportToast(msg) {
  let t = document.getElementById('exportToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'exportToast';
    t.style.cssText = `
      position:fixed; bottom:100px; left:50%; transform:translateX(-50%);
      background:#333; color:#fff; padding:10px 20px; border-radius:20px;
      font-size:14px; z-index:999; white-space:nowrap; opacity:0;
      transition:opacity 0.2s;
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

function showCSVModal(csv) {
  const old = document.getElementById('csvModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'csvModal';
  modal.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:300;
    display:flex; align-items:flex-end; justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:var(--card); border-radius:22px 22px 0 0; width:100%; max-width:430px; padding:20px 20px 40px; color:var(--label);">
      <div style="width:38px;height:4px;background:var(--separator);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:17px;font-weight:600;margin-bottom:8px;">Export Data</div>
      <div style="font-size:13px;color:var(--tertiary);margin-bottom:12px;">Copy the text below and paste into a .csv file or spreadsheet.</div>
      <textarea readonly style="width:100%;height:160px;font-size:12px;font-family:monospace;border:1px solid var(--separator);border-radius:10px;padding:10px;resize:none;color:var(--label);background:var(--bg);">${esc(csv)}</textarea>
      <button onclick="
        const ta = this.parentElement.querySelector('textarea');
        ta.select();
        try { navigator.clipboard.writeText(ta.value).then(()=>{ this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy to Clipboard',1500); }); }
        catch(e) { document.execCommand('copy'); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy to Clipboard',1500); }
      " style="width:100%;margin-top:12px;padding:14px;background:var(--blue);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;font-family:-apple-system,sans-serif;">Copy to Clipboard</button>
      <button onclick="document.getElementById('csvModal').remove()" style="width:100%;margin-top:10px;padding:14px;background:var(--fill);color:var(--blue);border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;font-family:-apple-system,sans-serif;">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function exportBackup() {
  const payload = buildFullBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const filename = `hours_tracker_backup_${new Date().toISOString().slice(0,10)}.json`;
  localStorage.setItem('ht_lastBackupAt', new Date().toISOString());
  updateBackupStatus();
  try {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    showExportToast('Backup saved: ' + filename);
  } catch (e) {
    showCSVModal(json);
  }
}

function importBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || typeof data !== 'object' || !data.db) {
        await iosAlert('Invalid backup file.');
        return;
      }
      const ok = await iosConfirm('Restore this backup? This will replace current data.', { okLabel: 'Restore', danger: true });
      if (!ok) return;
      applyRestoredBackup(data);
      showExportToast('Backup restored');
    } catch (err) {
      await iosAlert('Could not read backup file.');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function formatBackupDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d)) return 'Never';
  return `${MO[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function updateBackupStatus() {
  const el = $('lastBackupText');
  if (!el) return;
  el.textContent = formatBackupDate(localStorage.getItem('ht_lastBackupAt'));
}

function quickBackup() {
  exportBackup();
}

// ═══════════════════════════════════════
//  SCHEDULE NOTIFICATIONS
// ═══════════════════════════════════════

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function fireNotification(title, body) {
  if (typeof iosAlert === 'function') {
    iosAlert(body, title);
  } else {
    alert(title + '\\n' + body);
  }
}

let _notifTimers = [];

function scheduleShiftNotifications() {
  // Clear any previously scheduled notification timers
  _notifTimers.forEach(t => clearTimeout(t));
  _notifTimers = [];

  const sched = getTodaySchedule();
  if (!sched || !sched.enabled) return;

  const now = new Date();
  const todayStr = now.toDateString();

  function parseTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  // ── Clock-In reminder: 10 mins before scheduled start ──
  const clockInTime = parseTime(sched.start);
  const clockInReminder = new Date(clockInTime.getTime() - 10 * 60 * 1000);
  const msUntilClockInReminder = clockInReminder.getTime() - now.getTime();

  if (msUntilClockInReminder > 0) {
    const t1 = setTimeout(() => {
      // Only fire if not already clocked in
      if (!clockedIn) {
        fireNotification('⏰ Clock In Reminder', `Clock in within 10 minutes (scheduled ${sched.start})`);
      }
    }, msUntilClockInReminder);
    _notifTimers.push(t1);
  } else if (msUntilClockInReminder <= 0 && msUntilClockInReminder >= -10 * 60 * 1000) {
    // Already in the 10 min window! Fire immediately on load/save.
    if (!clockedIn) {
      fireNotification('⏰ Clock In Reminder', `Clock in within 10 minutes (scheduled ${sched.start})`);
    }
  }

  // ── Clock-Out reminder: 10 mins after scheduled end (if still clocked in) ──
  const clockOutTime = parseTime(sched.end);
  const clockOutReminder = new Date(clockOutTime.getTime() + 10 * 60 * 1000);
  const msUntilClockOutReminder = clockOutReminder.getTime() - now.getTime();

  if (msUntilClockOutReminder > 0) {
    const t2 = setTimeout(() => {
      if (clockedIn) {
        fireNotification('🔔 Not Clocked Out', `You are still clocked in — scheduled end was ${sched.end}`);
      }
    }, msUntilClockOutReminder);
    _notifTimers.push(t2);
  } else if (msUntilClockOutReminder <= 0 && msUntilClockOutReminder >= -2 * 60 * 1000) {
    // Already in the 10-12 min missed window! Fire immediately.
    if (clockedIn) {
      fireNotification('🔔 Not Clocked Out', `You are still clocked in — scheduled end was ${sched.end}`);
    }
  }
}

async function initNotifications() {
  const granted = await requestNotificationPermission();
  if (granted) scheduleShiftNotifications();
  // Register service worker and sync schedule/clock state
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      sendSwScheduleUpdate();
    } catch (e) { /* SW not available */ }
  }
}

// Send schedule + clock state to the service worker
function sendSwScheduleUpdate() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage({
    type: 'SCHEDULE_UPDATE',
    schedule: dailySchedule,
    clockedIn: clockedIn,
    clockInISO: clockInTime ? clockInTime.toISOString() : null
  });
  navigator.serviceWorker.controller.postMessage({
    type: 'CLOCK_STATE',
    clockedIn: clockedIn,
    clockInISO: clockInTime ? clockInTime.toISOString() : null,
    missedClockOutHours: missedClockOutHours
  });
}

// Re-schedule when page becomes visible again (e.g. next day)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    scheduleShiftNotifications();
    sendSwScheduleUpdate();
  }
});

// ── Silent auto-backup to IndexedDB (once per day) ──
function silentAutoBackup() {
  const today = dk(new Date());
  const lastAuto = localStorage.getItem('ht_lastAutoBackup');
  if (lastAuto === today) return; // already done today
  const hasEntries = Object.keys(db || {}).length > 0;
  if (!hasEntries) return;
  try {
    const payload = JSON.stringify({ db, exportedAt: new Date().toISOString(), version: 1 });
    const key = `ht_autobackup_${today}`;
    localStorage.setItem(key, payload);
    // Keep only the last 7 daily auto-backups to avoid storage bloat
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ht_autobackup_') && k !== key) {
        const age = new Date(today) - new Date(k.replace('ht_autobackup_', ''));
        if (age > 7 * 24 * 60 * 60 * 1000) localStorage.removeItem(k);
      }
    }
    localStorage.setItem('ht_lastAutoBackup', today);
  } catch (e) { /* silent — storage may be full */ }
}

function maybeRemindBackup() {
  const today = dk(new Date());

  // Run silent auto-backup first — no prompts
  silentAutoBackup();

  // Check if we've already shown the prompt today (whether they backed up or dismissed)
  const lastPromptDate = localStorage.getItem('ht_lastBackupPrompt');
  if (lastPromptDate === today) return; // already asked today — don't ask again

  const lastISO = localStorage.getItem('ht_lastBackupAt');
  let lastLocal = '';
  if (lastISO) {
    const d = new Date(lastISO);
    if (!isNaN(d)) lastLocal = dk(d);
  }
  const hasEntries = Object.keys(db || {}).length > 0;
  if (hasEntries && lastLocal !== today) {
    setTimeout(async () => {
      // Mark as prompted today BEFORE showing — so re-opening the app won't re-trigger
      localStorage.setItem('ht_lastBackupPrompt', today);
      const ok = await iosConfirm('You have not backed up your data today. Create a backup now?', { okLabel: 'Back up', title: 'Backup reminder' });
      if (ok) exportBackup();
    }, 700);
  }
}

function refreshRunningClockFromStorage() {
  restoreClockState();
  maybeRecoverMissedClockOut();
  syncClockUI();
  if (clockedIn) startClockTimer();
  if ($('page-clock').classList.contains('active')) renderClockPage();
  renderWeek();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
}


// ─── Daily Schedule ───
const DAY_NAMES_SCHED = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const DEFAULT_SCHEDULE = {
  monday:    { enabled: true,  start: '09:00', end: '17:00' },
  tuesday:   { enabled: true,  start: '09:00', end: '17:00' },
  wednesday: { enabled: true,  start: '09:00', end: '17:00' },
  thursday:  { enabled: true,  start: '09:00', end: '17:00' },
  friday:    { enabled: true,  start: '09:00', end: '17:00' },
  saturday:  { enabled: false, start: '09:00', end: '17:00' },
  sunday:    { enabled: false, start: '09:00', end: '17:00' }
};

function loadDailySchedule() {
  try {
    const raw = localStorage.getItem('ht_daily_schedule');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const merged = { ...DEFAULT_SCHEDULE };
        DAY_NAMES_SCHED.forEach(day => {
          if (parsed[day]) merged[day] = { ...DEFAULT_SCHEDULE[day], ...parsed[day] };
        });
        return merged;
      }
    }
  } catch (e) {}
  return { ...DEFAULT_SCHEDULE };
}

let dailySchedule = loadDailySchedule();

function saveDailySchedule() {
  localStorage.setItem('ht_daily_schedule', JSON.stringify(dailySchedule));
  if (typeof scheduleShiftNotifications === 'function') scheduleShiftNotifications();
  if (typeof sendSwScheduleUpdate === 'function') sendSwScheduleUpdate();
}

function getScheduleForDate(date) {
  const dayName = DAY_NAMES_SCHED[date.getDay()];
  return dailySchedule[dayName] || DEFAULT_SCHEDULE[dayName];
}

function getTodaySchedule() {
  return getScheduleForDate(new Date());
}

function renderDailyScheduleSettings() {
  const container = $('dailyScheduleList');
  if (!container) return;
  const displayOrder = weekStartsOnMonday()
    ? ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
    : ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  container.innerHTML = displayOrder.map(day => {
    const sched = dailySchedule[day];
    const label = day.charAt(0).toUpperCase() + day.slice(1);
    return `
      <div class="sched-day-row" style="padding:12px 16px;border-bottom:0.5px solid var(--separator);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${sched.enabled ? '10' : '0'}px;">
          <span style="font-size:16px;font-weight:500;">${label}</span>
          <label class="sched-toggle" style="position:relative;display:inline-block;width:51px;height:31px;">
            <input type="checkbox" ${sched.enabled ? 'checked' : ''} onchange="toggleScheduleDay('${day}', this.checked)" style="opacity:0;width:0;height:0;">
            <span style="position:absolute;cursor:pointer;inset:0;background:${sched.enabled ? 'var(--green)' : 'var(--fill)'};border-radius:31px;transition:background 0.2s;">
              <span style="position:absolute;height:27px;width:27px;left:${sched.enabled ? '22' : '2'}px;bottom:2px;background:white;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></span>
            </span>
          </label>
        </div>
        ${sched.enabled ? `
          <div style="display:flex;gap:12px;">
            <div style="flex:1;background:var(--bg);border-radius:10px;padding:10px 12px;">
              <div style="font-size:11px;color:var(--tertiary);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Start</div>
              <input type="time" value="${sched.start}" onchange="updateScheduleTime('${day}','start',this.value)" style="border:none;outline:none;background:transparent;color:var(--blue);font-family:var(--font);font-size:16px;font-weight:500;width:100%;">
            </div>
            <div style="flex:1;background:var(--bg);border-radius:10px;padding:10px 12px;">
              <div style="font-size:11px;color:var(--tertiary);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">End</div>
              <input type="time" value="${sched.end}" onchange="updateScheduleTime('${day}','end',this.value)" style="border:none;outline:none;background:transparent;color:var(--blue);font-family:var(--font);font-size:16px;font-weight:500;width:100%;">
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function toggleScheduleDay(day, enabled) {
  dailySchedule[day].enabled = enabled;
  saveDailySchedule();
  renderDailyScheduleSettings();
}

function updateScheduleTime(day, field, value) {
  if (value) dailySchedule[day][field] = value;
  saveDailySchedule();
}

// ─── Dark Theme Toggle ───
function loadThemePreference() {
  return localStorage.getItem('ht_theme') || 'auto';
}

let themePreference = loadThemePreference();

function applyTheme() {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (themePreference === 'light') {
    root.setAttribute('data-theme', 'light');
  } else if (themePreference === 'dark') {
    root.setAttribute('data-theme', 'dark');
  }
  // 'auto' uses the @media query (default behavior)
  const themeSelect = $('themeSelect');
  if (themeSelect) themeSelect.value = themePreference;
}

function saveTheme() {
  themePreference = $('themeSelect').value || 'auto';
  localStorage.setItem('ht_theme', themePreference);
  applyTheme();
}


// ─── Session Overlap Validation ───
function getSessionOverlaps(sessions, dayKey) {
  const issues = [];
  const bounds = sessions.map((s, i) => ({ ...getSessionBounds(dayKey, s), index: i, session: s })).filter(b => b.start);

  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i];
      const b = bounds[j];
      const aEnd = a.end || new Date();
      const bEnd = b.end || new Date();
      if (a.start < bEnd && b.start < aEnd) {
        issues.push(`Session ${a.index + 1} and Session ${b.index + 1} overlap in time.`);
      }
    }
  }
  return issues;
}


// ─── Per-project rate support ───
function getProjectRate(projectId) {
  const project = findNamedItem(projects, projectId);
  if (project && project.rate > 0) return project.rate;
  return null;
}

// ─── Day status (Absent/Sick) ───
function getDayStatus(dayKey) {
  const entry = getEntry(dayKey);
  return entry.dayType || 'work';
}

function setDayType(dayKey, dayType) {
  const entry = getEntry(dayKey);
  entry.dayType = dayType || 'work';
  setEntry(dayKey, entry);
}

// ─── Date-range CSV export ───
function buildCSVForRange(startDate, endDate, filters) {
  filters = filters || { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  const header = ['Date','Day','Status','Day Type','Rounded Hours','Start','End','Break (min)','Earnings','Sessions','Clients/Projects/Tags','Note'];
  let csv = header.map(csvCell).join(',') + '\n';

  const d = new Date(startDate);
  while (d <= endDate) {
    const key = dk(d);
    const e = getEntry(key);
    const dayType = getDayStatus(key);
    if (!hasAnyDataForDay(key, filters) && dayType === 'work') { d.setDate(d.getDate() + 1); continue; }

    const worked = getWorkedMinsForDay(key, filters);
    const earn = money(worked);
    const meta = getSessions(e).filter(session => sessionMatchesFilters(session, filters)).map(sessionMetaText).filter(Boolean).join(' | ');
    const status = payrollStatusMeta(getEntryStatus(key)).label;
    const row = [
      key,
      DL[d.getDay()],
      status,
      dayType === 'work' ? '' : dayType.charAt(0).toUpperCase() + dayType.slice(1),
      worked ? fmtMins(worked) : '',
      fmt12(getFirstInForDay(key, filters)),
      getLastOutForDay(key, filters) ? fmt12(getLastOutForDay(key, filters)) : '',
      getTotalBreakForDay(key, filters) || 0,
      earn,
      getDaySessionCount(key, filters),
      meta,
      e.note || ''
    ];
    csv += row.map(csvCell).join(',') + '\n';
    d.setDate(d.getDate() + 1);
  }
  return csv;
}

function exportMonthCSV() {
  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
  const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const csv = buildCSVForRange(viewDate, lastDay);
  const filename = `hours_${viewDate.getFullYear()}-${p2(viewDate.getMonth() + 1)}.csv`;
  downloadCSV(csv, filename);
}

async function exportCustomRangeCSV() {
  const startStr = await iosPrompt('Enter start date (YYYY-MM-DD):', { title: 'Export range', placeholder: 'e.g. 2026-01-01' });
  if (!startStr) return;
  const endStr = await iosPrompt('Enter end date (YYYY-MM-DD):', { title: 'Export range', placeholder: 'e.g. 2026-03-31' });
  if (!endStr) return;
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T23:59:59');
  if (isNaN(start) || isNaN(end) || end < start) {
    await iosAlert('Invalid date range. Use YYYY-MM-DD format.');
    return;
  }
  const csv = buildCSVForRange(start, end);
  const filename = `hours_${startStr}_to_${endStr}.csv`;
  downloadCSV(csv, filename);
}

function downloadCSV(csv, filename) {
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    showExportToast('Downloaded: ' + filename);
  } catch (e) {
    showCSVModal(csv);
  }
}

// ─── Data Management submenu toggle ───
function toggleDataSubmenu(menuId, rowId) {
  const menu = document.getElementById(menuId);
  const row  = document.getElementById(rowId);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  // Close all open submenus first
  document.querySelectorAll('.s-submenu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.s-row.expanded').forEach(r => r.classList.remove('expanded'));
  // Toggle the clicked one
  if (!isOpen) {
    menu.classList.add('open');
    if (row) row.classList.add('expanded');
  }
}

// ─── Print-friendly timesheet ───
function printTimesheet() { exportPDFTimesheet(); }

async function printMonthTimesheet() {
  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
  const lastDay  = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  exportPDFTimesheetForRange(viewDate, lastDay);
}

async function printCustomTimesheet() {
  const startStr = await iosPrompt('Enter start date (YYYY-MM-DD):', { title: 'Print range', placeholder: 'e.g. 2026-01-01' });
  if (!startStr) return;
  const endStr = await iosPrompt('Enter end date (YYYY-MM-DD):', { title: 'Print range', placeholder: 'e.g. 2026-03-31' });
  if (!endStr) return;
  const start = new Date(startStr + 'T00:00:00');
  const end   = new Date(endStr   + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || end < start) { showToast('Invalid date range'); return; }
  exportPDFTimesheetForRange(start, end);
}

function exportPDFTimesheetForRange(startDate, endDate) {
  const filters = { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  let cur = new Date(startDate);
  let totalMins = 0, totalBreak = 0, daysWorked = 0;
  let rows = '';
  const otThreshMins = overtimeThresholdHours * 60;
  while (cur <= endDate) {
    const key = dk(cur);
    const worked = getWorkedMinsForDay(key, filters);
    const brk = getTotalBreakForDay(key, filters) || 0;
    const dayType = getDayStatus(key);
    totalMins += worked;
    totalBreak += brk;
    if (worked > 0) daysWorked++;
    const e = getEntry(key);
    const range = getDayDisplayRange(key, filters);
    const isWeekend = cur.getDay() === 0 || cur.getDay() === 6;
    const rowBg = isWeekend ? '#f9f9f9' : 'white';
    rows += `<tr style="background:${rowBg};">
      <td style="font-weight:600;color:#374151;">${DL[cur.getDay()]}</td>
      <td style="color:#6b7280;">${key}</td>
      <td style="color:#374151;">${range.text || (dayType !== 'work' ? dayType.charAt(0).toUpperCase()+dayType.slice(1) : '—')}</td>
      <td style="text-align:center;color:#6b7280;">${brk ? brk+' min' : '—'}</td>
      <td style="text-align:right;font-weight:700;color:#111827;">${worked ? fmtMins(worked) : '—'}</td>
      <td style="text-align:right;color:${hourlyRate > 0 ? '#16a34a' : '#374151'};font-weight:600;">${hourlyRate > 0 ? (money(worked) || '—') : '—'}</td>
      <td style="color:#9ca3af;font-size:12px;">${e.note || ''}</td>
    </tr>`;
    cur.setDate(cur.getDate() + 1);
  }
  const otMins = Math.max(0, totalMins - otThreshMins);
  const regularMins = Math.min(totalMins, otThreshMins);
  const regularEarn = hourlyRate * regularMins / 60;
  const otEarn = hourlyRate * overtimeRate * otMins / 60;
  const totalEarn = regularEarn + otEarn;
  const avgMins = daysWorked > 0 ? Math.round(totalMins / daysWorked) : 0;
  const label = `${MO[startDate.getMonth()]} ${startDate.getDate()} – ${MO[endDate.getMonth()]} ${endDate.getDate()}, ${startDate.getFullYear()}`;
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow popups to print'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Timesheet – ${label}</title>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111827;padding:48px;font-size:14px;line-height:1.5;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;border-bottom:2px solid #16a34a;padding-bottom:20px;}
    .title{font-size:26px;font-weight:800;color:#111827;letter-spacing:-0.5px;}
    .subtitle{font-size:14px;color:#6b7280;margin-top:4px;}
    .header-right{text-align:right;}
    .period{font-size:15px;font-weight:700;color:#374151;}
    .generated{font-size:12px;color:#9ca3af;margin-top:4px;}
    .summary-row{display:flex;gap:16px;margin-bottom:28px;}
    .sum-card{flex:1;background:#f9fafb;border-radius:10px;padding:14px 16px;border:1px solid #e5e7eb;}
    .sum-lbl{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:4px;}
    .sum-val{font-size:20px;font-weight:800;color:#111827;}
    .sum-sub{font-size:12px;color:#9ca3af;margin-top:2px;}
    table{width:100%;border-collapse:collapse;font-size:13.5px;}
    thead tr{background:#16a34a;color:white;}
    th{padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
    th:last-child,th:nth-child(4),th:nth-child(5),th:nth-child(6){text-align:right;}
    td{padding:10px 12px;border-bottom:1px solid #f3f4f6;}
    tbody tr:hover{background:#f9fafb;}
    .total-row td{font-weight:700;background:#f0fdf4;border-top:2px solid #16a34a;font-size:14px;}
    .ot-note{margin-top:20px;padding:12px 16px;background:#fefce8;border:1px solid #fde047;border-radius:8px;font-size:12px;color:#713f12;}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;}
    @media print{body{padding:24px;}@page{margin:16mm;}}
  </style>
  </head><body>
  <div class="header">
    <div><div class="title">Timesheet</div><div class="subtitle">${label}</div></div>
    <div class="header-right">
      <div class="period">${label}</div>
      <div class="generated">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
    </div>
  </div>
  <div class="summary-row">
    <div class="sum-card"><div class="sum-lbl">Total Hours</div><div class="sum-val">${totalMins ? fmtMins(totalMins) : '0h 00m'}</div><div class="sum-sub">${daysWorked} day${daysWorked!==1?'s':''} worked</div></div>
    <div class="sum-card"><div class="sum-lbl">Avg per Day</div><div class="sum-val">${avgMins ? fmtMins(avgMins) : '—'}</div><div class="sum-sub">across worked days</div></div>
    <div class="sum-card"><div class="sum-lbl">Total Break</div><div class="sum-val">${totalBreak ? totalBreak+'m' : '—'}</div><div class="sum-sub">across the range</div></div>
    ${hourlyRate > 0 ? `<div class="sum-card" style="border-color:#bbf7d0;background:#f0fdf4;"><div class="sum-lbl" style="color:#16a34a;">Total Earnings</div><div class="sum-val" style="color:#15803d;">${curSym()}${totalEarn.toFixed(2)}</div><div class="sum-sub">${hourlyRate.toFixed(2)}/hr${otMins>0?' (incl. OT)':''}</div></div>` : ''}
  </div>
  <table>
    <thead><tr><th>Day</th><th>Date</th><th>Time Range</th><th style="text-align:center;">Break</th><th style="text-align:right;">Hours</th>${hourlyRate>0?'<th style="text-align:right;">Earnings</th>':''}<th style="text-align:right;">Note</th></tr></thead>
    <tbody>${rows}
      <tr class="total-row"><td colspan="4" style="text-align:right;padding-right:12px;">Total</td><td style="text-align:right;">${totalMins ? fmtMins(totalMins) : '—'}</td>${hourlyRate>0?`<td style="text-align:right;color:#15803d;">${curSym()}${totalEarn.toFixed(2)}</td>`:''}<td></td></tr>
    </tbody>
  </table>
  ${otMins > 0 && hourlyRate > 0 ? `<div class="ot-note">⚡ Overtime: ${fmtMins(otMins)} at ${overtimeRate}× rate = ${curSym()}${otEarn.toFixed(2)} (Regular: ${curSym()}${regularEarn.toFixed(2)} + OT: ${curSym()}${otEarn.toFixed(2)})</div>` : ''}
  <div class="footer"><span>Hours Tracker</span><span>To save as PDF: File → Print → Save as PDF</span></div>
  <script>window.onload=()=>{setTimeout(()=>window.print(),400);}<\/script>
  </body></html>`);
  win.document.close();
}

function exportPDFTimesheet() {
  const filters = { clientId: selectedClientFilter, projectId: selectedProjectFilter };
  const days = weekDays(weekOffset);
  const first = days[0], last = days[6];
  let totalMins = 0, totalBreak = 0, daysWorked = 0;
  let rows = '';
  const otThreshMins = overtimeThresholdHours * 60;

  days.forEach(d => {
    const key = dk(d);
    const worked = getWorkedMinsForDay(key, filters);
    const brk = getTotalBreakForDay(key, filters) || 0;
    const dayType = getDayStatus(key);
    totalMins += worked;
    totalBreak += brk;
    if (worked > 0) daysWorked++;
    const e = getEntry(key);
    const range = getDayDisplayRange(key, filters);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const rowBg = isWeekend ? '#f9f9f9' : 'white';
    rows += `<tr style="background:${rowBg};">
      <td style="font-weight:600;color:#374151;">${DL[d.getDay()]}</td>
      <td style="color:#6b7280;">${key}</td>
      <td style="color:#374151;">${range.text || (dayType !== 'work' ? dayType.charAt(0).toUpperCase()+dayType.slice(1) : '—')}</td>
      <td style="text-align:center;color:#6b7280;">${brk ? brk+' min' : '—'}</td>
      <td style="text-align:right;font-weight:700;color:#111827;">${worked ? fmtMins(worked) : '—'}</td>
      <td style="text-align:right;color:${hourlyRate > 0 ? '#16a34a' : '#374151'};font-weight:600;">${hourlyRate > 0 ? (money(worked) || '—') : '—'}</td>
      <td style="color:#9ca3af;font-size:12px;">${e.note || ''}</td>
    </tr>`;
  });

  const otMins = Math.max(0, totalMins - otThreshMins);
  const regularMins = Math.min(totalMins, otThreshMins);
  const regularEarn = hourlyRate * regularMins / 60;
  const otEarn = hourlyRate * overtimeRate * otMins / 60;
  const totalEarn = regularEarn + otEarn;
  const avgMins = daysWorked > 0 ? Math.round(totalMins / daysWorked) : 0;

  const win = window.open('', '_blank');
  if (!win) { showToast('Allow popups to export PDF'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Timesheet – ${MO[first.getMonth()]} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}</title>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111827;padding:48px;font-size:14px;line-height:1.5;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;border-bottom:2px solid #16a34a;padding-bottom:20px;}
    .title{font-size:26px;font-weight:800;color:#111827;letter-spacing:-0.5px;}
    .subtitle{font-size:14px;color:#6b7280;margin-top:4px;}
    .header-right{text-align:right;}
    .period{font-size:15px;font-weight:700;color:#374151;}
    .generated{font-size:12px;color:#9ca3af;margin-top:4px;}
    .summary-row{display:flex;gap:16px;margin-bottom:28px;}
    .sum-card{flex:1;background:#f9fafb;border-radius:10px;padding:14px 16px;border:1px solid #e5e7eb;}
    .sum-lbl{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:4px;}
    .sum-val{font-size:20px;font-weight:800;color:#111827;}
    .sum-sub{font-size:12px;color:#9ca3af;margin-top:2px;}
    table{width:100%;border-collapse:collapse;font-size:13.5px;}
    thead tr{background:#16a34a;color:white;}
    th{padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
    th:last-child,th:nth-child(4),th:nth-child(5),th:nth-child(6){text-align:right;}
    td{padding:10px 12px;border-bottom:1px solid #f3f4f6;}
    tbody tr:hover{background:#f9fafb;}
    .total-row td{font-weight:700;background:#f0fdf4;border-top:2px solid #16a34a;font-size:14px;}
    .ot-note{margin-top:20px;padding:12px 16px;background:#fefce8;border:1px solid #fde047;border-radius:8px;font-size:12px;color:#713f12;}
    .footer{margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;}
    @media print{body{padding:24px;}@page{margin:16mm;}}
  </style>
  </head><body>
  <div class="header">
    <div>
      <div class="title">Timesheet</div>
      <div class="subtitle">${MO[first.getMonth()]} ${first.getDate()} – ${MO[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}</div>
    </div>
    <div class="header-right">
      <div class="period">Week of ${MO[first.getMonth()]} ${first.getDate()}</div>
      <div class="generated">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
    </div>
  </div>
  <div class="summary-row">
    <div class="sum-card">
      <div class="sum-lbl">Total Hours</div>
      <div class="sum-val">${totalMins ? fmtMins(totalMins) : '0h 00m'}</div>
      <div class="sum-sub">${daysWorked} day${daysWorked!==1?'s':''} worked</div>
    </div>
    <div class="sum-card">
      <div class="sum-lbl">Avg per Day</div>
      <div class="sum-val">${avgMins ? fmtMins(avgMins) : '—'}</div>
      <div class="sum-sub">across worked days</div>
    </div>
    <div class="sum-card">
      <div class="sum-lbl">Total Break</div>
      <div class="sum-val">${totalBreak ? totalBreak+'m' : '—'}</div>
      <div class="sum-sub">across the week</div>
    </div>
    ${hourlyRate > 0 ? `<div class="sum-card" style="border-color:#bbf7d0;background:#f0fdf4;">
      <div class="sum-lbl" style="color:#16a34a;">Total Earnings</div>
      <div class="sum-val" style="color:#15803d;">${curSym()}${totalEarn.toFixed(2)}</div>
      <div class="sum-sub">${hourlyRate.toFixed(2)}/hr${otMins>0?' (incl. OT)':''}</div>
    </div>` : ''}
  </div>
  <table>
    <thead><tr>
      <th>Day</th><th>Date</th><th>Time Range</th><th style="text-align:center;">Break</th><th style="text-align:right;">Hours</th>${hourlyRate>0?'<th style="text-align:right;">Earnings</th>':''}<th style="text-align:right;">Note</th>
    </tr></thead>
    <tbody>${rows}
      <tr class="total-row">
        <td colspan="4" style="text-align:right;padding-right:12px;">Weekly Total</td>
        <td style="text-align:right;">${totalMins ? fmtMins(totalMins) : '—'}</td>
        ${hourlyRate>0?`<td style="text-align:right;color:#15803d;">${curSym()}${totalEarn.toFixed(2)}</td>`:''}
        <td></td>
      </tr>
    </tbody>
  </table>
  ${otMins > 0 && hourlyRate > 0 ? `<div class="ot-note">⚡ Overtime: ${fmtMins(otMins)} at ${overtimeRate}× rate = ${curSym()}${otEarn.toFixed(2)} (Regular: ${curSym()}${regularEarn.toFixed(2)} + OT: ${curSym()}${otEarn.toFixed(2)})</div>` : ''}
  <div class="footer">
    <span>Hours Tracker</span>
    <span>To save as PDF: File → Print → Save as PDF</span>
  </div>
  <script>window.onload=()=>{setTimeout(()=>window.print(),400);}<\/script>
  </body></html>`);
  win.document.close();
}

// ─── Apply restored backup (shared logic) ───
function applyRestoredBackup(data) {
  db = migrateEntries(data.db || {});
  hourlyRate = parseFloat(data.hourlyRate) || 0;
  overtimeThresholdHours = Math.max(1, parseFloat(data.overtimeThresholdHours || overtimeThresholdHours) || 40);
  overtimeRate = Math.max(1, parseFloat(data.overtimeRate || overtimeRate) || 1.5);
  breakReminderHours = Math.max(1, parseFloat(data.breakReminderHours || breakReminderHours) || 6);
  autoBreakMins = Math.max(0, parseInt(data.autoBreakMins || autoBreakMins, 10) || 0);
  roundingIncrementMins = Math.max(1, parseInt(data.roundingIncrementMins || roundingIncrementMins, 10) || 15);
  roundingMode = data.roundingMode || roundingMode;
  scheduledStartTime = data.scheduledStartTime || scheduledStartTime;
  lateGraceMins = Math.max(0, parseInt(data.lateGraceMins || lateGraceMins, 10) || 0);
  longShiftAlertHours = Math.max(1, parseFloat(data.longShiftAlertHours || longShiftAlertHours) || 10);
  missedClockOutHours = Math.max(1, parseFloat(data.missedClockOutHours || missedClockOutHours) || 14);
  localStorage.setItem('ht_overtime_threshold', overtimeThresholdHours);
  localStorage.setItem('ht_overtime_rate', overtimeRate);
  localStorage.setItem('ht_break_reminder_hours', breakReminderHours);
  localStorage.setItem('ht_auto_break_mins', autoBreakMins);
  localStorage.setItem('ht_rounding_increment_mins', roundingIncrementMins);
  localStorage.setItem('ht_rounding_mode', roundingMode);
  localStorage.setItem('ht_scheduled_start_time', scheduledStartTime);
  localStorage.setItem('ht_late_grace_mins', lateGraceMins);
  localStorage.setItem('ht_long_shift_alert_hours', longShiftAlertHours);
  localStorage.setItem('ht_missed_clock_out_hours', missedClockOutHours);
  clients = normalizeNamedItems(data.clients || clients, 'client');
  projects = normalizeNamedItems(data.projects || projects, 'project');
  tags = normalizeNamedItems(data.tags || tags, 'tag');
  if (data.dailySchedule && typeof data.dailySchedule === 'object') {
    dailySchedule = { ...DEFAULT_SCHEDULE, ...data.dailySchedule };
    saveDailySchedule();
  }
  if (data.themePreference) {
    themePreference = data.themePreference;
    localStorage.setItem('ht_theme', themePreference);
    applyTheme();
  }
  syncCollections();
  if (data.currency && CURRENCIES[data.currency]) {
    currency = data.currency;
    localStorage.setItem('ht_currency', currency);
  }
  persist();
  localStorage.setItem('ht_rate', hourlyRate);
  $('rateInput').value = hourlyRate.toFixed(2);
  $('rateSym').textContent = curSym();
  const curSel = $('currencySelect');
  if (curSel) curSel.value = currency;
  restoreClockState();
  renderWeek();
  renderClockPage();
  if ($('page-calendar').classList.contains('active')) renderCalendar();
  renderFilterControls();
  renderMetadataSettings();
  localStorage.setItem('ht_lastBackupAt', new Date().toISOString());
  updateBackupStatus();
}

// ═══════════════════════════════════════
//  iOS-style DRAG SLIDER for clock in/out
// ═══════════════════════════════════════
let _sliderDragging = false; // used to suppress swipe-week gesture

function setupClockSlider() {
  function initSlider(wrapId, thumbId, labelId) {
    const wrap  = document.getElementById(wrapId);
    const thumb = document.getElementById(thumbId);
    if (!wrap || !thumb) return;

    let dragging = false, startX = 0, curX = 0;

    function maxX() { return wrap.offsetWidth - thumb.offsetWidth - 12; }

    function clamp(x) { return Math.max(0, Math.min(x, maxX())); }

    function moveThumb(x) {
      x = clamp(x);
      curX = x;
      thumb.style.transition = 'none';
      thumb.style.left = (6 + x) + 'px';
      // Fade the label text as thumb moves right
      const label = wrap.querySelector('.clock-slider-label');
      if (label) label.style.opacity = String(Math.max(0.15, 1 - (x / maxX()) * 0.95));
      // Animate track fill behind thumb
      const fill = wrap.querySelector('.clock-slider-track-fill');
      if (fill) {
        const pct = (x / maxX()) * 100;
        fill.style.transition = 'none';
        fill.style.width = Math.min(pct + 6, 100) + '%';
      }
    }

    function springBack() {
      const label = wrap.querySelector('.clock-slider-label');
      const fill = wrap.querySelector('.clock-slider-track-fill');
      thumb.style.transition = 'left 0.45s cubic-bezier(0.34,1.56,0.64,1)';
      thumb.style.left = '6px';
      if (label) { label.style.transition = 'opacity 0.3s'; label.style.opacity = '1'; }
      if (fill) { fill.style.transition = 'width 0.4s ease'; fill.style.width = '0%'; }
      setTimeout(() => { if (label) label.style.transition = ''; }, 350);
    }

    function commit() {
      const label = wrap.querySelector('.clock-slider-label');
      const mx = maxX();
      thumb.style.transition = 'left 0.2s ease-out';
      thumb.style.left = (6 + mx) + 'px';
      if (label) label.style.opacity = '0';
      setTimeout(() => {
        toggleClock();
        // Reset thumb position and fill after toggle
        setTimeout(() => {
          thumb.style.transition = 'left 0.45s cubic-bezier(0.34,1.56,0.64,1)';
          thumb.style.left = '6px';
          if (label) { label.style.opacity = '1'; }
          const fill = wrap.querySelector('.clock-slider-track-fill');
          if (fill) { fill.style.transition = 'width 0.4s ease'; fill.style.width = '0%'; }
        }, 300);
      }, 160);
    }

    function release() {
      if (!dragging) return;
      dragging = false;
      _sliderDragging = false;
      // Trigger if dragged past 82% of track
      if (curX >= maxX() * 0.82) {
        commit();
      } else {
        springBack();
      }
    }

    // ── Touch ──
    thumb.addEventListener('touchstart', (e) => {
      dragging = true;
      _sliderDragging = true;
      startX = e.touches[0].clientX;
      curX = 0;
      thumb.style.transition = 'none';
      e.stopPropagation();
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      moveThumb(e.touches[0].clientX - startX);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (dragging) release();
    }, { passive: true });

    // ── Mouse (desktop) ──
    thumb.addEventListener('mousedown', (e) => {
      dragging = true;
      _sliderDragging = true;
      startX = e.clientX;
      curX = 0;
      thumb.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      moveThumb(e.clientX - startX);
    });

    document.addEventListener('mouseup', () => {
      if (dragging) release();
    });
  }

  initSlider('cSliderWrap', 'cSliderThumb', 'cSliderLabel');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  syncCollections();
  window.addEventListener('pageshow', refreshRunningClockFromStorage);
  window.addEventListener('focus', refreshRunningClockFromStorage);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRunningClockFromStorage();
  });

  $('rateInput').value = hourlyRate.toFixed(2);
  $('rateSym').textContent = curSym();
  const _curSel = $('currencySelect');
  if (_curSel) _curSel.value = currency;
  const _wkSel = $('weekStartSelect');
  if (_wkSel) _wkSel.value = weekStartsOnMonday() ? 'monday' : 'sunday';
  const _otThresh = $('overtimeThresholdInput');
  if (_otThresh) _otThresh.value = overtimeThresholdHours;
  const _otRate = $('overtimeRateInput');
  if (_otRate) _otRate.value = overtimeRate;
  applyTheme();
  renderDailyScheduleSettings();
  // Sync overtime bar toggle UI
  const otToggle = document.getElementById('overtimeBarToggle');
  const otTrack = document.getElementById('overtimeBarToggleTrack');
  const otThumb = document.getElementById('overtimeBarToggleThumb');
  if (otToggle) otToggle.checked = showOvertimeBar;
  if (otTrack) otTrack.style.background = showOvertimeBar ? '#ca8a04' : 'var(--fill)';
  if (otThumb) otThumb.style.left = showOvertimeBar ? '22px' : '2px';

  restoreClockState();
  setupClockSlider();
  renderWeek();
  updateBackupStatus();
  maybeRemindBackup();
  initNotifications();

  // ─── Floating week nav via IntersectionObserver ───
  (function setupFloatingWeekNav() {
    const sentinel = document.getElementById('weekNavWrap');
    const floatNav = document.getElementById('floatWeekNav');
    if (!sentinel || !floatNav) return;

    function updateFloatNav() {
      const trackerActive = document.getElementById('page-tracker').classList.contains('active');
      if (!trackerActive) {
        floatNav.classList.remove('visible');
        floatNav.setAttribute('aria-hidden', 'true');
        return;
      }
      // getBoundingClientRect works regardless of which element is the scroll container
      const rect = sentinel.getBoundingClientRect();
      if (rect.bottom < 60) {
        floatNav.classList.add('visible');
        floatNav.setAttribute('aria-hidden', 'false');
      } else {
        floatNav.classList.remove('visible');
        floatNav.setAttribute('aria-hidden', 'true');
      }
    }

    window.addEventListener('scroll', updateFloatNav, { passive: true });
    document.body.addEventListener('scroll', updateFloatNav, { passive: true });
    updateFloatNav();
  })();

  // ─── Touch swipe to change week / month ───
  (function setupSwipeGesture() {
    let touchStartX = 0, touchStartY = 0;
    const MIN_SWIPE = 50;
    const MAX_VERT = 80;

    document.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      const overlay = document.getElementById('overlay');
      const payrollOverlay = document.getElementById('payrollOverlay');
      if (overlay && overlay.classList.contains('open')) return;
      if (payrollOverlay && payrollOverlay.classList.contains('open')) return;
      const alertOverlay = document.getElementById('iosAlertOverlay');
      if (alertOverlay && alertOverlay.classList.contains('open')) return;
      if (_sliderDragging) return; // slider is being dragged — don't change week

      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
      if (Math.abs(dx) < MIN_SWIPE || dy > MAX_VERT) return;

      const trackerActive = document.getElementById('page-tracker').classList.contains('active');
      const calActive = document.getElementById('page-calendar').classList.contains('active');

      if (trackerActive) {
        if (dx < 0) changeWeek(1);
        else changeWeek(-1);
      } else if (calActive) {
        if (dx < 0) changeMonth(1);
        else changeMonth(-1);
      }
    }, { passive: true });
  })();

  document.addEventListener('keydown', (e) => {
    const sheetOpen = $('overlay').classList.contains('open');
    const alertOpen = document.getElementById('iosAlertOverlay') && document.getElementById('iosAlertOverlay').classList.contains('open');

    if (e.key === 'Escape' && sheetOpen && !alertOpen) {
      closeSheet();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 's' && sheetOpen) {
      e.preventDefault();
      saveEntry();
      return;
    }

    if (sheetOpen || alertOpen) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if ($('page-tracker').classList.contains('active')) {
      if (e.key === 'ArrowLeft') changeWeek(-1);
      else if (e.key === 'ArrowRight') changeWeek(1);
    } else if ($('page-calendar').classList.contains('active')) {
      if (e.key === 'ArrowLeft') changeMonth(-1);
      else if (e.key === 'ArrowRight') changeMonth(1);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseSessionDateTime,
    getSessionBounds,
    getSessionTotalMins,
    getSessionMins,
    getDaySessionSegments,
    getWorkedMinsForDay,
    getTotalBreakForDay,
    getDaySessionCount,
    getDayDisplayRange,
    getFirstInForDay,
    getLastOutForDay,
    applyAutoBreakToSession,
    roundMins,
    maybeRecoverMissedClockOut,
    updateSessionDateTime,
    normalizeEntry,
    normalizeSession,
    getSessionOverlaps,
    getDayStatus,
    setDayType,
    buildCSVForRange,
    loadDailySchedule,
    getScheduleForDate,
    __setDb(nextDb) {
      db = nextDb || {};
    },
    __getDb() {
      return db;
    },
    __setCollections(nextCollections) {
      clients = normalizeNamedItems(nextCollections?.clients || [], 'client');
      projects = normalizeNamedItems(nextCollections?.projects || [], 'project');
      tags = normalizeNamedItems(nextCollections?.tags || [], 'tag');
    },
    __setFilters(nextFilters) {
      selectedClientFilter = nextFilters?.clientId || '';
      selectedProjectFilter = nextFilters?.projectId || '';
    }
  };
}





