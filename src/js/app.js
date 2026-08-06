// Bootstrap: load state, mount every panel, wire the header controls and global
// shortcuts. Loaded last (after all other modules have registered themselves on
// window.Planner).
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    await P.store.init();

    wireWindowControls();

    P.notes.mount();
    P.habits.mount();
    P.today.mount();
    if (P.search) P.search.mount();

    P.store.subscribe(P.notes.render);
    P.store.subscribe(P.habits.render);
    P.store.subscribe(P.today.render);

    wireSidebar();
    wireHeader();
    wireStopwatch();
    document.addEventListener('keydown', onGlobalKey);
    applyArea(P.store.getState().ui.area || 'habits');
    applyCollapse();
    renderAll();

    showLoadErrorIfAny();

    // Flush the last (debounced) edit to disk before the window closes.
    window.addEventListener('beforeunload', function () { P.store.flush(); });

    setInterval(renderStopwatch, 1000);
  }

  // Sidebar stopwatch — a standalone count-up timer (resets when the app closes).
  var swBankedMs = 0, swStartedAt = 0;

  function swElapsed() {
    return swBankedMs + (swStartedAt ? Date.now() - swStartedAt : 0);
  }

  function renderStopwatch() {
    var t = document.getElementById('sw-time');
    if (t) t.textContent = P.util.fmtElapsed(swElapsed());
    var btn = document.getElementById('sw-toggle');
    if (btn) btn.textContent = swStartedAt ? 'Pause' : 'Start';
  }

  function wireStopwatch() {
    var toggle = document.getElementById('sw-toggle');
    var reset = document.getElementById('sw-reset');
    if (toggle) toggle.addEventListener('click', function () {
      if (swStartedAt) { swBankedMs += Date.now() - swStartedAt; swStartedAt = 0; }
      else swStartedAt = Date.now();
      renderStopwatch();
    });
    if (reset) reset.addEventListener('click', function () {
      swStartedAt = 0; swBankedMs = 0;
      renderStopwatch();
    });
    renderStopwatch();
  }

  function renderAll() {
    P.notes.render();
    P.habits.render();
    P.today.render();
  }

  // ---- Global keyboard shortcuts -------------------------------------------
  function onGlobalKey(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = (e.key || '').toLowerCase();

    // Ctrl+F / Ctrl+K — open the page search. Bail if any dialog is already open
    // (don't stack over the habit editor, and don't wipe an in-progress query
    // when search itself is the open dialog).
    if (key === 'f' || key === 'k') {
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (P.search) P.search.open();
      return;
    }

    // Undo / redo. Skip while the user is editing a text field (so the native
    // input/textarea undo keeps working) or while a modal dialog is open (so we
    // never rewrite the list out from under an open editor).
    if (key === 'z' || key === 'y') {
      if (isTextTarget(e.target) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        toast(P.store.redo() ? 'Redo' : 'Nothing to redo');
      } else {
        toast(P.store.undo() ? 'Undo' : 'Nothing to undo');
      }
    }
  }

  function isTextTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  // ---- Transient toast (undo/redo feedback) --------------------------------
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    // force reflow so the transition runs even on rapid repeats
    void el.offsetWidth;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (!el.classList.contains('show')) el.hidden = true; }, 240);
    }, 1100);
  }

  // Custom title-bar window buttons. Only active in the desktop app (window.win);
  // in a browser the buttons are hidden via the .is-electron body class.
  function wireWindowControls() {
    var isElectron = !!window.win;
    document.body.classList.toggle('is-electron', isElectron);
    // macOS shows native traffic lights instead of our custom window buttons.
    document.body.classList.toggle('is-mac', isElectron && window.win.platform === 'darwin');

    var maxBtn = document.querySelector('.tb-btn[data-win="max"]');
    document.querySelectorAll('.tb-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.win) return;
        var act = btn.dataset.win;
        if (act === 'min') window.win.minimize();
        else if (act === 'max') window.win.toggleMaximize();
        else if (act === 'close') window.win.close();
      });
    });

    // Double-clicking the draggable strip maximizes/restores (Windows convention).
    var dragStrip = document.querySelector('.tb-drag');
    if (dragStrip) dragStrip.addEventListener('dblclick', function () { if (window.win) window.win.toggleMaximize(); });

    // Swap the maximize glyph between "maximize" and "restore".
    if (isElectron && window.win.onMaximizeChange && maxBtn) {
      window.win.onMaximizeChange(function (isMax) {
        maxBtn.innerHTML = isMax ? '&#xE923;' : '&#xE922;'; // restore : maximize (Segoe MDL2)
        maxBtn.title = isMax ? 'Restore' : 'Maximize';
      });
    }
  }

  // The one sidebar: each item swaps the single main view.
  function wireSidebar() {
    Array.prototype.forEach.call(document.querySelectorAll('.side-item'), function (btn) {
      btn.addEventListener('click', function () { setArea(btn.dataset.viewArea); });
    });
  }

  function setArea(area) {
    var st = P.store.getState();
    st.ui.area = area;
    applyArea(area);                      // reveal the target area BEFORE committing
    P.store.commit({ noHistory: true });  // so a now-visible panel re-renders
  }

  function applyArea(area) {
    Array.prototype.forEach.call(document.querySelectorAll('.side-item'), function (b) {
      b.classList.toggle('active', b.dataset.viewArea === area);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.area'), function (s) {
      s.classList.toggle('active', s.dataset.area === area);
    });
    // Swap the contextual controls shown in the custom title bar.
    Array.prototype.forEach.call(document.querySelectorAll('.tbc'), function (c) {
      c.classList.toggle('active', c.dataset.tbc === area);
    });
  }

  function wireHeader() {
    // Collapse toggle: the notes list
    document.getElementById('btn-toggle-noteslist').addEventListener('click', function () {
      var ui = P.store.getState().ui;
      ui.notesListCollapsed = !ui.notesListCollapsed;
      applyCollapse();
      P.store.commit({ noHistory: true });
    });
  }

  // Show/hide the notes list, and reflect state on the toggle.
  function applyCollapse() {
    var ui = P.store.getState().ui;
    var notesSplit = document.querySelector('.notes-split');
    if (notesSplit) notesSplit.classList.toggle('no-list', !!ui.notesListCollapsed);
    var nt = document.getElementById('btn-toggle-noteslist');
    if (nt) { nt.textContent = ui.notesListCollapsed ? '›' : '‹'; nt.title = ui.notesListCollapsed ? 'Show list' : 'Collapse'; }
  }

  function showLoadErrorIfAny() {
    var msg = P.store.getLoadError && P.store.getLoadError();
    if (!msg) return;
    var banner = document.getElementById('error-banner');
    if (!banner) return;
    banner.textContent = 'Could not read your saved data (' + msg +
      '). Starting empty — your previous file and its .bak backup were left untouched.';
    banner.hidden = false;
  }

  // Small surface other modules use to drive the shell (search navigates here).
  P.app = { setArea: setArea, toast: toast };
})();
