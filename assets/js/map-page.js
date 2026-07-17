/* The Brotherhood Worldwide page — data bootstrap for the map engine.
   On the alumni page brothers-page.js used to hydrate members and fire
   zbxi:hydrated; on this dedicated page we do the same handoff ourselves:
   approved brothers get the roster (via the roster_detail view), everyone
   else gets the standard members-only lock. worldwide-map.js takes it from
   the event onward. */
(function () {
  'use strict';
  var gate = document.getElementById('mapGate');
  var Z = window.ZBXI;
  if (!gate || !Z || !Z.configured) return;

  function lock() {
    gate.innerHTML =
      '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Brothers only</b>' +
      '<span>Sign in as a verified brother to see where the brotherhood lives today.</span>' +
      '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a></div>';
  }

  gate.innerHTML = '<p class="page-empty">Loading…</p>';
  Z.amApprovedBrother().then(function (ok) {
    if (!ok) { lock(); return; }
    Z.listVerifiedDetail().then(function (rows) {
      gate.innerHTML = '';
      window.ZBXI_MEMBERS = rows || [];
      document.dispatchEvent(new CustomEvent('zbxi:hydrated'));
      // Nobody has a city yet -> the engine leaves the section hidden; say why.
      if (!(rows || []).some(function (b) { return b.city; })) {
        gate.innerHTML = '<p class="page-empty">No cities on file yet — add your “current city” in My Profile to start the map.</p>';
      }
    }).catch(function () {
      gate.innerHTML = '<p class="page-empty">The map couldn\'t load right now.</p>';
    });
  }).catch(lock);
})();
