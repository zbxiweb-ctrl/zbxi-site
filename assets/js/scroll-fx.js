/* Scroll effects: reveal-on-scroll, staggered cascades, and count-up stats.
   Motion is opt-in via <html class="fx">, set by an inline <head> snippet only
   when the visitor allows motion. No .fx (no-JS, reduced-motion, or unsupported
   browser) => this bails and every element stays fully visible — never blank.
   Auto-tags common blocks so the HTML stays clean. GPU-only (transform/opacity). */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('fx') || !('IntersectionObserver' in window)) return;

  function tag(sel, cls) {
    document.querySelectorAll(sel).forEach(function (el) { el.classList.add(cls); });
  }

  // --- single reveal blocks (fade + rise) ---
  ['.section .center', '.split > div', '.founding-note', '.alumni-cta > div',
   '.give-card', '.spot-card', '#calWrap', '.gallery-teaser'
  ].forEach(function (s) { tag(s, 'reveal'); });

  // the About split gets a left/right slide for a bit of drama
  var split = document.querySelectorAll('.split > div');
  if (split[0]) split[0].classList.add('reveal--left');
  if (split[1]) split[1].classList.add('reveal--right');

  // --- staggered groups: children cascade, offset by their index (capped) ---
  ['.values', '.medals', '.dir-cards', '.stat-row', '.give-grid'].forEach(function (s) {
    document.querySelectorAll(s).forEach(function (g) {
      g.classList.add('stagger');
      Array.prototype.forEach.call(g.children, function (c, i) {
        c.style.setProperty('--i', Math.min(i, 10));
      });
    });
  });

  // --- reveal observer ---
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
  document.querySelectorAll('.reveal, .stagger, .sect-watermark').forEach(function (t) { io.observe(t); });

  // --- count-up numbers (e.g. Founded 1993, 320+ brothers) ---
  function countUp(el) {
    var m = el.textContent.trim().match(/^(\d[\d,]*)(.*)$/);
    if (!m) return;                                  // "Local" etc. left as-is
    var hadComma = /,/.test(m[1]);
    var end = parseInt(m[1].replace(/,/g, ''), 10), suffix = m[2] || '';
    var dur = 1100, t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var v = Math.round((1 - Math.pow(1 - p, 3)) * end);   // easeOutCubic
      el.textContent = (hadComma ? v.toLocaleString() : String(v)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var statIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.stat b').forEach(countUp);
        statIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.stat-row').forEach(function (r) { statIO.observe(r); });
})();
