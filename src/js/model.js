// Pure domain logic for habits: factories, normalisation, "what's due today",
// streaks, and history. No DOM access — this is the part the Node tests exercise
// directly. UMD-wrapped like util.js.
//
// A habit is a flat record (no trees, no one-off tasks — this app is a habit
// tracker, not a planner):
//   {
//     id: 'h_…',
//     title: 'Meditate',
//     notes: '',
//     daysOfWeek: [1,2,3,4,5],   // 0=Sun .. 6=Sat — which days it's due
//     startTime: '07:00' | null, // 24h HH:MM, or null = anytime that day
//     durationMin: 20,           // 0 = no set length
//     completedDates: ['YYYY-MM-DD', ...] // days it was checked off
//   }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util.js'));
  } else {
    root.Planner = root.Planner || {};
    root.Planner.model = factory(root.Planner.util);
  }
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  function makeHabit(title) {
    return {
      id: util.uid('h'),
      title: title || 'Untitled',
      notes: '',
      daysOfWeek: ALL_DAYS.slice(),
      startTime: null,
      durationMin: 0,
      completedDates: []
    };
  }

  // Defensive clean-up so an old/partial/corrupt record can't crash the UI.
  function normalizeHabit(h) {
    if (!h || typeof h !== 'object') return null;
    var days = Array.isArray(h.daysOfWeek)
      ? h.daysOfWeek.filter(function (d) { return typeof d === 'number' && d >= 0 && d <= 6; })
      : ALL_DAYS.slice();
    days = days.filter(function (d, i) { return days.indexOf(d) === i; })
      .sort(function (a, b) { return a - b; });
    return {
      id: h.id || util.uid('h'),
      title: typeof h.title === 'string' ? h.title : 'Untitled',
      notes: typeof h.notes === 'string' ? h.notes : '',
      daysOfWeek: days,
      startTime: (typeof h.startTime === 'string' && /^\d{2}:\d{2}$/.test(h.startTime)) ? h.startTime : null,
      durationMin: (typeof h.durationMin === 'number' && isFinite(h.durationMin) && h.durationMin > 0)
        ? Math.round(h.durationMin) : 0,
      completedDates: Array.isArray(h.completedDates)
        ? h.completedDates.filter(function (d) { return typeof d === 'string'; })
        : []
    };
  }

  function findHabit(habits, id) {
    for (var i = 0; i < habits.length; i++) if (habits[i].id === id) return habits[i];
    return null;
  }

  // Is the habit due on this Date?
  function occursOn(habit, date) {
    return (habit.daysOfWeek || []).indexOf(date.getDay()) !== -1;
  }

  function isDoneOn(habit, dateKey) {
    return (habit.completedDates || []).indexOf(dateKey) !== -1;
  }

  // Check a habit off (or un-check it) for one day. Mutates the habit.
  function toggleDate(habit, dateKey) {
    var list = habit.completedDates || (habit.completedDates = []);
    var i = list.indexOf(dateKey);
    if (i === -1) list.push(dateKey); else list.splice(i, 1);
    return i === -1; // true = now done
  }

  // Minutes-since-midnight sort key; untimed habits sort last ("anytime").
  function timeKey(habit) {
    if (!habit.startTime) return 24 * 60 + 1;
    var p = habit.startTime.split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  // Everything due on `date`, sorted by time (untimed last) then title.
  // Returns [{ habit, done }].
  function forDate(habits, date) {
    var key = util.ymd(date);
    return habits
      .filter(function (h) { return occursOn(h, date); })
      .sort(function (a, b) {
        var t = timeKey(a) - timeKey(b);
        return t !== 0 ? t : String(a.title).localeCompare(String(b.title));
      })
      .map(function (h) { return { habit: h, done: isDoneOn(h, key) }; });
  }

  // Roll-up for the Today pill/popup: how much is due and how much is done.
  function dayStats(habits, date) {
    var items = forDate(habits, date);
    var s = { due: items.length, done: 0, totalMin: 0, doneMin: 0, remainingMin: 0 };
    items.forEach(function (it) {
      var d = it.habit.durationMin || 0;
      s.totalMin += d;
      if (it.done) { s.done += 1; s.doneMin += d; }
      else s.remainingMin += d;
    });
    return s;
  }

  // Current streak of consecutive due days completed, ending at `today`.
  // Days the habit isn't due don't break the run. Today only counts once it's
  // done — an unchecked today doesn't kill a streak that's still alive.
  function streak(habit, today) {
    if (!habit.daysOfWeek || !habit.daysOfWeek.length) return 0;
    var count = 0;
    var d = util.startOfDay(today);
    if (occursOn(habit, d)) {
      if (isDoneOn(habit, util.ymd(d))) count++;
      // due today but not done yet: skip today, keep counting yesterday back
    }
    d = util.addDays(d, -1);
    for (var guard = 0; guard < 1000; guard++) {
      if (occursOn(habit, d)) {
        if (!isDoneOn(habit, util.ymd(d))) break;
        count++;
      }
      d = util.addDays(d, -1);
    }
    return count;
  }

  // Last `days` days ending at `endDate` (inclusive), oldest first:
  // [{ date, due, done }]. Feeds the mini history grid on each habit card.
  function history(habit, endDate, days) {
    var out = [];
    var end = util.startOfDay(endDate);
    for (var i = days - 1; i >= 0; i--) {
      var d = util.addDays(end, -i);
      out.push({
        date: util.ymd(d),
        due: occursOn(habit, d),
        done: isDoneOn(habit, util.ymd(d))
      });
    }
    return out;
  }

  return {
    ALL_DAYS: ALL_DAYS,
    makeHabit: makeHabit,
    normalizeHabit: normalizeHabit,
    findHabit: findHabit,
    occursOn: occursOn,
    isDoneOn: isDoneOn,
    toggleDate: toggleDate,
    forDate: forDate,
    dayStats: dayStats,
    streak: streak,
    history: history
  };
});
