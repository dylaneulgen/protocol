// Pure domain logic for the goal forest: node factories, tree navigation, and
// the recurring-habit layer (what's due today, streaks, roll-ups). No DOM access
// — this is the part the Node tests exercise directly. UMD-wrapped like util.js.
//
// A node is a LEAF iff it has no children. EVERY leaf is a recurring goal —
// there are no one-off tasks and no scheduling; this app is a habit tracker,
// not a planner. Parents are groupings ("Learn Japanese") whose progress rolls
// up from their descendant leaves.
//   {
//     id: 'n_…',
//     title: 'Complete daily anki review',
//     notes: '',
//     collapsed: false,
//     children: [],
//     habit: {                     // leaves only; null on parents
//       daysOfWeek: [0..6],        // 0=Sun .. 6=Sat — defaults to EVERY day
//       startTime: '23:00' | null, // 24h HH:MM, or null = anytime that day
//       durationMin: 60,           // 0 = no set length
//       completedDates: ['YYYY-MM-DD', ...]
//     }
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

  function isLeaf(node) {
    return !node.children || node.children.length === 0;
  }

  // Every goal recurs. Default: every day, no set time, no set length.
  function defaultHabit() {
    return {
      daysOfWeek: ALL_DAYS.slice(),
      startTime: null,
      durationMin: 0,
      completedDates: []
    };
  }

  // Defensive clean-up of the habit payload so old/partial data can't crash the UI.
  function normalizeHabitData(h) {
    if (!h || typeof h !== 'object') return defaultHabit();
    var days = Array.isArray(h.daysOfWeek)
      ? h.daysOfWeek.filter(function (d) { return typeof d === 'number' && d >= 0 && d <= 6; })
      : ALL_DAYS.slice();
    days = days.filter(function (d, i) { return days.indexOf(d) === i; })
      .sort(function (a, b) { return a - b; });
    if (!days.length) days = ALL_DAYS.slice();
    return {
      daysOfWeek: days,
      startTime: (typeof h.startTime === 'string' && /^\d{2}:\d{2}$/.test(h.startTime)) ? h.startTime : null,
      durationMin: (typeof h.durationMin === 'number' && isFinite(h.durationMin) && h.durationMin > 0)
        ? Math.round(h.durationMin) : 0,
      completedDates: Array.isArray(h.completedDates)
        ? h.completedDates.filter(function (d) { return typeof d === 'string'; })
        : []
    };
  }

  function makeNode(title, habit) {
    return {
      id: util.uid('n'),
      title: title || 'Untitled',
      notes: '',
      collapsed: false,
      children: [],
      habit: habit === undefined ? defaultHabit() : habit
    };
  }

  // A fresh goal starts as a leaf; adding a subgoal promotes it to a parent.
  function makeGoal(title) { return makeNode(title, defaultHabit()); }

  // ---- Tree navigation ------------------------------------------------------
  // Locate a node by id within a forest (array of root nodes).
  // Returns { node, parent, list, index } or null.
  function find(forest, id) {
    function rec(list, parent) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n.id === id) return { node: n, parent: parent, list: list, index: i };
        if (n.children && n.children.length) {
          var r = rec(n.children, n);
          if (r) return r;
        }
      }
      return null;
    }
    return rec(forest, null);
  }

  // Path of nodes from a root down to (and including) the node with `id`.
  function path(forest, id) {
    var result = [];
    function rec(list, acc) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        var here = acc.concat([n]);
        if (n.id === id) { result = here; return true; }
        if (n.children && n.children.length && rec(n.children, here)) return true;
      }
      return false;
    }
    rec(forest, []);
    return result;
  }

  function walk(forest, fn, depth, parent) {
    depth = depth || 0;
    for (var i = 0; i < forest.length; i++) {
      var n = forest[i];
      fn(n, depth, parent);
      if (n.children && n.children.length) walk(n.children, fn, depth + 1, n);
    }
  }

  // Collect every leaf node in the forest (optionally filtered).
  function leaves(forest, filter) {
    var out = [];
    walk(forest, function (n) {
      if (isLeaf(n) && (!filter || filter(n))) out.push(n);
    });
    return out;
  }

  function addChild(forest, parentId, node) {
    if (parentId == null) { forest.push(node); return node; }
    var f = find(forest, parentId);
    if (!f) return null;
    var p = f.node;
    if (isLeaf(p)) p.habit = null; // promoting a leaf to a parent drops its habit data
    p.children = p.children || [];
    p.children.push(node);
    return node;
  }

  function removeNode(forest, id) {
    var f = find(forest, id);
    if (!f) return null;
    f.list.splice(f.index, 1);
    // If a parent just lost its last child, it becomes a leaf again.
    if (f.parent && (!f.parent.children || f.parent.children.length === 0)) {
      f.parent.habit = defaultHabit();
    }
    return f.node;
  }

  // ---- Recurrence -----------------------------------------------------------
  // Is this leaf due on the given Date?
  function occursOn(node, date) {
    var h = node.habit;
    if (!h) return false;
    return (h.daysOfWeek || []).indexOf(date.getDay()) !== -1;
  }

  function isDoneOn(node, dateKey) {
    var h = node.habit;
    return !!h && (h.completedDates || []).indexOf(dateKey) !== -1;
  }

  // Check a leaf off (or un-check it) for one day. Mutates the node.
  function toggleDate(node, dateKey) {
    var h = node.habit;
    if (!h) return false;
    var list = h.completedDates || (h.completedDates = []);
    var i = list.indexOf(dateKey);
    if (i === -1) list.push(dateKey); else list.splice(i, 1);
    return i === -1; // true = now done
  }

  // Minutes-since-midnight sort key; untimed goals sort last ("anytime").
  function timeKey(node) {
    var h = node.habit;
    if (!h || !h.startTime) return 24 * 60 + 1;
    var p = h.startTime.split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  // Every leaf due on `date`, sorted by time (untimed last) then title.
  // Returns [{ node, crumb, done }] where crumb is the ancestor-title trail
  // (e.g. ['Learn Japanese']) so the Today list can show where a goal lives.
  function forDate(forest, date) {
    var key = util.ymd(date);
    var out = [];
    (function rec(list, trail) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (isLeaf(n)) {
          if (occursOn(n, date)) out.push({ node: n, crumb: trail.slice(), done: isDoneOn(n, key) });
        } else {
          rec(n.children, trail.concat([n.title]));
        }
      }
    })(forest, []);
    out.sort(function (a, b) {
      var t = timeKey(a.node) - timeKey(b.node);
      return t !== 0 ? t : String(a.node.title).localeCompare(String(b.node.title));
    });
    return out;
  }

  // Roll-up for the Today box/popup: how much is due and how much is done.
  function dayStats(forest, date) {
    var items = forDate(forest, date);
    var s = { due: items.length, done: 0, totalMin: 0, doneMin: 0, remainingMin: 0 };
    items.forEach(function (it) {
      var d = it.node.habit.durationMin || 0;
      s.totalMin += d;
      if (it.done) { s.done += 1; s.doneMin += d; }
      else s.remainingMin += d;
    });
    return s;
  }

  // Roll-up of ONE subtree for `date` — drives the parent rows' progress meta.
  function rollupToday(node, date) {
    var key = util.ymd(date);
    var acc = { due: 0, done: 0, totalMin: 0 };
    (function rec(n) {
      if (isLeaf(n)) {
        if (occursOn(n, date)) {
          acc.due += 1;
          acc.totalMin += n.habit.durationMin || 0;
          if (isDoneOn(n, key)) acc.done += 1;
        }
      } else {
        for (var i = 0; i < n.children.length; i++) rec(n.children[i]);
      }
    })(node);
    acc.percent = acc.due > 0 ? Math.round((acc.done / acc.due) * 100) : 0;
    return acc;
  }

  // Current streak of consecutive due days completed, ending at `today`.
  // Days the goal isn't due don't break the run. Today only counts once it's
  // done — an unchecked today doesn't kill a streak that's still alive.
  function streak(node, today) {
    var h = node.habit;
    if (!h || !h.daysOfWeek || !h.daysOfWeek.length) return 0;
    var count = 0;
    var d = util.startOfDay(today);
    if (occursOn(node, d)) {
      if (isDoneOn(node, util.ymd(d))) count++;
      // due today but not done yet: skip today, keep counting yesterday back
    }
    d = util.addDays(d, -1);
    for (var guard = 0; guard < 1000; guard++) {
      if (occursOn(node, d)) {
        if (!isDoneOn(node, util.ymd(d))) break;
        count++;
      }
      d = util.addDays(d, -1);
    }
    return count;
  }

  return {
    ALL_DAYS: ALL_DAYS,
    isLeaf: isLeaf,
    defaultHabit: defaultHabit,
    normalizeHabitData: normalizeHabitData,
    makeNode: makeNode,
    makeGoal: makeGoal,
    find: find,
    path: path,
    walk: walk,
    leaves: leaves,
    addChild: addChild,
    removeNode: removeNode,
    occursOn: occursOn,
    isDoneOn: isDoneOn,
    toggleDate: toggleDate,
    forDate: forDate,
    dayStats: dayStats,
    rollupToday: rollupToday,
    streak: streak
  };
});
