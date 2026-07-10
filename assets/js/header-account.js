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

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function initial(s) { var m = String(s || '').replace(/[^A-Za-z]/g, ''); return (m[0] || 'Z').toUpperCase(); }

  // On subpages (active/alumni/admin), portal links must route back to index.
  var onIndex = /(^|\/)(index\.html)?$/.test(location.pathname);
  var PORTAL = (onIndex ? '' : 'index.html') + '#brothers-portal';
  // "My Profile" opens the profile popup (index handles the #my-profile hash).
  var MYPROFILE = (onIndex ? '' : 'index.html') + '#my-profile';

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
        '<a href="' + MYPROFILE + '" id="navMyProfile" role="menuitem"><i>👤</i> My Profile</a>' +
        '<a href="gallery.html" role="menuitem"><i>🖼</i> Gallery</a>' +
        '<a href="board.html" role="menuitem"><i>💬</i> Board</a>' +
        (isAdmin ? '<a href="admin.html" role="menuitem" class="nav__menu-admin"><i>⚙</i> Admin Console <span class="nav__menu-badge" id="navPendingBadge" style="display:none"></span><em>→</em></a>' : '') +
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

    // On the homepage, "My Profile" opens the popup directly (no navigation).
    var mp = document.getElementById('navMyProfile');
    if (mp && window.ZBXIPortal) mp.addEventListener('click', function (e) {
      e.preventDefault(); close(); window.ZBXIPortal.open();
    });

    var out = document.getElementById('navSignOut');
    if (out) out.addEventListener('click', function () {
      out.textContent = 'Signing out…';
      Z.signOut().then(function () { location.reload(); }).catch(function () { location.reload(); });
    });
  }

  function render() {
    if (!Z || !Z.configured) { renderLogin(); return; }
    Z.getUser().then(function (user) {
      if (!user) { renderLogin(); return; }
      // Best-effort profile name; fall back to email if it fails.
      Z.myProfile(user.id).then(function (p) { renderChip(user, p); })
        .catch(function () { renderChip(user, null); });
    }).catch(function () { renderLogin(); });
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
      location.reload();
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
