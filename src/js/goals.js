// The Goals panel: a collapsible outline of the goal forest — the same outline
// UI the planner had, but every leaf is a recurring goal now. Parents show a
// live "done today" roll-up; leaves carry the schedule (days · time · length)
// and a checkbox for today when they're due. A modal <dialog> edits leaf
// details (days, time, duration, notes).
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var treeEl = null;
  var dlg = null;
  var goalDlg = null;
  var editingId = null;
  // Selection is a list (in click order); the LAST id is the "primary" — the one
  // whose details/actions show and the target for paste. Plain click = single
  // select; Shift+click toggles a node in/out of the set (multi-select).
  var selectedIds = [];
  var clipboard = [];        // copied goal subtrees (deep clones), pasted with fresh ids

  function primaryId() { return selectedIds.length ? selectedIds[selectedIds.length - 1] : null; }
  function isSelected(id) { return selectedIds.indexOf(id) !== -1; }

  // ---- Mount ----------------------------------------------------------------
  function mount() {
    treeEl = document.getElementById('goal-tree');
    dlg = document.getElementById('goal-editor');
    goalDlg = document.getElementById('goal-dialog');

    document.getElementById('btn-add-goal').addEventListener('click', addGoal);
    document.getElementById('goal-cancel').addEventListener('click', function () { goalDlg.close(); });
    document.getElementById('goal-form').addEventListener('submit', onGoalCreate);

    treeEl.addEventListener('click', onClick);
    treeEl.addEventListener('dblclick', onDblClick);
    treeEl.addEventListener('change', onChange);

    wireDialog();
  }

  // ---- Render ---------------------------------------------------------------
  function render() {
    if (!treeEl) return;
    var state = P.store.getState();
    if (!state.goals.length) {
      treeEl.innerHTML = '<div class="empty-hint big">No goals yet.<br>' +
        'Use “+ Add goal”, then “Add” on its row to nest subgoals under it.</div>';
      return;
    }
    var today = new Date();
    // Each top-level goal is its own separated card; its subtree renders as a tree.
    treeEl.innerHTML = state.goals.map(function (n) {
      return '<div class="goal-card">' + nodeHtml(n, 0, today) + '</div>';
    }).join('');
  }

  function nodeHtml(n, depth, today) {
    var leaf = P.model.isLeaf(n);
    var selCls = isSelected(n.id) ? ' selected' : '';
    if (n.id === primaryId()) selCls += ' primary-sel';
    var html = '<div class="node" data-id="' + n.id + '">';
    html += '<div class="node-row ' + (leaf ? 'is-leaf' : 'is-parent') +
      (depth === 0 ? ' goal-header' : '') + selCls + rowMods(n, today) + '">';

    // lead slot: caret for parents; today's done checkbox for leaves that are due
    if (!leaf) {
      html += '<button class="caret" data-action="toggle" title="Expand / collapse">' +
        (n.collapsed ? '▸' : '▾') + '</button>';
    } else if (P.model.occursOn(n, today)) {
      html += '<span class="leadslot"><input type="checkbox" class="done-box" data-action="done" title="Done today"' +
        (P.model.isDoneOn(n, P.util.ymd(today)) ? ' checked' : '') + '></span>';
    } else {
      html += '<span class="leadslot offday" title="Not due today">·</span>';
    }

    // title
    html += '<span class="title">' + esc(n.title) + '</span>';

    // meta + actions — leaves reveal theirs when selected (see CSS)
    html += '<span class="meta">' + metaHtml(n, leaf, today) + '</span>';
    html += '<span class="row-actions">';
    html += '<button data-action="add-sub">Add</button>';
    if (leaf) html += '<button data-action="details">Edit</button>';
    html += '<button data-action="delete">Delete</button>';
    html += '</span>';

    html += '</div>'; // .node-row

    if (!leaf && !n.collapsed) {
      html += '<div class="children">' +
        n.children.map(function (c) { return nodeHtml(c, depth + 1, today); }).join('') +
        '</div>';
    }
    html += '</div>'; // .node
    return html;
  }

  function rowMods(n, today) {
    if (!P.model.isLeaf(n)) return '';
    var m = '';
    if (P.model.isDoneOn(n, P.util.ymd(today))) m += ' done';
    if (!P.model.occursOn(n, today)) m += ' offday';
    return m;
  }

  function metaHtml(n, leaf, today) {
    if (!leaf) {
      // Parents always show today's roll-up: n/m done + total time due today.
      var r = P.model.rollupToday(n, today);
      var parts = [];
      if (r.totalMin > 0) parts.push('<span class="chip total">' + P.util.formatDuration(r.totalMin) + '/day</span>');
      if (r.due > 0) {
        parts.push('<span class="progress"><span class="progress-fill" style="width:' + r.percent + '%"></span></span>' +
          '<span class="pct">' + r.done + '/' + r.due + '</span>');
      }
      return parts.join(' ');
    }

    var h = n.habit;
    var out = [];
    if (h.daysOfWeek.length < 7) out.push('<span class="chip rec">' + daysLabel(h.daysOfWeek) + '</span>');
    if (h.startTime) {
      var t = P.util.parseClock(h.startTime);
      if (t) out.push('<span class="chip when">' + P.util.fmtClock(t.h, t.m) + '</span>');
    }
    if (h.durationMin > 0) out.push('<span class="chip dur">' + P.util.formatDuration(h.durationMin) + '</span>');
    var run = P.model.streak(n, today);
    if (run > 0) out.push('<span class="chip streak">' + run + '-day streak</span>');
    return out.join(' ');
  }

  function daysLabel(days) {
    var d = (days || []).slice().sort(function (a, b) { return a - b; });
    if (sameSet(d, [1, 2, 3, 4, 5])) return 'Mon–Fri';
    if (sameSet(d, [0, 6])) return 'Sat–Sun';
    if (d.length === 7) return 'Every day';
    if (!d.length) return 'No days';
    return d.map(function (i) { return P.util.DOW[i]; }).join(' ');
  }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---- Events ---------------------------------------------------------------
  function nodeIdOf(el) {
    var node = el.closest('.node');
    return node ? node.dataset.id : null;
  }

  function onClick(e) {
    var btn = e.target.closest('[data-action]');
    if (btn) {
      var action = btn.dataset.action;
      var id = nodeIdOf(btn);
      if (!id) return;
      var st = P.store.getState();
      if (action === 'toggle') {
        var f = P.model.find(st.goals, id);
        if (f) { f.node.collapsed = !f.node.collapsed; P.store.commit({ noHistory: true }); }
      } else if (action === 'add-sub') {
        var f2 = P.model.find(st.goals, id);
        var parent = f2 ? f2.node : null;
        // Breaking a goal into subgoals: carry its existing habit config
        // (schedule, streak history) into the first subgoal instead of losing it.
        var carry = null;
        if (parent && P.model.isLeaf(parent) && parent.habit) {
          var ph = parent.habit;
          if (ph.startTime || (ph.durationMin || 0) > 0 ||
            (ph.completedDates || []).length || ph.daysOfWeek.length < 7) {
            carry = ph;
          }
        }
        var child = P.model.makeNode('New goal', carry || P.model.defaultHabit());
        if (parent) parent.collapsed = false;
        P.model.addChild(st.goals, id, child); // clears parent.habit
        selectedIds = [child.id];
        P.store.commit();
        startRename(child.id); // immediately let the user name it
      } else if (action === 'delete') {
        deleteNode(id);
      } else if (action === 'details') {
        openEditor(id);
      }
      return; // 'done' handled in onChange
    }
    // Clicking a row (not an action) selects it — that's when its details appear.
    var row = e.target.closest('.node-row');
    if (row) {
      var rid = nodeIdOf(row);
      if (rid) selectNode(rid, e.shiftKey);
    }
  }

  // Update selection. Plain click selects just this row (clicking the only
  // selected row again clears it). Shift+click toggles this row in/out of the
  // selection so several goals can be picked at once (for copy/paste).
  function selectNode(id, additive) {
    if (additive) {
      var i = selectedIds.indexOf(id);
      if (i === -1) selectedIds.push(id); else selectedIds.splice(i, 1);
    } else if (selectedIds.length === 1 && selectedIds[0] === id) {
      selectedIds = [];
    } else {
      selectedIds = [id];
    }
    applySelectionClasses();
  }

  // Reflect selectedIds onto the DOM without a full re-render: every selected row
  // gets `.selected`; the primary (last-clicked) also gets `.primary-sel`, which
  // is what reveals its details/actions row.
  function applySelectionClasses() {
    if (!treeEl) return;
    Array.prototype.forEach.call(treeEl.querySelectorAll('.node-row.selected, .node-row.primary-sel'), function (r) {
      r.classList.remove('selected', 'primary-sel');
    });
    selectedIds.forEach(function (id) {
      var row = rowOf(id);
      if (row) row.classList.add('selected');
    });
    var pid = primaryId();
    if (pid) { var pr = rowOf(pid); if (pr) pr.classList.add('primary-sel'); }
  }

  function rowOf(id) {
    var node = treeEl.querySelector('.node[data-id="' + id + '"]');
    return node ? node.querySelector('.node-row') : null;
  }

  function onChange(e) {
    var box = e.target.closest('[data-action="done"]');
    if (!box) return;
    var id = nodeIdOf(box);
    if (id) P.actions.toggleGoalDate(id, P.util.ymd(new Date()));
  }

  function onDblClick(e) {
    var title = e.target.closest('.title');
    if (!title) return;
    var id = nodeIdOf(title);
    if (id) editTitleInline(title, id);
  }

  function deleteNode(id) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f) return;
    var hasKids = f.node.children && f.node.children.length;
    var msg = hasKids ? 'Delete "' + f.node.title + '" and everything inside it?'
      : 'Delete "' + f.node.title + '"?';
    if (!window.confirm(msg)) return;
    P.model.removeNode(st.goals, id);
    P.store.commit();
  }

  // "+ Add goal" opens a small dialog to name the goal first.
  function addGoal() {
    var nameInput = document.getElementById('goal-name');
    nameInput.value = '';
    nameInput.placeholder = 'Name your goal';
    goalDlg.showModal();
    nameInput.focus();
  }
  function onGoalCreate(e) {
    e.preventDefault();
    var st = P.store.getState();
    var name = document.getElementById('goal-name').value.trim();
    var g = P.model.makeGoal(name || 'Untitled');
    st.goals.push(g);
    selectedIds = [g.id];
    goalDlg.close();
    P.store.commit();
  }

  // The one in-progress inline rename's finish() (or null). Tracked so we never
  // have two rename inputs alive at once — that race is what made the caret vanish
  // and could crash the app (see editTitleInline).
  var activeRename = null;

  // Find a node's title in the DOM and start renaming it.
  function startRename(id) {
    var span = treeEl.querySelector('.node[data-id="' + id + '"] .title');
    if (span) editTitleInline(span, id);
  }

  // Inline rename using a real text input — shows a caret and is reliable across
  // engines (the old contentEditable approach hid the cursor).
  //
  // Robustness: a rename's blur handler commits and re-renders the whole tree. If
  // that fired synchronously while another render was running (or while focus was
  // moving to a second rename input), it would detach the live input mid-operation
  // — the caret never appeared and the app could crash. So: (1) only one rename is
  // ever active — starting a new one cleanly finishes the previous and re-finds the
  // freshly rendered node, and (2) the blur-save is deferred a tick so it can never
  // re-enter render() synchronously. Enter/Escape still finish immediately.
  function editTitleInline(span, id) {
    if (activeRename) activeRename(true); // commit any rename already in progress
    // The previous finish re-rendered the tree, so re-find the live title element.
    span = (treeEl && treeEl.querySelector('.node[data-id="' + id + '"] .title')) || span;
    if (!span || !span.isConnected) return;

    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'title-input';
    input.value = f.node.title;
    span.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      if (activeRename === finish) activeRename = null;
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKey);
      var val = input.value.trim() || 'Untitled';
      if (save && f.node && f.node.title !== val) {
        f.node.title = val;
        P.store.commit(); // re-render swaps the input back to a normal row
      } else {
        render();         // no change / cancelled — just restore the row
      }
    }
    activeRename = finish;

    // Defer the blur-save so a blur caused by a re-render detaching this input
    // can't re-enter commit()/render() synchronously inside that render.
    function onBlur() { if (!done) setTimeout(function () { finish(true); }, 0); }
    function onKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    }
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKey);
  }

  // ---- Leaf editor dialog ---------------------------------------------------
  function wireDialog() {
    // Day-of-week toggle buttons. Every goal recurs — these only let you
    // EXCLUDE a day or two; there is no "not recurring" option.
    var dowWrap = document.getElementById('gl-dow');
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (lbl, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dow-btn';
      b.dataset.dow = String(i);
      b.textContent = lbl;
      b.addEventListener('click', function () { b.classList.toggle('on'); });
      dowWrap.appendChild(b);
    });

    document.getElementById('gl-cancel').addEventListener('click', closeEditor);
    document.getElementById('goal-editor-form').addEventListener('submit', onEditorSubmit);
    // Handle dismissal directly (Cancel button + Escape). We intentionally do NOT
    // rely on the dialog 'close' event — it doesn't fire reliably across engines.
    dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeEditor(); });

    // Live duration validation hint
    document.getElementById('gl-duration').addEventListener('input', function () {
      var v = P.util.parseDuration(this.value);
      var hint = document.getElementById('gl-duration-hint');
      hint.textContent = v == null ? '' : P.util.formatDuration(v);
      hint.classList.toggle('bad', this.value.trim() !== '' && v == null);
    });

    // Time is free text: type anything ("900am", "9", "1830") and on blur it
    // normalises to a friendly "9:00 AM". Unreadable input is left as typed.
    var timeInp = document.getElementById('gl-time');
    timeInp.addEventListener('blur', function () {
      var t = P.util.parseClock(timeInp.value);
      if (t) timeInp.value = P.util.fmtClock(t.h, t.m);
    });
    timeInp.addEventListener('input', function () {
      var th = document.getElementById('gl-time-hint');
      th.textContent = '';
      th.classList.remove('bad');
    });
  }

  function openEditor(id) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f || !P.model.isLeaf(f.node)) return;
    editingId = id;
    var n = f.node, h = n.habit;

    document.getElementById('gl-title').value = n.title;
    document.getElementById('gl-notes').value = n.notes || '';
    document.getElementById('gl-duration').value = h.durationMin > 0 ? P.util.formatDuration(h.durationMin) : '';
    var durHint = document.getElementById('gl-duration-hint');
    durHint.textContent = '';
    durHint.classList.remove('bad');
    var timeHint = document.getElementById('gl-time-hint');
    timeHint.textContent = '';
    timeHint.classList.remove('bad');

    var t = h.startTime ? P.util.parseClock(h.startTime) : null;
    document.getElementById('gl-time').value = t ? P.util.fmtClock(t.h, t.m) : '';

    Array.prototype.forEach.call(document.querySelectorAll('#gl-dow .dow-btn'), function (b) {
      b.classList.toggle('on', h.daysOfWeek.indexOf(parseInt(b.dataset.dow, 10)) !== -1);
    });

    dlg.showModal();
    document.getElementById('gl-title').focus();
  }

  function closeEditor() {
    editingId = null;
    if (dlg.open) dlg.close();
  }

  function onEditorSubmit(e) {
    e.preventDefault();
    var st = P.store.getState();
    var f = P.model.find(st.goals, editingId);
    if (!f || !P.model.isLeaf(f.node)) { closeEditor(); return; }
    var n = f.node;

    // Duration is optional. Empty = no set length. If something IS typed, it
    // still has to be a duration we understand, so a typo doesn't save as 0.
    var durRaw = document.getElementById('gl-duration').value.trim();
    var durMin = 0;
    if (durRaw !== '') {
      var parsed = P.util.parseDuration(durRaw);
      if (parsed == null || parsed < 0) {
        var hint = document.getElementById('gl-duration-hint');
        hint.textContent = 'Not a valid duration';
        hint.classList.add('bad');
        document.getElementById('gl-duration').focus();
        return;
      }
      durMin = parsed;
    }

    // Time is optional too ("anytime"), but typed text must be readable.
    var timeRaw = document.getElementById('gl-time').value.trim();
    var startTime = null;
    if (timeRaw !== '') {
      var t = P.util.parseClock(timeRaw);
      if (!t) {
        var th = document.getElementById('gl-time-hint');
        th.textContent = 'Not a valid time';
        th.classList.add('bad');
        document.getElementById('gl-time').focus();
        return;
      }
      startTime = P.util.pad(t.h) + ':' + P.util.pad(t.m);
    }

    var days = [];
    Array.prototype.forEach.call(document.querySelectorAll('#gl-dow .dow-btn.on'), function (b) {
      days.push(parseInt(b.dataset.dow, 10));
    });
    days.sort(function (a, b) { return a - b; });

    n.title = document.getElementById('gl-title').value.trim() || 'Untitled';
    n.notes = document.getElementById('gl-notes').value;
    n.habit.daysOfWeek = days.length ? days : P.model.ALL_DAYS.slice();
    n.habit.startTime = startTime;
    n.habit.durationMin = durMin;

    closeEditor();
    P.store.commit();
  }

  // Reveal a node from elsewhere (e.g. global search): expand its ancestors so
  // it's visible, select it, scroll it into view, and briefly flash it.
  function reveal(id) {
    var st = P.store.getState();
    if (!P.model.find(st.goals, id)) return;
    P.model.path(st.goals, id).forEach(function (n) {
      if (n.children && n.children.length) n.collapsed = false;
    });
    selectedIds = [id];
    P.store.commit({ noHistory: true }); // re-renders the (now expanded) tree
    var node = treeEl && treeEl.querySelector('.node[data-id="' + id + '"]');
    if (node) {
      node.scrollIntoView({ block: 'center' });
      var row = node.querySelector('.node-row');
      if (row) {
        row.classList.add('flash');
        setTimeout(function () { row.classList.remove('flash'); }, 1100);
      }
    }
  }

  // ---- Copy / paste (Ctrl+C / Ctrl+V) ---------------------------------------
  // Copy the current selection (one or more goals/subtrees) onto an internal
  // clipboard. If both an ancestor and one of its descendants are selected, the
  // descendant is dropped — it's already included inside the ancestor's copy, so
  // keeping it would paste a duplicate. Returns true if anything was copied.
  function copySelection() {
    var st = P.store.getState();
    var ids = selectedIds.filter(function (id) { return !!P.model.find(st.goals, id); });
    var roots = ids.filter(function (id) {
      return !ids.some(function (other) { return other !== id && isAncestorOf(st.goals, other, id); });
    });
    if (!roots.length) return false;
    clipboard = roots.map(function (id) {
      return JSON.parse(JSON.stringify(P.model.find(st.goals, id).node));
    });
    if (P.app && P.app.toast) P.app.toast('Copied ' + clipboard.length + ' goal' + (clipboard.length === 1 ? '' : 's'));
    return true;
  }

  // Paste the clipboard under the primary (last-selected) node: as children when
  // it's a parent goal, or as siblings right after it when it's a leaf (so a
  // leaf's own habit data is never clobbered). With nothing selected, paste as
  // new top-level goals. Every pasted node gets brand-new ids. Returns true on paste.
  function pasteClipboard() {
    if (!clipboard.length) return false;
    var st = P.store.getState();
    var fresh = clipboard.map(function (orig) { return freshIds(JSON.parse(JSON.stringify(orig))); });
    var pid = primaryId();
    var target = pid ? P.model.find(st.goals, pid) : null;

    if (target && !P.model.isLeaf(target.node)) {
      target.node.collapsed = false;
      fresh.forEach(function (nn) { P.model.addChild(st.goals, pid, nn); });
    } else if (target) {
      Array.prototype.splice.apply(target.list, [target.index + 1, 0].concat(fresh));
    } else {
      fresh.forEach(function (nn) { st.goals.push(nn); });
    }

    selectedIds = fresh.map(function (nn) { return nn.id; });
    P.store.commit();
    if (P.app && P.app.toast) P.app.toast('Pasted ' + fresh.length + ' goal' + (fresh.length === 1 ? '' : 's'));
    return true;
  }

  // Is `ancestorId` a strict ancestor of `id`? (Both ids exist in the forest.)
  function isAncestorOf(forest, ancestorId, id) {
    if (ancestorId === id) return false;
    return P.model.path(forest, id).some(function (n) { return n.id === ancestorId; });
  }

  // Recursively stamp a cloned subtree with new ids so a paste never collides
  // with the originals (or with an earlier paste of the same clipboard). A paste
  // is a FRESH instance: it keeps the plan (titles, days, times, durations) but
  // clears the per-day history, so a copy never inherits the original's streak.
  function freshIds(node) {
    node.id = P.util.uid('n');
    if (node.habit) node.habit.completedDates = [];
    if (node.children && node.children.length) node.children.forEach(freshIds);
    return node;
  }

  // ---- util -----------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.goals = {
    mount: mount, render: render, reveal: reveal, daysLabel: daysLabel,
    copySelection: copySelection, pasteClipboard: pasteClipboard
  };
})();
