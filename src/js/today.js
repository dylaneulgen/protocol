// The Today pill + popup: a tiny always-visible click target in the title bar
// showing today's progress ("Today 2/5"). Clicking it pops up a checklist of
// everything due today — each habit with its time and how long it takes —
// checkable right there in the popup. Exposed as P.today.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var pillEl = null, popEl = null, listEl = null, headEl = null, footEl = null;
  var curYmd = null; // day the last render was for — re-render on rollover

  function mount() {
    pillEl = document.getElementById('today-pill');
    popEl = document.getElementById('today-pop');
    listEl = document.getElementById('today-list');
    headEl = document.getElementById('today-date');
    footEl = document.getElementById('today-foot');
    if (!pillEl || !popEl) return;

    pillEl.addEventListener('click', toggle);
    listEl.addEventListener('change', onChange);
    popEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    // Non-modal popup has no backdrop — close on any click outside it (clicking
    // the pill while open just toggles it closed via its own handler).
    document.addEventListener('mousedown', function (e) {
      if (!popEl.open) return;
      if (popEl.contains(e.target) || pillEl.contains(e.target)) return;
      close();
    });

    // Catch the midnight rollover so "today" never goes stale overnight.
    curYmd = P.util.ymd(new Date());
    setInterval(function () {
      var now = P.util.ymd(new Date());
      if (now !== curYmd) { curYmd = now; render(); }
    }, 30000);
  }

  function toggle() {
    if (popEl.open) { close(); return; }
    popEl.show(); // non-modal: the app stays interactive behind it
    render();
  }

  function close() { if (popEl && popEl.open) popEl.close(); }

  // ---- Render ---------------------------------------------------------------
  function render() {
    if (!pillEl) return;
    var st = P.store.getState();
    var today = new Date();
    var stats = P.model.dayStats(st.habits, today);

    // The pill: tiny, always visible, current at a glance.
    if (stats.due === 0) {
      pillEl.innerHTML = '<span class="tp-label">Today</span><span class="tp-count">—</span>';
      pillEl.classList.remove('all-done');
    } else {
      pillEl.innerHTML = '<span class="tp-label">Today</span>' +
        '<span class="tp-count">' + stats.done + '/' + stats.due + '</span>';
      pillEl.classList.toggle('all-done', stats.done === stats.due);
    }
    pillEl.title = 'What’s due today';

    if (!popEl.open) return;

    headEl.textContent = P.util.fmtDateLong(today);

    var items = P.model.forDate(st.habits, today);
    if (!items.length) {
      listEl.innerHTML = '<div class="tp-empty">Nothing due today.</div>';
      footEl.textContent = '';
      return;
    }

    listEl.innerHTML = items.map(function (it) {
      var h = it.habit;
      var t = h.startTime ? P.util.parseClock(h.startTime) : null;
      var html = '<label class="tp-item' + (it.done ? ' done' : '') + '" data-id="' + h.id + '">';
      html += '<input type="checkbox" class="done-box"' + (it.done ? ' checked' : '') + '>';
      html += '<span class="tp-titlecol"><span class="tp-title">' + esc(h.title) + '</span>';
      if (h.notes) html += '<span class="tp-notes">' + esc(h.notes) + '</span>';
      html += '</span>';
      html += '<span class="tp-when">' +
        (t ? P.util.fmtClock(t.h, t.m) : 'anytime') +
        (h.durationMin > 0 ? ' · ' + P.util.formatDuration(h.durationMin) : '') +
        '</span>';
      html += '</label>';
      return html;
    }).join('');

    // Footer roll-up: how much of the day's total time is still ahead of you.
    var bits = [stats.done + ' of ' + stats.due + ' done'];
    if (stats.totalMin > 0) {
      bits.push(stats.remainingMin > 0
        ? P.util.formatDuration(stats.remainingMin) + ' left of ' + P.util.formatDuration(stats.totalMin)
        : P.util.formatDuration(stats.totalMin) + ' — all done');
    }
    footEl.textContent = bits.join(' · ');
  }

  function onChange(e) {
    var box = e.target.closest('.done-box');
    if (!box) return;
    var item = e.target.closest('.tp-item');
    if (!item) return;
    P.actions.toggleHabitDate(item.dataset.id, P.util.ymd(new Date()));
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.today = { mount: mount, render: render, close: close };
})();
