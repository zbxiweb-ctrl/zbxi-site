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

  var esc = ZBXIUtil.esc;
  function initial(s) { var m = String(s || '').replace(/[^A-Za-z]/g, ''); return (m[0] || 'Z').toUpperCase(); }

  // On subpages (active/alumni/admin), portal links must route back to index.
  var onIndex = /(^|\/)(index\.html)?$/.test(location.pathname);
  var BASE = onIndex ? '' : 'index.html';
  var PORTAL = BASE + '#brothers-portal';
  // "Brother Profile" opens the profile popup (index handles the #my-profile hash).
  var MYPROFILE = BASE + '#my-profile';
  var SUB_KEY = 'zbxi-brothers-only';   // remembers the Brothers Only accordion

  // The members-only surfaces, surfaced from the account dropdown once signed in.
  var BROTHERS_ONLY = [
    { ic: '🎓', label: 'Active',      href: 'active.html' },
    { ic: '🏛', label: 'Alumni',      href: 'alumni.html' },
    { ic: '💬', label: 'Board',       href: 'board.html' },
    { ic: '👑', label: 'Executive Boards', href: 'eboards.html' },
    { ic: '🎁', label: 'Alumni Fund',  href: 'donations.html' },
    { ic: '📅', label: 'Events',      href: 'events.html' },
    { ic: '🌳', label: 'Family Tree', href: 'family-tree.html' },
    { ic: '🧭', label: 'Mentoring', href: 'mentoring.html' },
    { ic: '🖼', label: 'Gallery',     href: 'gallery.html' },
    { ic: '🗺', label: 'Worldwide Map', href: 'map.html' }
  ];

  /* Reload onto a CLEAN url after a sign-in/out: no #hash and no ?auth=/?invite=
     login-flow leftovers. Without this the browser restores the old scroll spot
     (or jumps to #brothers-portal) and the brother lands mid-page instead of at
     the top of the site he just signed into. */
  /* A gate sent us here with ?next=<page>; honour it so the brother lands back
     where he was. Only a bare same-site page name passes — anything carrying a
     scheme, a host or a leading slash is ignored rather than followed, so this
     can never be used to bounce someone off-site. */
  function nextTarget() {
    try {
      var raw = new URL(location.href).searchParams.get('next');
      if (!raw) return null;
      return /^[a-z0-9-]+(\.html)?(\?[a-z0-9_=&%.-]*)?$/i.test(raw) ? raw : null;
    } catch (e) { return null; }
  }

  function reloadClean() {
    try {
      var nx = nextTarget();
      if (nx) {
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        location.replace(nx);
        return;
      }
      var u = new URL(location.href);
      u.hash = '';
      u.searchParams.delete('auth');
      u.searchParams.delete('invite');
      u.searchParams.delete('next');
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      location.replace(u.toString());
    } catch (e) { location.reload(); }
  }

  /* A sign-OUT always lands on the homepage: reloading in place would strand
     the brother on the locked shell of whatever members-only page he was on
     (orientation, board, gallery…). Every page lives at the site root, so a
     relative index.html works from all of them. */
  function goHome() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    location.replace('index.html');
  }

  function renderLogin() {
    // Gold CTA that opens a small dropdown: Log in / Create account. On the
    // homepage each choice jumps the inline auth card straight to that mode; on
    // subpages it routes to index.html?auth=…#brothers-portal (portal.js reads it).
    // Off the homepage these carry ?next=<this page>, so signing in returns the
    // brother to the page he was actually trying to read.
    var SIGNIN = onIndex ? '#brothers-portal' : ZBXIUtil.signInHref('signin');
    var SIGNUP = onIndex ? '#brothers-portal' : ZBXIUtil.signInHref('signup');
    el.innerHTML =
      '<button class="btn btn--gold nav__cta nav__login-btn" id="navLoginBtn" aria-haspopup="true" aria-expanded="false">' +
        'Log In / Sign Up <span class="nav__caret">▾</span>' +
      '</button>' +
      '<div class="nav__menu nav__menu--login" id="navLoginMenu" aria-label="Sign in options">' +
        '<a href="' + SIGNIN + '" id="navDoLogin">' +
          '<span class="nav__login-ic">🔑</span>' +
          '<span class="nav__login-txt"><b>Log in</b><small>Already have an account</small></span>' +
        '</a>' +
        '<a href="' + SIGNUP + '" id="navDoSignup">' +
          '<span class="nav__login-ic">✍️</span>' +
          '<span class="nav__login-txt"><b>Create account</b><small>New brother sign-up</small></span>' +
        '</a>' +
      '</div>';

    var btn = document.getElementById('navLoginBtn');
    var menu = document.getElementById('navLoginMenu');
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function open() {
      menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
      document.dispatchEvent(new CustomEvent('zbxi:menu', { detail: 'login' }));  // see notify.js
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.contains('open') ? close() : open();
    });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !menu.classList.contains('open')) return;
      close();
      btn.focus();   // don't strand focus on <body> after closing
    });
    document.addEventListener('zbxi:menu', function (e) { if (e.detail !== 'login') close(); });

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
    // Whether the "Brothers Only" accordion below is expanded. Defaults to
    // collapsed; private mode / blocked storage falls back to that too.
    var subOpen = false;
    try { subOpen = localStorage.getItem(SUB_KEY) === '1'; } catch (e) { /* no storage */ }

    el.innerHTML =
      '<button class="nav__chip" id="navChipBtn" aria-haspopup="true" aria-expanded="false">' +
        '<span class="nav__avatar">' + avatar + '</span>' +
        '<span class="nav__chip-name">' + esc(name) + '</span>' +
        (isAdmin ? '<span class="admin-badge">ADMIN</span>' : '') +
        '<span class="nav__caret">▾</span>' +
      '</button>' +
      '<div class="nav__menu" id="navMenu" aria-label="Your account">' +
        '<div class="nav__menu-head">' +
          '<span class="nav__menu-av">' + avatar + '</span>' +
          '<div class="nav__menu-id"><b>' + esc(name) + '</b><span>' + esc(user.email || '') + '</span>' +
            (isAdmin ? '<span class="role-pill role-pill--admin">★ Admin</span>' : '<span class="role-pill">Brother of ΖΒΞ</span>') +
          '</div>' +
        '</div>' +
        '<a href="' + MYPROFILE + '" id="navAccount2"><i>⚙</i> Account</a>' +
        '<a href="' + MYPROFILE + '" id="navMyProfile"><i>👤</i> Brother Profile</a>' +
        '<a href="welcome.html"><i>🎉</i> Orientation</a>' +
        '<a href="notifications.html"><i>🔔</i> Notifications</a>' +
        '<div class="nav__menu-divider"></div>' +
        // Starts COLLAPSED, and remembers what you chose.
        //
        // It used to start open, because at the time this submenu was the only
        // route to Mentoring and Worldwide Map and a brother can't guess
        // what's behind a closed accordion. That stopped being true: the members
        // pages carry their own top nav (Active / Alumni / Gallery / Board / Find
        // a Mentor / Worldwide Map), the footer repeats those links on EVERY
        // page, and Orientation has a card per feature. Three other routes, so a
        // closed accordion now hides nothing — it just made the menu tall enough
        // to fill a phone screen.
        //
        // Remembering the choice is the point: a brother who navigates by this
        // menu expands it once, not on every page load (the menu is rebuilt from
        // scratch on each navigation, so without this it would re-collapse
        // forever).
        '<button type="button" class="nav__sub-toggle" id="navBrothersOnly" aria-expanded="' + (subOpen ? 'true' : 'false') + '">' +
          '<i>🔒</i> Brothers Only <em class="nav__sub-caret">▾</em>' +
        '</button>' +
        '<div class="nav__sub' + (subOpen ? ' open' : '') + '" id="navBrothersSub">' +
          BROTHERS_ONLY.map(function (m) {
            return '<a href="' + m.href + '"><i>' + m.ic + '</i> ' + m.label + '</a>';
          }).join('') +
        '</div>' +
        (isAdmin ? '<div class="nav__menu-divider"></div><a href="admin.html" class="nav__menu-admin"><i>⚙</i> Admin Console <span class="nav__menu-badge" id="navPendingBadge" style="display:none"></span><em>→</em></a>' : '') +
        '<div class="nav__menu-divider"></div>' +
        '<button type="button" id="navSignOut" class="nav__menu-signout"><i>↦</i> Sign out</button>' +
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
        // Idempotent: the chrome re-renders on auth events, so two async inserts
        // can race into the same menu. Bail if the link is already there.
        if (signout.parentNode.querySelector('a[href="officer.html"]')) return;
        var a = document.createElement('a');
        a.href = 'officer.html'; a.setAttribute('role', 'menuitem'); a.className = 'nav__menu-admin';
        a.innerHTML = '<i>🛡</i> Officer Console <span class="nav__menu-badge" id="navOfficerBadge" style="display:none"></span><em>→</em>';
        var div = document.createElement('div');
        div.className = 'nav__menu-divider';
        signout.parentNode.insertBefore(a, signout);
        signout.parentNode.insertBefore(div, signout);
        // Same "N pending" nudge the admin gets. pendingQueue() returns nothing
        // unless this officer actually holds members.approve, so no extra check.
        if (Z.pendingQueue) Z.pendingQueue().then(function (rows) {
          var b = document.getElementById('navOfficerBadge');
          if (b && rows.length) { b.style.display = ''; b.textContent = rows.length + ' pending'; }
        }).catch(function () {});
      }).catch(function () {});
    }

    var btn = document.getElementById('navChipBtn');
    var menu = document.getElementById('navMenu');
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function open() {
      menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
      document.dispatchEvent(new CustomEvent('zbxi:menu', { detail: 'account' }));  // see notify.js
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.contains('open') ? close() : open();
    });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !menu.classList.contains('open')) return;
      close();
      btn.focus();   // don't strand focus on <body> after closing
    });
    document.addEventListener('zbxi:menu', function (e) { if (e.detail !== 'account') close(); });
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

    // "Brothers Only" expands in place rather than navigating anywhere, and the
    // choice sticks across page loads (see the note where the markup is built).
    var sub = document.getElementById('navBrothersSub');
    var subBtn = document.getElementById('navBrothersOnly');
    if (sub && subBtn) subBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var openNow = sub.classList.toggle('open');
      subBtn.setAttribute('aria-expanded', openNow ? 'true' : 'false');
      try { localStorage.setItem(SUB_KEY, openNow ? '1' : '0'); } catch (e2) { /* no storage */ }
    });

    var out = document.getElementById('navSignOut');
    if (out) out.addEventListener('click', function () {
      out.textContent = 'Signing out…';
      Z.signOut().then(goHome).catch(goHome);
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

    // Alumni "Update Your Info" button: when signed in, #brothers-portal is hidden
    // (below), so link it straight to the profile editor instead of a dead scroll.
    var alum = document.getElementById('alumniUpdateCta');
    if (alum) {
      alum.onclick = (signedIn && window.ZBXIPortal)
        ? function (e) { e.preventDefault(); window.ZBXIPortal.open('profile'); }
        : null;
    }

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
      // NEVER reload during a password reset. This used to reload the page and
      // destroy the recovery state, after which the restored session looked like
      // an ordinary login — the brother was signed in without ever resetting.
      // (The old `return` here also failed to record lastUid, so the very NEXT
      // auth event read as a new identity and reloaded anyway.)
      if (event === 'PASSWORD_RECOVERY' || (Z.isRecovery && Z.isRecovery())) {
        lastUid = uid;                                            // don't let a later event reload
        return;
      }
      if (uid === lastUid) return;                                // token refresh / tab focus
      lastUid = uid;
      if (!uid) { goHome(); return; }  // signed out (any path, incl. the profile popup)
      reloadClean();   // signed IN: stay on this page — lands at the TOP of a clean url
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

  /* ---- scrolled nav state: hairline + deeper shadow once the page moves ---- */
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('nav--scrolled', window.scrollY > 14); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
