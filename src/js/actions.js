// Shared state mutations used by more than one panel. Centralised so the habit
// list and the Today popup behave identically.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  // Check a habit off (or un-check it) for one day ('YYYY-MM-DD').
  function toggleHabitDate(id, dateKey) {
    var st = P.store.getState();
    var h = P.model.findHabit(st.habits, id);
    if (!h) return;
    P.model.toggleDate(h, dateKey);
    P.store.commit();
  }

  P.actions = {
    toggleHabitDate: toggleHabitDate
  };
})();
