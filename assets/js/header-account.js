/* Header account indicator. Renders #navAccount based on Supabase auth state:
   - signed out (or unconfigured): "Brother Login" pill
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

  function renderLogin() {
    el.innerHTML = '<a href="#brothers-portal" class="btn btn--gold nav__cta">Brother Login</a>';
  }

  function renderChip(user, profile) {
    var isAdmin = (user.email || '').toLowerCase() === Z.adminEmail && !!Z.adminEmail;
    var name = (profile && profile.full_name) ? profile.full_name : (user.email || '').split('@')[0];

    el.innerHTML =
      '<button class="nav__chip" id="navChipBtn" aria-haspopup="true" aria-expanded="false">' +
        '<span class="nav__avatar">' + esc(initial(name)) + '</span>' +
        '<span class="nav__chip-name">' + esc(name) + '</span>' +
        (isAdmin ? '<span class="admin-badge">ADMIN</span>' : '') +
        '<span class="nav__caret">▾</span>' +
      '</button>' +
      '<div class="nav__menu" id="navMenu" role="menu">' +
        '<div class="nav__menu-head">' +
          '<b>' + esc(name) + '</b><span>' + esc(user.email || '') + '</span>' +
          (isAdmin ? '<span class="admin-badge">ADMIN</span>' : '') +
        '</div>' +
        '<a href="#brothers-portal" role="menuitem">👤 My Profile</a>' +
        (isAdmin ? '<a href="admin.html" role="menuitem" class="nav__menu-admin">⚙ Admin Console →</a>' : '') +
        '<div class="nav__menu-divider"></div>' +
        '<button type="button" id="navSignOut" role="menuitem" class="nav__menu-signout">Sign out</button>' +
      '</div>';

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
  if (Z && Z.configured) Z.onAuth(function () { render(); });
})();
