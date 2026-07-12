/* Hold-to-peek on every password field, site-wide.
   A 🐓 button is injected into each <input type="password">; hold it (mouse,
   finger, or Space/Enter) to reveal the password, release to re-hide.

   Why a MutationObserver: the portal builds its forms as HTML strings and swaps
   them in at render time (login, sign-up, reset, new-password, change-password),
   so the fields don't exist at page load. The observer catches every one of them
   as it appears — now and for any password field added to the site later.

   NOTE on the mask character: a password field's dots are drawn by the browser.
   CSS can't swap them for a custom glyph (`-webkit-text-security` only accepts
   disc/circle/square), and faking the input would break password managers and
   autofill. What we CAN do is recolor them — the dots take the input's `color`,
   so they render GOLD (see input[type=password] in styles.css). */
(function () {
  'use strict';

  function enhance(inp) {
    if (inp.dataset.peek || inp.type !== 'password') return;
    inp.dataset.peek = '1';

    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);                       // same node -> form/name refs stay valid

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-peek';
    btn.textContent = '🐓';
    btn.tabIndex = -1;                           // don't trap keyboard users tabbing through the form
    btn.setAttribute('aria-label', 'Hold to show password');
    btn.title = 'Hold to show password';
    wrap.appendChild(btn);

    function show(e) { if (e) e.preventDefault(); inp.type = 'text'; btn.classList.add('on'); }
    function hide() { inp.type = 'password'; btn.classList.remove('on'); }

    btn.addEventListener('pointerdown', show);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      btn.addEventListener(ev, hide);
    });
    window.addEventListener('blur', hide);       // never leave a password exposed on tab-away
  }

  function scan(root) {
    var nodes = (root || document).querySelectorAll('input[type="password"]:not([data-peek])');
    Array.prototype.forEach.call(nodes, enhance);
  }

  scan();
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches('input[type="password"]')) enhance(n);
        else if (n.querySelectorAll) scan(n);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
