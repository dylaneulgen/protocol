// Renderer-side state container + persistence. Holds the single `state` object,
// debounces saves to disk through the preload bridge, and notifies subscribed
// render functions when something changes.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  var state = null;
  var listeners = [];
  var saveTimer = null;
  var SAVE_DELAY = 400;
  var lastError = null;

  // ---- Undo / redo --------------------------------------------------------
  // Snapshot-based history: every discrete (non-silent) mutation records the
  // state as it was BEFORE the change, so Ctrl+Z can restore it. `lastSnapshot`
  // always holds a serialized copy of the current committed state; on the next
  // real change we push it onto the undo stack. View-only changes (switching
  // area, selection, expand/collapse) pass { noHistory:true } so they never
  // clutter the undo timeline — undo targets your data, not your view.
  var undoStack = [];
  var redoStack = [];
  var lastSnapshot = null;
  var pendingSilent = false; // mid-burst of silent (note-typing) edits
  var HISTORY_LIMIT = 80;
  function snapshot() { return JSON.stringify(state); }
  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0; // any genuine change invalidates the redo timeline
  }

  // Persistence backend. In Electron this is the secure preload bridge
  // (window.planner) that reads/writes a JSON file on disk. When the page is
  // opened in a plain browser (e.g. double-clicking index.html, or this preview),
  // there is no bridge — so we fall back to localStorage and Blob download/upload
  // so the app is still fully usable for testing.
  var IO = window.planner || browserFallback();
  function browserFallback() {
    var KEY = 'dylan-planner-data';
    return {
      load: function () {
        try {
          var raw = localStorage.getItem(KEY);
          return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) { return Promise.resolve(null); }
      },
      save: function (data) {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
        return Promise.resolve({ ok: true });
      },
      exportBackup: function (data) {
        try {
          var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = 'planner-backup.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { /* ignore */ }
        return Promise.resolve({ ok: true });
      },
      importBackup: function () {
        return new Promise(function (resolve) {
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'application/json,.json';
          inp.onchange = function () {
            var f = inp.files && inp.files[0];
            if (!f) { resolve(null); return; }
            var r = new FileReader();
            r.onload = function () { try { resolve(JSON.parse(r.result)); } catch (e) { resolve(null); } };
            r.onerror = function () { resolve(null); };
            r.readAsText(f);
          };
          inp.click();
        });
      },
      openDataFolder: function () { return Promise.resolve({ browser: true }); },
      dataPath: function () { return Promise.resolve('browser localStorage (the desktop app stores a JSON file instead)'); }
    };
  }

  function defaultState() {
    return {
      version: 3,
      goals: [],        // forest of nodes; every leaf is a recurring goal (see model.js)
      notesItems: [],   // [{ id, title, body, updatedAt }]
      ui: {
        area: 'goals',  // which sidebar section is shown: goals | notes
        selectedNoteId: null,
        notesListCollapsed: false
      }
    };
  }

  // Defensive normalisation so an old/partial/corrupt file can't crash the UI.
  // Three generations of files exist:
  //   v3 (current) — goal forest whose leaves carry `habit` data.
  //   v2 (the brief flat habit-tracker build) — a flat `habits` array whose
  //       titles embed the old goal path ("Learn Japanese · Anki"); un-flatten
  //       them by splitting on that separator so the nesting comes back.
  //   v1 (the original planner) — goal forest whose leaves carry `leaf` data of
  //       kind task/budget. The tree survives as-is; every leaf becomes a
  //       recurring goal (budgets keep their days/time/completions; one-off
  //       tasks become every-day goals — their schedule was planner material).
  function migrate(data) {
    var s = defaultState();
    if (!data || typeof data !== 'object' || data.__loadError) {
      if (data && data.__loadError) lastError = data.message || 'unknown error';
      return s;
    }

    if (Array.isArray(data.goals)) {
      s.goals = data.goals.map(normalizeNode).filter(Boolean);
    } else if (Array.isArray(data.habits)) {
      s.goals = unflattenHabits(data.habits);
    }

    if (Array.isArray(data.notesItems)) s.notesItems = data.notesItems.map(normalizeNoteItem).filter(Boolean);
    // Migrate the ancient single-journal string into one note so nothing is lost.
    if (!s.notesItems.length && typeof data.journal === 'string' && data.journal.trim()) {
      s.notesItems.push({
        id: P.util.uid('note'), title: 'Journal',
        body: data.journal, updatedAt: data.journalUpdatedAt || null
      });
    }

    if (data.ui && typeof data.ui === 'object') {
      s.ui.area = data.ui.area === 'notes' ? 'notes' : 'goals';
      if (data.ui.selectedNoteId) s.ui.selectedNoteId = data.ui.selectedNoteId;
      if (typeof data.ui.notesListCollapsed === 'boolean') s.ui.notesListCollapsed = data.ui.notesListCollapsed;
    }
    return s;
  }

  // Normalise one tree node from a v3 file — and absorb v1 nodes in the same
  // pass, since both are `{ title, children, ... }` trees: a v1 leaf has `leaf`
  // (kind task/budget) where a v3 leaf has `habit`.
  function normalizeNode(n) {
    if (!n || typeof n !== 'object') return null;
    var node = {
      id: n.id || P.util.uid('n'),
      title: typeof n.title === 'string' ? n.title : 'Untitled',
      notes: typeof n.notes === 'string' ? n.notes : '',
      collapsed: !!n.collapsed,
      children: Array.isArray(n.children) ? n.children.map(normalizeNode).filter(Boolean) : [],
      habit: null
    };
    if (node.children.length === 0) {
      node.habit = P.model.normalizeHabitData(n.habit !== undefined ? n.habit : habitFromV1Leaf(n.leaf));
    }
    return node;
  }

  // v1 leaf payload → habit payload (or null → defaults via normalizeHabitData).
  function habitFromV1Leaf(lf) {
    if (!lf || typeof lf !== 'object') return null;
    if (lf.kind === 'budget') {
      var r = lf.recurrence || {};
      return {
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        durationMin: lf.durationMin,
        completedDates: lf.completedOccurrences
      };
    }
    // One-off task: keep the goal + its length; it recurs every day now.
    return { daysOfWeek: null, startTime: null, durationMin: lf.durationMin, completedDates: null };
  }

  // v2 → v3: rebuild the tree from flat habits. The v1→v2 migration flattened
  // nested goals into "Parent · Child" titles, so split on that separator and
  // re-group; habits without it stay top-level leaves.
  function unflattenHabits(habits) {
    var SEP = ' · ';
    var roots = [];
    function childByTitle(list, title) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].title === title && list[i].children.length) return list[i];
      }
      return null;
    }
    habits.forEach(function (h) {
      if (!h || typeof h !== 'object') return;
      var segs = String(h.title || 'Untitled').split(SEP);
      var leafTitle = segs.pop();
      var leaf = {
        id: h.id || P.util.uid('n'),
        title: leafTitle,
        notes: typeof h.notes === 'string' ? h.notes : '',
        collapsed: false,
        children: [],
        habit: P.model.normalizeHabitData(h)
      };
      var list = roots;
      segs.forEach(function (seg) {
        var parent = childByTitle(list, seg);
        if (!parent) {
          parent = { id: P.util.uid('n'), title: seg, notes: '', collapsed: false, children: [], habit: null };
          // A leaf already at this level with the same title stays a separate
          // node — we only merge into grouping (parent) nodes we created.
          list.push(parent);
        }
        list = parent.children;
      });
      list.push(leaf);
    });
    return roots;
  }

  function normalizeNoteItem(n) {
    if (!n || typeof n !== 'object') return null;
    return {
      id: n.id || P.util.uid('note'),
      title: typeof n.title === 'string' ? n.title : 'Untitled',
      body: typeof n.body === 'string' ? n.body : '',
      updatedAt: n.updatedAt || null
    };
  }

  async function init() {
    var loaded = null;
    try { loaded = await IO.load(); }
    catch (e) { console.error('load failed', e); }
    state = migrate(loaded);
    lastSnapshot = snapshot();
    undoStack = [];
    redoStack = [];
    pendingSilent = false;
    return state;
  }

  function getState() { return state; }
  function getLoadError() { return lastError; }

  function subscribe(fn) { listeners.push(fn); }
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.error('render error', e); }
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      IO.save(state).then(function (res) {
        if (res && res.error) console.error('save error', res.error);
      }).catch(function (e) { console.error('save failed', e); });
    }, SAVE_DELAY);
  }

  // Call after mutating state. Options:
  //   silent      — persist but don't re-render (note typing, so the tree never
  //                 rebuilds under the cursor). A whole burst of silent edits is
  //                 coalesced into ONE undo step (the pre-burst state).
  //   noHistory   — a view-only change (area/collapse/selection) that should
  //                 re-render and persist but never appear on the undo timeline.
  //   provisional — render + persist but stay completely invisible to history
  //                 and leave the baseline untouched (throwaway placeholders).
  function commit(opts) {
    opts = opts || {};
    scheduleSave();

    if (opts.provisional) { notify(); return; }

    if (opts.silent) {
      // Record the pre-burst snapshot once, then just track the latest state so
      // per-keystroke edits collapse into a single undoable note edit.
      if (!opts.noHistory && !pendingSilent && lastSnapshot != null) {
        pushUndo(lastSnapshot);
        pendingSilent = true;
      }
      lastSnapshot = snapshot();
      return;
    }

    if (!opts.noHistory && lastSnapshot != null) pushUndo(lastSnapshot);
    pendingSilent = false; // a discrete visible action seals any typing burst
    notify();
    lastSnapshot = snapshot(); // current state becomes the baseline for next time
  }

  // Restore a serialized snapshot as the live state, persist it, and re-render.
  function applySnapshot(json) {
    var next;
    try { next = JSON.parse(json); } catch (e) { return false; }
    state = next;
    lastSnapshot = json;
    pendingSilent = false;
    IO.save(state).catch(function (e) { console.error(e); });
    notify();
    return true;
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    return applySnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    return applySnapshot(redoStack.pop());
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // Replace the entire state (e.g. after an import) and save immediately.
  // Recorded on the undo stack so an accidental import can be reverted.
  function replaceState(newData) {
    if (lastSnapshot != null) pushUndo(lastSnapshot);
    pendingSilent = false;
    state = migrate(newData);
    lastSnapshot = snapshot();
    IO.save(state).catch(function (e) { console.error(e); });
    notify();
  }

  // Flush any pending debounced save NOW, synchronously when possible. Called on
  // window unload/quit so the last edit can't be lost inside the debounce window.
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      if (window.planner && window.planner.saveSync) window.planner.saveSync(state);
      else IO.save(state);
    } catch (e) { /* ignore */ }
  }

  P.io = IO; // persistence backend (Electron bridge or browser fallback)
  P.store = {
    init: init,
    getState: getState,
    getLoadError: getLoadError,
    subscribe: subscribe,
    commit: commit,
    replaceState: replaceState,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    flush: flush,
    defaultState: defaultState
  };
})();
