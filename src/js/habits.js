// The Habits panel: one card per habit showing its schedule (days · time ·
// length), current streak, a mini grid of the last 14 days, and a quick
// "done today" checkbox when the habit is due today. A modal <dialog> creates
// and edits habits. Exposed as P.habits.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var listEl = null;
  var dlg = null;
  var editingId = null; // null = the dialog is creating a new habit

  var HISTORY_DAYS = 14;

  // ---- Mount ----------------------------------------------------------------
  function mount() {
    listEl = document.getElementById('habit-list');
    dlg = document.getElementById('habit-dialog');

    document.getElementById('btn-add-habit').addEventListener('click', function () { openEditor(null); });
    listEl.addEventListener('click', onListClick);
    listEl.addEventListener('change', onListChange);

    wireDialog();
  }

  // ---- Render ---------------------------------------------------------------
  function render() {
    if (!listEl) return;
    var st = P.store.getState();
    if (!st.habits.length) {
      listEl.innerHTML = '<div class="empty-hint big">No habits yet.<br>' +
        'Use “+ Add habit” to define one — what it is, which days, what time, and how long.</div>';
      return;
    }
    var today = new Date();
    listEl.innerHTML = st.habits.map(function (h) { return cardHtml(h, today); }).join('');
  }

  function cardHtml(h, today) {
    var todayKey = P.util.ymd(today);
    var dueToday = P.model.occursOn(h, today);
    var doneToday = dueToday && P.model.isDoneOn(h, todayKey);
    var run = P.model.streak(h, today);

    var html = '<div class="habit-card' + (doneToday ? ' done-today' : '') + '" data-id="' + h.id + '">';

    // lead: today's checkbox (only when the habit is due today)
    html += '<span class="hc-lead">';
    if (dueToday) {
      html += '<input type="checkbox" class="done-box" data-action="done" title="Done today"' +
        (doneToday ? ' checked' : '') + '>';
    }
    html += '</span>';

    html += '<div class="hc-main">';
    html += '<div class="hc-title-row"><span class="hc-title">' + esc(h.title) + '</span>';
    html += '<span class="hc-meta">' + metaChips(h, run) + '</span></div>';
    if (h.notes) html += '<div class="hc-notes">' + esc(h.notes) + '</div>';
    html += '<div class="hc-grid" aria-label="Last ' + HISTORY_DAYS + ' days">' + gridHtml(h, today) + '</div>';
    html += '</div>';

    html += '<span class="hc-actions">' +
      '<button data-action="edit">Edit</button>' +
      '<button data-action="delete">Delete</button>' +
      '</span>';

    html += '</div>';
    return html;
  }

  function metaChips(h, run) {
    var parts = ['<span class="chip">' + daysLabel(h.daysOfWeek) + '</span>'];
    if (h.startTime) {
      var t = P.util.parseClock(h.startTime);
      if (t) parts.push('<span class="chip dur">' + P.util.fmtClock(t.h, t.m) + '</span>');
    }
    if (h.durationMin > 0) parts.push('<span class="chip dur">' + P.util.formatDuration(h.durationMin) + '</span>');
    if (run > 0) parts.push('<span class="chip streak">' + run + '-day streak</span>');
    return parts.join(' ');
  }

  function gridHtml(h, today) {
    return P.model.history(h, today, HISTORY_DAYS).map(function (d) {
      var cls = 'hg-day';
      if (!d.due) cls += ' off';
      else if (d.done) cls += ' done';
      if (d.date === P.util.ymd(today)) cls += ' today';
      return '<span class="' + cls + '" title="' + d.date +
        (d.due ? (d.done ? ' — done' : ' — missed') : '') + '"></span>';
    }).join('');
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
  function habitIdOf(el) {
    var card = el.closest('.habit-card');
    return card ? card.dataset.id : null;
  }

  function onListClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = habitIdOf(btn);
    if (!id) return;
    var action = btn.dataset.action;
    if (action === 'edit') openEditor(id);
    else if (action === 'delete') deleteHabit(id);
    // 'done' is a checkbox — handled in onListChange
  }

  function onListChange(e) {
    var box = e.target.closest('[data-action="done"]');
    if (!box) return;
    var id = habitIdOf(box);
    if (id) P.actions.toggleHabitDate(id, P.util.ymd(new Date()));
  }

  function deleteHabit(id) {
    var st = P.store.getState();
    var h = P.model.findHabit(st.habits, id);
    if (!h) return;
    if (!window.confirm('Delete "' + h.title + '" and its history?')) return;
    var i = st.habits.indexOf(h);
    st.habits.splice(i, 1);
    P.store.commit();
  }

  // ---- Editor dialog --------------------------------------------------------
  function wireDialog() {
    // Day-of-week toggle buttons
    var dowWrap = document.getElementById('hb-dow');
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (lbl, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dow-btn';
      b.dataset.dow = String(i);
      b.textContent = lbl;
      b.addEventListener('click', function () { b.classList.toggle('on'); });
      dowWrap.appendChild(b);
    });

    document.getElementById('hb-cancel').addEventListener('click', closeEditor);
    document.getElementById('habit-form').addEventListener('submit', onSubmit);
    // Handle dismissal directly (Cancel button + Escape). We intentionally do NOT
    // rely on the dialog 'close' event — it doesn't fire reliably across engines.
    dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeEditor(); });

    // Live duration validation hint
    document.getElementById('hb-duration').addEventListener('input', function () {
      var v = P.util.parseDuration(this.value);
      var hint = document.getElementById('hb-duration-hint');
      hint.textContent = v == null ? '' : P.util.formatDuration(v);
      hint.classList.toggle('bad', this.value.trim() !== '' && v == null);
    });

    // Time is free text: type anything ("900am", "9", "1830") and on blur it
    // normalises to a friendly "9:00 AM". Unreadable input is left as typed.
    var timeInp = document.getElementById('hb-time');
    timeInp.addEventListener('blur', function () {
      var t = P.util.parseClock(timeInp.value);
      if (t) timeInp.value = P.util.fmtClock(t.h, t.m);
    });
    timeInp.addEventListener('input', function () {
      document.getElementById('hb-time-hint').classList.remove('bad');
      document.getElementById('hb-time-hint').textContent = '';
    });
  }

  // Open the dialog. `id` = edit that habit; null = create a new one.
  function openEditor(id) {
    var st = P.store.getState();
    var h = id ? P.model.findHabit(st.habits, id) : null;
    editingId = h ? id : null;

    document.getElementById('habit-dialog-title').textContent = h ? 'Edit habit' : 'New habit';
    document.getElementById('hb-title').value = h ? h.title : '';
    document.getElementById('hb-notes').value = h ? h.notes : '';
    document.getElementById('hb-duration').value = (h && h.durationMin > 0) ? P.util.formatDuration(h.durationMin) : '';
    var durHint = document.getElementById('hb-duration-hint');
    durHint.textContent = '';
    durHint.classList.remove('bad');
    var timeHint = document.getElementById('hb-time-hint');
    timeHint.textContent = '';
    timeHint.classList.remove('bad');

    var t = h && h.startTime ? P.util.parseClock(h.startTime) : null;
    document.getElementById('hb-time').value = t ? P.util.fmtClock(t.h, t.m) : '';

    var days = h ? h.daysOfWeek : P.model.ALL_DAYS;
    Array.prototype.forEach.call(document.querySelectorAll('#hb-dow .dow-btn'), function (b) {
      b.classList.toggle('on', days.indexOf(parseInt(b.dataset.dow, 10)) !== -1);
    });

    dlg.showModal();
    document.getElementById('hb-title').focus();
  }

  function closeEditor() {
    editingId = null;
    if (dlg.open) dlg.close();
  }

  function onSubmit(e) {
    e.preventDefault();
    var st = P.store.getState();

    // Duration is optional. Empty = no set length. If something IS typed, it
    // still has to be a duration we understand, so a typo doesn't save as 0.
    var durRaw = document.getElementById('hb-duration').value.trim();
    var durMin = 0;
    if (durRaw !== '') {
      var parsed = P.util.parseDuration(durRaw);
      if (parsed == null || parsed < 0) {
        var hint = document.getElementById('hb-duration-hint');
        hint.textContent = 'Not a valid duration';
        hint.classList.add('bad');
        document.getElementById('hb-duration').focus();
        return;
      }
      durMin = parsed;
    }

    // Time is optional too ("anytime"), but typed text must be readable.
    var timeRaw = document.getElementById('hb-time').value.trim();
    var startTime = null;
    if (timeRaw !== '') {
      var t = P.util.parseClock(timeRaw);
      if (!t) {
        var th = document.getElementById('hb-time-hint');
        th.textContent = 'Not a valid time';
        th.classList.add('bad');
        document.getElementById('hb-time').focus();
        return;
      }
      startTime = P.util.pad(t.h) + ':' + P.util.pad(t.m);
    }

    var days = [];
    Array.prototype.forEach.call(document.querySelectorAll('#hb-dow .dow-btn.on'), function (b) {
      days.push(parseInt(b.dataset.dow, 10));
    });
    days.sort(function (a, b) { return a - b; });

    var h = editingId ? P.model.findHabit(st.habits, editingId) : null;
    if (!h) {
      h = P.model.makeHabit('');
      st.habits.push(h);
    }
    h.title = document.getElementById('hb-title').value.trim() || 'Untitled';
    h.notes = document.getElementById('hb-notes').value;
    h.daysOfWeek = days.length ? days : P.model.ALL_DAYS.slice();
    h.startTime = startTime;
    h.durationMin = durMin;

    closeEditor();
    P.store.commit();
  }

  // Reveal a habit from elsewhere (global search): scroll its card into view and
  // briefly flash it.
  function reveal(id) {
    var card = listEl && listEl.querySelector('.habit-card[data-id="' + id + '"]');
    if (!card) return;
    card.scrollIntoView({ block: 'center' });
    card.classList.add('flash');
    setTimeout(function () { card.classList.remove('flash'); }, 1100);
  }

  // ---- util -----------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.habits = { mount: mount, render: render, reveal: reveal, daysLabel: daysLabel };
})();
