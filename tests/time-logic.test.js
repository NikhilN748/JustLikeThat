// Pin the timezone so tests with fixed UTC offsets (-05:00) are deterministic
// regardless of the machine they run on.
process.env.TZ = 'America/Chicago';

const assert = require('assert');

const storage = new Map();
global.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

// Disable time rounding for exact-duration tests (default increment is 15).
// Must be set BEFORE app.js is required, since settings load at module init.
localStorage.setItem('ht_rounding_increment_mins', '1');
localStorage.setItem('ht_rounding_mode', 'nearest');

function makeElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    style: {},
    className: '',
    dataset: {},
    clientHeight: 0,
    offsetTop: 0,
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    remove() {},
    click() {},
    focus() {},
    select() {},
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    classList: {
      add() {},
      remove() {},
      contains() { return false; }
    }
  };
}

global.document = {
  hidden: true,
  activeElement: null,
  body: makeElement(),
  documentElement: makeElement(),
  createElement() { return makeElement(); },
  getElementById() { return makeElement(); },
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return makeElement(); },
  querySelectorAll() { return []; }
};

global.window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return {
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    };
  },
  navigator: {
    standalone: false
  }
};

global.history = {
  state: null,
  pushState() {},
  replaceState() {},
  back() {}
};

const app = require('../app.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ─── Session duration ───

test('same-day session keeps normal duration', () => {
  const mins = app.getSessionMins('2026-04-10', { in: '14:00', out: '15:00', brk: 0 });
  assert.strictEqual(mins, 60);
});

test('break minutes are deducted from worked time', () => {
  const mins = app.getSessionMins('2026-04-10', { in: '09:00', out: '17:00', brk: 30 });
  assert.strictEqual(mins, 450);
});

test('overnight clock session uses exact dates', () => {
  const mins = app.getSessionMins('2026-04-10', {
    in: '14:00',
    out: '13:00',
    brk: 0,
    inISO: '2026-04-10T14:00:00-05:00',
    outISO: '2026-04-11T13:00:00-05:00'
  });
  assert.strictEqual(mins, 1380);
});

test('legacy overnight fallback still works without ISO timestamps', () => {
  const mins = app.getSessionMins('2026-04-10', { in: '23:00', out: '01:00', brk: 0 });
  assert.strictEqual(mins, 120);
});

test('DST spring-forward session uses real elapsed time from offsets', () => {
  const mins = app.getSessionMins('2026-03-08', {
    in: '01:30',
    out: '03:30',
    brk: 0,
    inISO: '2026-03-08T01:30:00-06:00',
    outISO: '2026-03-08T03:30:00-05:00'
  });
  assert.strictEqual(mins, 60);
});

test('getSessionBounds bumps end to next day when end <= start', () => {
  const { start, end } = app.getSessionBounds('2026-04-10', { in: '22:00', out: '06:00', brk: 0 });
  assert.ok(end > start);
  assert.strictEqual(Math.floor((end - start) / 60000), 480);
});

// ─── Day segments ───

test('overnight session is split across both calendar days', () => {
  app.__setDb({
    '2026-04-10': {
      sessions: [{
        in: '14:00',
        out: '13:00',
        brk: 0,
        inISO: '2026-04-10T14:00:00-05:00',
        outISO: '2026-04-11T13:00:00-05:00'
      }],
      note: ''
    }
  });

  assert.strictEqual(app.getWorkedMinsForDay('2026-04-10'), 600);
  assert.strictEqual(app.getWorkedMinsForDay('2026-04-11'), 780);
  assert.strictEqual(app.getDaySessionCount('2026-04-11'), 1);
});

// ─── Manual edits ───

test('manual datetime update keeps both wall time and ISO', () => {
  const session = { in: '', inISO: '' };
  app.updateSessionDateTime(session, 'in', '2026-04-10T22:15');
  assert.strictEqual(session.in, '22:15');
  assert.ok(session.inISO.includes('2026-04-'));
});

test('legacy entries are normalized into V2-ready session records', () => {
  const entry = app.normalizeEntry({
    sessions: [{ in: '09:00', out: '17:00', brk: 30 }],
    note: 'Legacy entry'
  }, '2026-04-10');

  assert.strictEqual(entry.note, 'Legacy entry');
  assert.strictEqual(entry.status, 'open');
  assert.strictEqual(entry.sessions.length, 1);
  assert.strictEqual(entry.sessions[0].projectId, '');
  assert.deepStrictEqual(entry.sessions[0].tagIds, []);
  assert.ok(entry.sessions[0].id.startsWith('legacy:2026-04-10:0:09:00:17:00'));
});

test('time is tracked exactly as logged when rounding is disabled', () => {
  const mins = app.getSessionMins('2026-04-10', { in: '09:00', out: '09:22', brk: 0 });
  assert.strictEqual(mins, 22);
});

// ─── Rounding ───

test('roundMins rounds to nearest increment', () => {
  app.__setRounding(15, 'nearest');
  assert.strictEqual(app.roundMins(22), 15);
  assert.strictEqual(app.roundMins(23), 30);
  assert.strictEqual(app.roundMins(60), 60);
  app.__setRounding(1, 'nearest');
});

test('roundMins rounds up and down by mode', () => {
  app.__setRounding(15, 'up');
  assert.strictEqual(app.roundMins(16), 30);
  app.__setRounding(15, 'down');
  assert.strictEqual(app.roundMins(29), 15);
  app.__setRounding(1, 'nearest');
});

test('roundMins with increment 1 leaves minutes unchanged', () => {
  app.__setRounding(1, 'nearest');
  assert.strictEqual(app.roundMins(22), 22);
  assert.strictEqual(app.roundMins(0), 0);
});

// ─── Session overlaps ───

test('overlapping closed sessions are flagged', () => {
  const issues = app.getSessionOverlaps([
    { in: '09:00', out: '12:00', brk: 0 },
    { in: '11:00', out: '14:00', brk: 0 }
  ], '2026-04-10');
  assert.strictEqual(issues.length, 1);
});

test('open (running) sessions are excluded from overlap checks', () => {
  const issues = app.getSessionOverlaps([
    { in: '09:00', out: '', brk: 0 },
    { in: '10:00', out: '11:00', brk: 0 }
  ], '2026-04-10');
  assert.strictEqual(issues.length, 0);
});

test('back-to-back sessions do not overlap', () => {
  const issues = app.getSessionOverlaps([
    { in: '09:00', out: '12:00', brk: 0 },
    { in: '12:00', out: '14:00', brk: 0 }
  ], '2026-04-10');
  assert.strictEqual(issues.length, 0);
});

// ─── Pay rate history ───

test('getRateForDate returns the rate active on each day', () => {
  app.addPayRate(20, '2026-01-01', 'Raise 1');
  app.addPayRate(25, '2026-06-01', 'Raise 2');
  assert.strictEqual(app.getRateForDate('2025-12-31'), 0);  // initial migrated rate
  assert.strictEqual(app.getRateForDate('2026-01-01'), 20);
  assert.strictEqual(app.getRateForDate('2026-03-15'), 20);
  assert.strictEqual(app.getRateForDate('2026-06-01'), 25);
  assert.strictEqual(app.getRateForDate('2026-12-31'), 25);
});

test('replaceAllRates collapses history to a single rate', () => {
  app.replaceAllRates(30);
  assert.strictEqual(app.getRateForDate('2025-01-01'), 30);
  assert.strictEqual(app.getRateForDate('2026-12-31'), 30);
});

// ─── Backup validation ───

test('valid backup payload passes validation', () => {
  const check = app.validateBackupData({
    db: { '2026-04-10': { sessions: [{ in: '09:00', out: '17:00' }], note: '' } },
    payRates: [],
    clients: []
  });
  assert.strictEqual(check.ok, true);
  assert.strictEqual(check.entryCount, 1);
});

test('backup without db section is rejected', () => {
  assert.strictEqual(app.validateBackupData({}).ok, false);
  assert.strictEqual(app.validateBackupData(null).ok, false);
  assert.strictEqual(app.validateBackupData([1, 2]).ok, false);
});

test('backup with invalid date keys or entry shapes is rejected', () => {
  assert.strictEqual(app.validateBackupData({ db: { 'not-a-date': {} } }).ok, false);
  assert.strictEqual(app.validateBackupData({ db: { '2026-04-10': 'oops' } }).ok, false);
  assert.strictEqual(app.validateBackupData({ db: { '2026-04-10': { sessions: 'oops' } } }).ok, false);
});

test('backup with non-array collections is rejected', () => {
  assert.strictEqual(app.validateBackupData({ db: {}, payRates: 'oops' }).ok, false);
  assert.strictEqual(app.validateBackupData({ db: {}, clients: {} }).ok, false);
});
