/* ZBXi shared helpers — the three things every module used to redefine.
   Loaded before every other site script (right after config.js), so
   window.ZBXIUtil is always there by the time a module body runs.

   esc()        — HTML-escape anything before it goes into innerHTML.
   pledgeYear() — pull a 4-digit year out of a pledge class ("Fall '25" → 2025).
   loadError()  — the card a gate shows when the DATABASE failed, as opposed
                  to the "Members only" card, which means the viewer really is
                  not a signed-in brother. Telling a brother he isn't one
                  because the wifi dropped is the bug this exists to prevent. */
(function () {
  'use strict';

  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return MAP[c]; });
  }

  // "Gamma Rho · Fall '25" → 2025 · "… Spring 1993" → 1993 · unknown → null.
  // The chapter started in 1993, so a two-digit year of 93+ is 19xx.
  function pledgeYear(cls) {
    if (!cls) return null;
    var m4 = String(cls).match(/(19|20)\d{2}/);
    if (m4) return parseInt(m4[0], 10);
    var m2 = String(cls).match(/'(\d{2})/);
    if (!m2) return null;
    var yy = parseInt(m2[1], 10);
    return yy >= 93 ? 1900 + yy : 2000 + yy;
  }

  // Render "couldn't load" into el. `what` names the thing in lower case,
  // e.g. 'the executive boards' → "We couldn't load the executive boards."
  function loadError(el, what) {
    if (!el) return;
    el.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">⚠️ <b>Couldn\'t load</b>' +
      '<span>We couldn\'t load ' + esc(what || 'this page') + '. Check your connection and try again — ' +
      'you are still signed in.</span>' +
      '<button class="btn btn--gold" type="button" data-zbxi-retry>Try again</button></div>';
    var btn = el.querySelector('[data-zbxi-retry]');
    if (btn) btn.addEventListener('click', function () { location.reload(); });
  }

  // Sign-in link that comes back to the page the brother was actually on.
  // portal.js reads ?next= after a successful sign-in and only honours a bare
  // same-site page name, so this can never send anyone off-site.
  function signInHref(mode) {
    var page = location.pathname.replace(/^.*\//, '');
    var q = '?auth=' + (mode === 'signup' ? 'signup' : 'signin');
    if (page && !/^(index(\.html)?)?$/.test(page)) q += '&next=' + encodeURIComponent(page + location.search);
    return 'index.html' + q + '#brothers-portal';
  }

  window.ZBXIUtil = { esc: esc, pledgeYear: pledgeYear, loadError: loadError, signInHref: signInHref };
})();
