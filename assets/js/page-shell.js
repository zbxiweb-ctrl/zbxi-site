/* Shared shell behavior for subpages (active.html / alumni.html):
   footer year + mobile nav toggle. index.html gets these from main.js. */
(function () {
  'use strict';
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
    });
  }
})();
