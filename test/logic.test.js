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
  assert.deepStrictEqual(util.parseClock('1400'), { h: 14, m: 0 });
  assert.deepStrictEqual(util.parseClock('9:30'), { h: 9, m: 30 });
  assert.strictEqual(util.parseClock(''), null);
  assert.strictEqual(util.parseClock('banana'), null);
  assert.strictEqual(util.parseClock('25:00'), null);
  assert.strictEqual(util.parseClock('13am'), null); // 12-hour clock only
});

test('fmtClock renders friendly 12-hour times', () => {
  assert.strictEqual(util.fmtClock(9, 0), '9:00 AM');
  assert.strictEqual(util.fmtClock(21, 30), '9:30 PM');
  assert.strictEqual(util.fmtClock(0, 0), '12:00 AM');
  assert.strictEqual(util.fmtClock(12, 0), '12:00 PM');
});

// ---- Tree structure ----------------------------------------------------------

test('makeGoal is an every-day leaf with no time and no length', () => {
  const g = model.makeGoal('Meditate');
  assert.ok(model.isLeaf(g));
  assert.deepStrictEqual(g.habit.daysOfWeek, [0, 1, 2, 3, 4, 5, 6]);
  assert.strictEqual(g.habit.startTime, null);
  assert.strictEqual(g.habit.durationMin, 0);
  assert.deepStrictEqual(g.habit.completedDates, []);
});

test('addChild promotes a leaf to a parent; removeNode demotes back', () => {
  const forest = [model.makeGoal('Goal A')];
  const goalId = forest[0].id;
  assert.ok(model.isLeaf(forest[0]));

  const child = model.makeNode('Subgoal', model.defaultHabit());
  model.addChild(forest, goalId, child);
  assert.ok(!model.isLeaf(forest[0]));        // now a parent
  assert.strictEqual(forest[0].habit, null);  // habit data dropped

  model.removeNode(forest, child.id);
  assert.ok(model.isLeaf(forest[0]));         // back to a leaf
  assert.ok(forest[0].habit && forest[0].habit.daysOfWeek.length === 7);
});

test('find and path locate nodes in the forest', () => {
  const forest = [model.makeNode('Root', null)];
  const a = model.makeNode('A', null);
  const b = model.makeNode('B', model.defaultHabit());
  forest[0].children = [a];
  a.children = [b];
  const found = model.find(forest, b.id);
  assert.strictEqual(found.node.title, 'B');
  assert.strictEqual(found.parent.title, 'A');
  const p = model.path(forest, b.id).map((n) => n.title);
  assert.deepStrictEqual(p, ['Root', 'A', 'B']);
});

test('normalizeHabitData cleans up junk without crashing', () => {
  const h = model.normalizeHabitData({
    daysOfWeek: [5, 1, 1, 9, -2, 'x', 3],
    startTime: 'lunchtime',
    durationMin: -5,
    completedDates: ['2026-08-01', 42]
  });
  assert.deepStrictEqual(h.daysOfWeek, [1, 3, 5]); // deduped, sorted, in-range
  assert.strictEqual(h.startTime, null);           // unreadable time dropped
  assert.strictEqual(h.durationMin, 0);            // negative duration dropped
  assert.deepStrictEqual(h.completedDates, ['2026-08-01']);
  const t = model.normalizeHabitData({ startTime: '07:30', durationMin: 45.4 });
  assert.strictEqual(t.startTime, '07:30');
  assert.strictEqual(t.durationMin, 45);
  // no days at all falls back to every day (everything recurs)
  assert.strictEqual(model.normalizeHabitData({ daysOfWeek: [] }).daysOfWeek.length, 7);
});

// ---- Occurrence / today's list ----------------------------------------------

test('occursOn matches the day of week', () => {
  const g = model.makeGoal('Gym');
  g.habit.daysOfWeek = [1, 3, 5]; // Mon Wed Fri
  assert.strictEqual(model.occursOn(g, new Date(2026, 7, 3)), true);  // Mon Aug 3
  assert.strictEqual(model.occursOn(g, new Date(2026, 7, 4)), false); // Tue Aug 4
});

test('forDate flattens the tree, keeps crumbs, sorts by time with untimed last', () => {
  const parent = model.makeNode('Learn Japanese', null);
  const anki = model.makeGoal('Anki'); anki.habit.startTime = '23:00';
  const immerse = model.makeGoal('Immersion'); immerse.habit.startTime = '12:00';
  parent.children = [anki, immerse];
  parent.habit = null;
  const read = model.makeGoal('Read'); // anytime, top-level
  const weekend = model.makeGoal('Long run');
  weekend.habit.daysOfWeek = [0, 6];

  const mon = new Date(2026, 7, 3); // Mon Aug 3 2026
  immerse.habit.completedDates = ['2026-08-03'];

  const items = model.forDate([parent, read, weekend], mon);
  assert.deepStrictEqual(items.map((i) => i.node.title), ['Immersion', 'Anki', 'Read']);
  assert.deepStrictEqual(items.map((i) => i.done), [true, false, false]);
  assert.deepStrictEqual(items[0].crumb, ['Learn Japanese']);
  assert.deepStrictEqual(items[2].crumb, []);
});

test('toggleDate checks a day off and back on', () => {
  const g = model.makeGoal('Stretch');
  assert.strictEqual(model.toggleDate(g, '2026-08-06'), true);
  assert.ok(model.isDoneOn(g, '2026-08-06'));
  assert.strictEqual(model.toggleDate(g, '2026-08-06'), false);
  assert.ok(!model.isDoneOn(g, '2026-08-06'));
});

test('dayStats rolls up counts and minutes across the forest', () => {
  const parent = model.makeNode('P', null);
  const a = model.makeGoal('A'); a.habit.durationMin = 30;
  const b = model.makeGoal('B'); b.habit.durationMin = 60;
  parent.children = [a, b]; parent.habit = null;
  const c = model.makeGoal('C'); // no duration, top-level
  const day = new Date(2026, 7, 6);
  a.habit.completedDates = [util.ymd(day)];
  const s = model.dayStats([parent, c], day);
  assert.strictEqual(s.due, 3);
  assert.strictEqual(s.done, 1);
  assert.strictEqual(s.totalMin, 90);
  assert.strictEqual(s.doneMin, 30);
  assert.strictEqual(s.remainingMin, 60);
});

test('rollupToday aggregates one subtree for the parent row', () => {
  const parent = model.makeNode('P', null);
  const a = model.makeGoal('A'); a.habit.durationMin = 30;
  const b = model.makeGoal('B'); b.habit.durationMin = 60;
  const off = model.makeGoal('Weekend only'); off.habit.daysOfWeek = [0, 6];
  parent.children = [a, b, off]; parent.habit = null;
  const thu = new Date(2026, 7, 6);
  a.habit.completedDates = [util.ymd(thu)];
  const r = model.rollupToday(parent, thu);
  assert.strictEqual(r.due, 2);       // 'Weekend only' isn't due Thursday
  assert.strictEqual(r.done, 1);
  assert.strictEqual(r.totalMin, 90);
  assert.strictEqual(r.percent, 50);
});

// ---- Streaks -----------------------------------------------------------------

test('streak counts consecutive completed due days', () => {
  const g = model.makeGoal('Meditate'); // every day
  const today = new Date(2026, 7, 6); // Thu Aug 6
  g.habit.completedDates = ['2026-08-04', '2026-08-05', '2026-08-06'];
  assert.strictEqual(model.streak(g, today), 3);
});

test('an unchecked today does not break a live streak', () => {
  const g = model.makeGoal('Meditate');
  const today = new Date(2026, 7, 6);
  g.habit.completedDates = ['2026-08-04', '2026-08-05']; // today not done (yet)
  assert.strictEqual(model.streak(g, today), 2);
});

test('a missed due day ends the streak', () => {
  const g = model.makeGoal('Meditate');
  const today = new Date(2026, 7, 6);
  g.habit.completedDates = ['2026-08-03', '2026-08-06']; // Aug 4+5 missed
  assert.strictEqual(model.streak(g, today), 1);
});

test('off days are skipped, not counted against the streak', () => {
  const g = model.makeGoal('Gym');
  g.habit.daysOfWeek = [1, 3, 5]; // Mon Wed Fri
  const today = new Date(2026, 7, 7); // Fri Aug 7
  // Mon Aug 3, Wed Aug 5, Fri Aug 7 done; Tue/Thu are off days.
  g.habit.completedDates = ['2026-08-03', '2026-08-05', '2026-08-07'];
  assert.strictEqual(model.streak(g, today), 3);
});
