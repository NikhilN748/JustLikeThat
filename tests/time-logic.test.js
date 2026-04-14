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
  createElement() { return makeElement(); },
  getElementById() { return makeElement(); },
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return makeElement(); },
  querySelectorAll() { return []; }
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

test('same-day session keeps normal duration', () => {
  const mins = app.getSessionMins('2026-04-10', { in: '14:00', out: '15:00', brk: 0 });
  assert.strictEqual(mins, 60);
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

test('time is tracked exactly as logged (no rounding)', () => {
  const mins = app.getSessionMins('2026-04-10', { in: '09:00', out: '09:22', brk: 0 });
  assert.strictEqual(mins, 22);
});

test('auto break no longer modifies sessions', () => {
  const session = app.applyAutoBreakToSession({
    in: '09:00',
    out: '16:00',
    brk: 0
  }, '2026-04-10');
  assert.strictEqual(session.brk, 0);
});
