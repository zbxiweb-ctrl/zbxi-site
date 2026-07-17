/* Light/dark toggle — loaded on EVERY page (public pages, the consoles, 404).
   The theme itself is set pre-paint by an inline <head> script (no flash);
   this just draws the button, flips the theme and remembers the choice.
   Mount: the public nav bar, else the console topbar, else fixed top-right. */
(function () {
  'use strict';
  if (document.getElementById('themeToggle')) return;
  var rootEl = document.documentElement;
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

  var nav = document.querySelector('.nav__inner');
  var topbar = document.querySelector('.admin-topbar');
  if (nav) {
    nav.insertBefore(btn, document.getElementById('navAccount') || nav.querySelector('.nav__toggle'));
  } else if (topbar) {
    topbar.insertBefore(btn, topbar.querySelector('.back-pill'));
  } else {
    btn.className += ' theme-toggle--fixed';
    document.body.appendChild(btn);
  }
})();
