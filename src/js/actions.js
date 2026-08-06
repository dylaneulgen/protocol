// Shared state mutations used by more than one panel. Centralised so the goal
// tree and the Today popup behave identically.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  // Check a leaf goal off (or un-check it) for one day ('YYYY-MM-DD').
  function toggleGoalDate(id, dateKey) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f || !P.model.isLeaf(f.node)) return;
    P.model.toggleDate(f.node, dateKey);
    P.store.commit();
  }

  P.actions = {
    toggleGoalDate: toggleGoalDate
  };
})();
