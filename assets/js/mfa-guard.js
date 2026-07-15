/* 2FA site-wide guard for the member subpages.

   Problem it solves: the homepage portal card shows the "enter your code" step,
   but the header/nav still treat a password-only (aal1) session as logged in —
   so a brother with 2FA on (or an attacker who only has the password) could just
   click a nav link and skip the code. This guard closes that: on any member
   subpage, if the session has done the password step but still owes a TOTP code
   (currentLevel aal1 + nextLevel aal2 == a verified factor exists), it sends them
   to the homepage challenge before member content is usable.

   NOT loaded on index.html (the portal card renders the challenge there itself —
   guarding index would bounce in a loop) and NOT on the admin console (admin.js
   gate() already runs the same AAL check). Loaded right after supabase-client.js
   so it fires as early as possible. */
(function () {
  'use strict';
  var Z = window.ZBXI;
  if (!Z || !Z.configured || !Z.mfaAAL) return;
  Z.mfaAAL().then(function (r) {
    var d = r && r.data;
    if (d && d.currentLevel === 'aal1' && d.nextLevel === 'aal2') {
      location.replace('index.html#brothers-portal');
    }
  }).catch(function () { /* AAL glitch -> fail open, don't strand anyone */ });
})();
