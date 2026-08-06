// Unit tests for the pure logic (no DOM, no Electron). Run with: npm test
// (requires Node 18+, which ships the built-in `node:test` runner).
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/js/util.js');
const model = require('../src/js/model.js');

test('parseDuration understands common formats', () => {
  assert.strictEqual(util.parseDuration('1h30m'), 90);
  assert.strictEqual(util.parseDuration('90m'), 90);
  assert.strictEqual(util.parseDuration('2h'), 120);
  assert.strictEqual(util.parseDuration('1:30'), 90);
  assert.strictEqual(util.parseDuration('45'), 45);
  assert.strictEqual(util.parseDuration('1.5h'), 90);
  assert.strictEqual(util.parseDuration(''), null);
  assert.strictEqual(util.parseDuration('banana'), null);
});

test('formatDuration is human readable', () => {
  assert.strictEqual(util.formatDuration(90), '1h 30m');
  assert.strictEqual(util.formatDuration(120), '2h');
  assert.strictEqual(util.formatDuration(45), '45m');
  assert.strictEqual(util.formatDuration(0), '0m');
});

test('parseClock understands free-text time', () => {
  assert.deepStrictEqual(util.parseClock('900am'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('9am'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('9:00 AM'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('930pm'), { h: 21, m: 30 });
  assert.deepStrictEqual(util.parseClock('12am'), { h: 0, m: 0 });
  assert.deepStrictEqual(util.parseClock('12pm'), { h: 12, m: 0 });
  assert.deepStrictEqual(util.parseClock('1230pm'), { h: 12, m: 30 });
  assert.deepStrictEqual(util.parseClock('1400'), { h: 14, m: 0 });
  assert.deepStrictEqual(util.parseClock('0930'), { h: 9, m: 30 });
  assert.deepStrictEqual(util.parseClock('9'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('9:30'), { h: 9, m: 30 });
  assert.strictEqual(util.parseClock(''), null);
  assert.strictEqual(util.parseClock('banana'), null);
  assert.strictEqual(util.parseClock('25:00'), null);
  assert.strictEqual(util.parseClock('9:60'), null);
  assert.strictEqual(util.parseClock('13am'), null); // 12-hour clock only
});

test('fmtClock renders friendly 12-hour times', () => {
  assert.strictEqual(util.fmtClock(9, 0), '9:00 AM');
  assert.strictEqual(util.fmtClock(21, 30), '9:30 PM');
  assert.strictEqual(util.fmtClock(0, 0), '12:00 AM');
  assert.strictEqual(util.fmtClock(12, 0), '12:00 PM');
});

test('date helpers work in local time', () => {
  const d = new Date(2026, 5, 29, 13, 30); // Mon Jun 29 2026
  assert.strictEqual(util.ymd(d), '2026-06-29');
  assert.strictEqual(util.ymd(util.addDays(d, 3)), '2026-07-02');
  assert.strictEqual(util.ymd(util.startOfDay(d)), '2026-06-29');
});

// ---- Habit factory / normalisation -----------------------------------------

test('makeHabit defaults to every day, no time, no duration', () => {
  const h = model.makeHabit('Meditate');
  assert.strictEqual(h.title, 'Meditate');
  assert.deepStrictEqual(h.daysOfWeek, [0, 1, 2, 3, 4, 5, 6]);
  assert.strictEqual(h.startTime, null);
  assert.strictEqual(h.durationMin, 0);
  assert.deepStrictEqual(h.completedDates, []);
  assert.ok(h.id);
});

test('normalizeHabit cleans up junk without crashing', () => {
  assert.strictEqual(model.normalizeHabit(null), null);
  const h = model.normalizeHabit({
    title: 'Run',
    daysOfWeek: [5, 1, 1, 9, -2, 'x', 3],
    startTime: 'lunchtime',
    durationMin: -5,
    completedDates: ['2026-08-01', 42]
  });
  assert.deepStrictEqual(h.daysOfWeek, [1, 3, 5]); // deduped, sorted, in-range
  assert.strictEqual(h.startTime, null);           // unreadable time dropped
  assert.strictEqual(h.durationMin, 0);            // negative duration dropped
  assert.deepStrictEqual(h.completedDates, ['2026-08-01']);
  const t = model.normalizeHabit({ title: 'Gym', startTime: '07:30', durationMin: 45.4 });
  assert.strictEqual(t.startTime, '07:30');
  assert.strictEqual(t.durationMin, 45);
});

// ---- Occurrence / today's list ----------------------------------------------

test('occursOn matches the day of week', () => {
  const h = model.makeHabit('Gym');
  h.daysOfWeek = [1, 3, 5]; // Mon Wed Fri
  assert.strictEqual(model.occursOn(h, new Date(2026, 7, 3)), true);  // Mon Aug 3
  assert.strictEqual(model.occursOn(h, new Date(2026, 7, 4)), false); // Tue Aug 4
});

test('forDate lists only due habits, sorted by time with untimed last', () => {
  const gym = model.makeHabit('Gym');
  gym.daysOfWeek = [1]; gym.startTime = '18:00';
  const meditate = model.makeHabit('Meditate');
  meditate.startTime = '07:00';
  const read = model.makeHabit('Read'); // anytime
  const weekend = model.makeHabit('Long run');
  weekend.daysOfWeek = [0, 6];

  const mon = new Date(2026, 7, 3); // Mon Aug 3 2026
  meditate.completedDates = ['2026-08-03'];

  const items = model.forDate([gym, read, weekend, meditate], mon);
  assert.deepStrictEqual(items.map((i) => i.habit.title), ['Meditate', 'Gym', 'Read']);
  assert.deepStrictEqual(items.map((i) => i.done), [true, false, false]);
});

test('toggleDate checks a day off and back on', () => {
  const h = model.makeHabit('Stretch');
  assert.strictEqual(model.toggleDate(h, '2026-08-06'), true);
  assert.ok(model.isDoneOn(h, '2026-08-06'));
  assert.strictEqual(model.toggleDate(h, '2026-08-06'), false);
  assert.ok(!model.isDoneOn(h, '2026-08-06'));
});

test('dayStats rolls up counts and minutes', () => {
  const a = model.makeHabit('A'); a.durationMin = 30;
  const b = model.makeHabit('B'); b.durationMin = 60;
  const c = model.makeHabit('C'); // no duration
  const day = new Date(2026, 7, 6);
  a.completedDates = [util.ymd(day)];
  const s = model.dayStats([a, b, c], day);
  assert.strictEqual(s.due, 3);
  assert.strictEqual(s.done, 1);
  assert.strictEqual(s.totalMin, 90);
  assert.strictEqual(s.doneMin, 30);
  assert.strictEqual(s.remainingMin, 60);
});

// ---- Streaks -----------------------------------------------------------------

test('streak counts consecutive completed due days', () => {
  const h = model.makeHabit('Meditate'); // every day
  const today = new Date(2026, 7, 6); // Thu Aug 6
  h.completedDates = ['2026-08-04', '2026-08-05', '2026-08-06'];
  assert.strictEqual(model.streak(h, today), 3);
});

test('an unchecked today does not break a live streak', () => {
  const h = model.makeHabit('Meditate');
  const today = new Date(2026, 7, 6);
  h.completedDates = ['2026-08-04', '2026-08-05']; // today not done (yet)
  assert.strictEqual(model.streak(h, today), 2);
});

test('a missed due day ends the streak', () => {
  const h = model.makeHabit('Meditate');
  const today = new Date(2026, 7, 6);
  h.completedDates = ['2026-08-03', '2026-08-06']; // Aug 4+5 missed
  assert.strictEqual(model.streak(h, today), 1);
});

test('off days are skipped, not counted against the streak', () => {
  const h = model.makeHabit('Gym');
  h.daysOfWeek = [1, 3, 5]; // Mon Wed Fri
  const today = new Date(2026, 7, 7); // Fri Aug 7
  // Mon Aug 3, Wed Aug 5, Fri Aug 7 done; Tue/Thu are off days.
  h.completedDates = ['2026-08-03', '2026-08-05', '2026-08-07'];
  assert.strictEqual(model.streak(h, today), 3);
});

test('a habit with no due days has no streak', () => {
  const h = model.makeHabit('Nothing');
  h.daysOfWeek = [];
  assert.strictEqual(model.streak(h, new Date(2026, 7, 6)), 0);
});

// ---- History (mini grid) -----------------------------------------------------

test('history returns the last N days oldest-first with due/done flags', () => {
  const h = model.makeHabit('Gym');
  h.daysOfWeek = [1, 3, 5]; // Mon Wed Fri
  h.completedDates = ['2026-08-05'];
  const days = model.history(h, new Date(2026, 7, 6), 4); // Mon .. Thu Aug 3-6
  assert.strictEqual(days.length, 4);
  assert.deepStrictEqual(days.map((d) => d.date),
    ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']);
  assert.deepStrictEqual(days.map((d) => d.due), [true, false, true, false]);
  assert.deepStrictEqual(days.map((d) => d.done), [false, false, true, false]);
});
