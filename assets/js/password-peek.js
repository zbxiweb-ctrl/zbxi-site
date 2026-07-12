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

  /* A GOLDEN rooster. It must be an SVG, not the 🐓 emoji: emoji are drawn by the
     OS as full-colour glyphs, so CSS `color` cannot tint them — 🐓 renders red/brown
     on every platform no matter what we style. This silhouette uses
     fill="currentColor", so it takes the gold token (and flips to navy on press for
     contrast against the gold button). */
  var ROOSTER =
    '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">' +
      // comb
      '<path d="M8.7 6.4c0-1.6 1.3-2.1 2.1-1 .3-1.7 1.9-1.9 2.5-.5.7-1.4 2.4-1 2.5.6.1 1 0 1.8-.2 2.4z"/>' +
      // head
      '<circle cx="12.2" cy="9.6" r="3.7"/>' +
      // beak
      '<path d="M8.7 9.8 4.1 11.1l4.6 1.4z"/>' +
      // wattle
      '<path d="M10.5 12.7c-1 1.5-.7 3.1.6 3.6 1.1-.7 1.3-2.2.6-3.6z"/>' +
      // body
      '<path d="M13.9 12.8c-4.2.6-6.9 4-6.5 8.2.3 3.4 3.1 5.8 6.5 5.8 3.7 0 6.5-2.5 6.7-6.1.2-4.1-2.5-7.5-6.7-7.9z"/>' +
      // tail feathers
      '<path d="M19.9 14.5c3.7-.6 6.6-2.7 8.2-6.4.9 3.6.2 6.6-2 8.9 2.5-.5 4.2-2 5.2-4.2.4 5.3-2.5 9.3-7.5 10.6-1.1-3.5-2.4-6.4-3.9-8.9z"/>' +
      // legs + feet
      '<path d="M12.3 26.3h1.4v3.3h-1.4zM15.5 26.3h1.4v3.3h-1.4zM10.4 29.4h5.2v1.3h-5.2zM13.6 29.4h5.2v1.3h-5.2z"/>' +
    '</svg>';

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
    btn.innerHTML = ROOSTER;                     // SVG, not the 🐓 emoji — see note above
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
