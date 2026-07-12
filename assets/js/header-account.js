/* Header account indicator. Renders #navAccount based on Supabase auth state:
   - signed out (or unconfigured): "Log In / Sign Up" dropdown CTA
   - signed in: account chip (avatar + name) with a dropdown
   - signed in as ADMIN_EMAIL: chip gets an ADMIN badge + an Admin Console link
   Re-renders on auth changes so logging in via the portal updates it live. */
(function () {
  'use strict';
  var el = document.getElementById('navAccount');
  if (!el) return;
  var Z = window.ZBXI;

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function initial(s) { var m = String(s || '').replace(/[^A-Za-z]/g, ''); return (m[0] || 'Z').toUpperCase(); }

  // On subpages (active/alumni/admin), portal links must route back to index.
  var onIndex = /(^|\/)(index\.html)?$/.test(location.pathname);
  var BASE = onIndex ? '' : 'index.html';
  var PORTAL = BASE + '#brothers-portal';
  // "Brother Profile" opens the profile popup (index handles the #my-profile hash).
  var MYPROFILE = BASE + '#my-profile';

  // The members-only surfaces, surfaced from the account dropdown once signed in.
  var BROTHERS_ONLY = [
    { ic: '🎓', label: 'Active',      href: 'active.html' },
    { ic: '🏛', label: 'Alumni',      href: 'alumni.html' },
    { ic: '🌳', label: 'Family Tree', href: BASE + '#family-tree' },
    { ic: '📅', label: 'Events',      href: BASE + '#events' },
    { ic: '🖼', label: 'Gallery',     href: 'gallery.html' },
    { ic: '💬', label: 'Board',       href: 'board.html' }
  ];

  /* Reload onto a CLEAN url after a sign-in/out: no #hash and no ?auth=/?invite=
     login-flow leftovers. Without this the browser restores the old scroll spot
     (or jumps to #brothers-portal) and the brother lands mid-page instead of at
     the top of the site he just signed into. */
  function reloadClean() {
    try {
      var u = new URL(location.href);
      u.hash = '';
      u.searchParams.delete('auth');
      u.searchParams.delete('invite');
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      location.replace(u.toString());
    } catch (e) { location.reload(); }
  }

  function renderLogin() {
    // Gold CTA that opens a small dropdown: Log in / Create account. On the
    // homepage each choice jumps the inline auth card straight to that mode; on
    // subpages it routes to index.html?auth=…#brothers-portal (portal.js reads it).
    var SIGNIN = (onIndex ? '' : 'index.html?auth=signin') + '#brothers-portal';
    var SIGNUP = (onIndex ? '' : 'index.html?auth=signup') + '#brothers-portal';
    el.innerHTML =
      '<button class="btn btn--gold nav__cta nav__login-btn" id="navLoginBtn" aria-haspopup="true" aria-expanded="false">' +
        'Log In / Sign Up <span class="nav__caret">▾</span>' +
      '</button>' +
      '<div class="nav__menu nav__menu--login" id="navLoginMenu" role="menu">' +
        '<a href="' + SIGNIN + '" id="navDoLogin" role="menuitem">' +
          '<span class="nav__login-ic">🔑</span>' +
          '<span class="nav__login-txt"><b>Log in</b><small>Already have an account</small></span>' +
        '</a>' +
        '<a href="' + SIGNUP + '" id="navDoSignup" role="menuitem">' +
          '<span class="nav__login-ic">✍️</span>' +
          '<span class="nav__login-txt"><b>Create account</b><small>New brother sign-up</small></span>' +
        '</a>' +
      '</div>';

    var btn = document.getElementById('navLoginBtn');
    var menu = document.getElementById('navLoginMenu');
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function open() { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.contains('open') ? close() : open();
    });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    // On the homepage, open the inline auth card directly (no navigation).
    if (onIndex && window.ZBXIPortal) {
      var wire = function (id, mode) {
        var a = document.getElementById(id);
        if (a) a.addEventListener('click', function (e) { e.preventDefault(); close(); window.ZBXIPortal.showAuth(mode); });
      };
      wire('navDoLogin', 'signin');
      wire('navDoSignup', 'signup');
    } else {
      menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
    }
  }

  function renderChip(user, profile) {
    var isAdmin = (user.email || '').toLowerCase() === Z.adminEmail && !!Z.adminEmail;
    var name = (profile && profile.full_name) ? profile.full_name : (user.email || '').split('@')[0];
    // Profile photo in the bubble when one exists; falls back to the initial.
    var avatar = (profile && profile.photo_url)
      ? '<img src="' + esc(profile.photo_url) + '" alt="" />'
      : esc(initial(name));

    el.innerHTML =
      '<button class="nav__chip" id="navChipBtn" aria-haspopup="true" aria-expanded="false">' +
        '<span class="nav__avatar">' + avatar + '</span>' +
        '<span class="nav__chip-name">' + esc(name) + '</span>' +
        (isAdmin ? '<span class="admin-badge">ADMIN</span>' : '') +
        '<span class="nav__caret">▾</span>' +
      '</button>' +
      '<div class="nav__menu" id="navMenu" role="menu">' +
        '<div class="nav__menu-head">' +
          '<span class="nav__menu-av">' + avatar + '</span>' +
          '<div class="nav__menu-id"><b>' + esc(name) + '</b><span>' + esc(user.email || '') + '</span>' +
            (isAdmin ? '<span class="role-pill role-pill--admin">★ Admin</span>' : '<span class="role-pill">Brother of ΖΒΞ</span>') +
          '</div>' +
        '</div>' +
        '<a href="' + MYPROFILE + '" id="navMyProfile" role="menuitem"><i>👤</i> Brother Profile</a>' +
        '<a href="' + MYPROFILE + '" id="navAccount2" role="menuitem"><i>⚙</i> Account</a>' +
        '<div class="nav__menu-divider"></div>' +
        '<button type="button" class="nav__sub-toggle" id="navBrothersOnly" aria-expanded="false">' +
          '<i>🔒</i> Brothers Only <em class="nav__sub-caret">▾</em>' +
        '</button>' +
        '<div class="nav__sub" id="navBrothersSub">' +
          BROTHERS_ONLY.map(function (m) {
            return '<a href="' + m.href + '" role="menuitem"><i>' + m.ic + '</i> ' + m.label + '</a>';
          }).join('') +
        '</div>' +
        (isAdmin ? '<div class="nav__menu-divider"></div><a href="admin.html" role="menuitem" class="nav__menu-admin"><i>⚙</i> Admin Console <span class="nav__menu-badge" id="navPendingBadge" style="display:none"></span><em>→</em></a>' : '') +
        '<div class="nav__menu-divider"></div>' +
        '<button type="button" id="navSignOut" role="menuitem" class="nav__menu-signout"><i>↦</i> Sign out</button>' +
      '</div>';

    // Admin: surface how many brothers are waiting for approval
    if (isAdmin && Z.listPending) {
      Z.listPending().then(function (rows) {
        var n = (rows || []).length;
        var b = document.getElementById('navPendingBadge');
        if (b && n) { b.style.display = ''; b.textContent = n + ' pending'; }
      }).catch(function () {});
    }

    // Officers: a current President whose seat has >=1 enabled grant gets an
    // Officer Console link (mirrors the Admin link). The server-side RLS is the
    // real gate; this just surfaces the shortcut.
    if (!isAdmin && Z.myOfficerSeat && Z.officerGrantsList) {
      Promise.all([Z.myOfficerSeat(), Z.officerGrantsList()]).then(function (res) {
        var seat = res[0], grants = res[1] || [];
        if (!seat || !grants.some(function (g) { return g.seat === seat && g.enabled; })) return;
        var signout = document.getElementById('navSignOut');
        if (!signout || !signout.parentNode) return;
        var a = document.createElement('a');
        a.href = 'officer.html'; a.setAttribute('role', 'menuitem'); a.className = 'nav__menu-admin';
        a.innerHTML = '<i>🛡</i> Officer Console <em>→</em>';
        var div = document.createElement('div');
        div.className = 'nav__menu-divider';
        signout.parentNode.insertBefore(a, signout);
        signout.parentNode.insertBefore(div, signout);
      }).catch(function () {});
    }

    var btn = document.getElementById('navChipBtn');
    var menu = document.getElementById('navMenu');
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function open() { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.contains('open') ? close() : open();
    });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    // Let the in-page anchors close the menu naturally
    menu.querySelectorAll('a[href^="#"]').forEach(function (a) { a.addEventListener('click', close); });

    // "Brother Profile" / "Account" open the popup in place on ANY page, straight
    // to the right tab. (portal.js runs site-wide in modal-only mode.)
    [['navMyProfile', 'profile'], ['navAccount2', 'account']].forEach(function (pair) {
      var a = document.getElementById(pair[0]);
      if (a && window.ZBXIPortal) a.addEventListener('click', function (e) {
        e.preventDefault(); close(); window.ZBXIPortal.open(pair[1]);
      });
    });

    // "Brothers Only" expands in place rather than navigating anywhere.
    var sub = document.getElementById('navBrothersSub');
    var subBtn = document.getElementById('navBrothersOnly');
    if (sub && subBtn) subBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var openNow = sub.classList.toggle('open');
      subBtn.setAttribute('aria-expanded', openNow ? 'true' : 'false');
    });

    var out = document.getElementById('navSignOut');
    if (out) out.addEventListener('click', function () {
      out.textContent = 'Signing out…';
      Z.signOut().then(reloadClean).catch(reloadClean);
    });
  }

  /* Signed-in chrome:
     - hero: gold button becomes "Logged In" (opens the profile popup) and the
       "Interested in Rushing?" CTA hides (rushing is for prospects).
     - the whole #brothers-portal section is the SIGN-IN card. Once you're in, it
       is dead weight — its welcome banner and member-perks grid now live in the
       account dropdown ("Brothers Only"). Hide it, plus every nav/footer link
       pointing at it, so nothing scrolls to a hidden section. */
  function signedInChrome(signedIn) {
    var login = document.getElementById('heroLoginCta');
    var rush = document.getElementById('heroRushCta');
    if (login) {
      login.innerHTML = signedIn ? '✓ Logged In' : 'Log In / Sign Up';
      login.onclick = (signedIn && window.ZBXIPortal)
        ? function (e) { e.preventDefault(); window.ZBXIPortal.open('profile'); }
        : null;
    }
    if (rush) rush.style.display = signedIn ? 'none' : '';

    var sec = document.getElementById('brothers-portal');
    if (sec) sec.style.display = signedIn ? 'none' : '';
    // ONLY the nav + footer links — scoping matters: an unscoped selector also hid
    // the inline "sign in" link inside prose (e.g. the family-tree lock note),
    // leaving a sentence with a hole in it.
    document.querySelectorAll('.nav__links a[href$="#brothers-portal"], .footer__nav a[href$="#brothers-portal"]')
      .forEach(function (a) { a.style.display = signedIn ? 'none' : ''; });
  }

  function render() {
    if (!Z || !Z.configured) { renderLogin(); signedInChrome(false); return; }
    Z.getUser().then(function (user) {
      if (!user) { renderLogin(); signedInChrome(false); return; }
      signedInChrome(true);
      // Best-effort profile name; fall back to email if it fails.
      Z.myProfile(user.id).then(function (p) { renderChip(user, p); })
        .catch(function () { renderChip(user, null); });
    }).catch(function () { renderLogin(); signedInChrome(false); });
  }

  render();

  /* ---- Keep members-only sections honest across a sign-in/out ----
     The gated surfaces (family tree, calendar, gallery, board, rosters, class
     pages) each fetch their data once at page load; they don't listen for auth.
     So after logging in the header updated but the tree stayed locked until a
     manual refresh. Rather than teach six modules to re-fetch — and miss one —
     reload once when the signed-in identity actually changes. This script is
     loaded on every member-facing page, so the fix covers all of them. */
  if (Z && Z.configured) {
    var lastUid, sawFirst = false;
    Z.onAuth(function (event, session) {
      render();
      var uid = (session && session.user && session.user.id) || null;
      if (!sawFirst) { sawFirst = true; lastUid = uid; return; }  // initial session
      if (event === 'PASSWORD_RECOVERY') return;                  // portal opens the reset form
      if (uid === lastUid) return;                                // token refresh / tab focus
      lastUid = uid;
      reloadClean();   // lands at the TOP of a clean url, not mid-page on the login card
    });
  }

  /* ---- No menu flash when the hamburger breakpoint flips ----
     Below 1023px .nav__links becomes position:fixed + translateY(-140%). Since
     transform is transitioned, a resize across the breakpoint animated the menu
     from the desktop row up out of view — flashing its contents for ~300ms.
     The transition is disabled by default and only armed once things settle. */
  var root = document.documentElement, navT;
  function armNav() { root.classList.add('nav-anim'); }
  setTimeout(armNav, 120);                       // never animate on first paint
  window.addEventListener('resize', function () {
    root.classList.remove('nav-anim');           // no animation while dragging the window
    clearTimeout(navT);
    navT = setTimeout(armNav, 200);
  });

  /* ---- dark-mode toggle (injected into the nav; works on every page) ----
     The theme is set pre-paint by an inline <head> script (no flash); this just
     flips it and remembers the choice. Defaults to the OS preference. */
  (function themeToggle() {
    var rootEl = document.documentElement;
    var bar = document.querySelector('.nav__inner');
    if (!bar || document.getElementById('themeToggle')) return;
    var btn = document.createElement('button');
    btn.id = 'themeToggle';
    btn.type = 'button';
    btn.className = 'theme-toggle';
    function sync() {
      var dark = rootEl.dataset.theme === 'dark';
      btn.textContent = dark ? '☀️' : '🌙';
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = btn.getAttribute('aria-label');
    }
    sync();
    btn.addEventListener('click', function () {
      var next = rootEl.dataset.theme === 'dark' ? 'light' : 'dark';
      rootEl.dataset.theme = next;
      try { localStorage.setItem('zbxi-theme', next); } catch (e) {}
      sync();
    });
    var acct = document.getElementById('navAccount');
    bar.insertBefore(btn, acct || bar.querySelector('.nav__toggle'));
  })();

  /* ---- scrolled nav state: hairline + deeper shadow once the page moves ---- */
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('nav--scrolled', window.scrollY > 14); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
