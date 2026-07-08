/* Zeta Beta Xi — site interactions. Vanilla JS, no dependencies. */
(function () {
  'use strict';

  /* ---- Year ---- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ---- Mobile nav ---- */
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

  /* ---- Gallery + lightbox (PLACEHOLDER tiles — replace with real photos) ---- */
  var galleryImgs = ['tile.svg','tile.svg','tile.svg','tile.svg','tile.svg','tile.svg','tile.svg','tile.svg']
    .map(function (f) { return 'assets/img/' + f; });
  var gEl = document.getElementById('gallery');
  if (gEl) {
    gEl.innerHTML = galleryImgs.map(function (src, i) {
      return '<button data-i="' + i + '" aria-label="Open photo ' + (i + 1) + '"><img src="' + src + '" alt="Chapter photo ' + (i + 1) + '" loading="lazy" /></button>';
    }).join('');
  }

  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var cur = 0;
  function openLb(i) { cur = i; lbImg.src = galleryImgs[i]; lb.classList.add('open'); lb.setAttribute('aria-hidden', 'false'); }
  function closeLb() { lb.classList.remove('open'); lb.setAttribute('aria-hidden', 'true'); }
  function step(d) { cur = (cur + d + galleryImgs.length) % galleryImgs.length; lbImg.src = galleryImgs[cur]; }
  if (gEl) gEl.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) openLb(+b.dataset.i); });
  var el;
  if ((el = document.getElementById('lbClose'))) el.addEventListener('click', closeLb);
  if ((el = document.getElementById('lbPrev'))) el.addEventListener('click', function () { step(-1); });
  if ((el = document.getElementById('lbNext'))) el.addEventListener('click', function () { step(1); });
  if (lb) lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', function (e) {
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  /* ---- Forms (Formspree). Graceful AJAX submit + inline status. ---- */
  function wireForm(formId, statusId) {
    var form = document.getElementById(formId);
    var status = document.getElementById(statusId);
    if (!form || !status) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';

      // Native validation
      if (!form.checkValidity()) { form.reportValidity(); return; }

      // Not configured yet? Tell the user honestly instead of failing silently.
      if (form.action.indexOf('YOUR_FORM_ID') !== -1) {
        status.className = 'form-status err';
        status.textContent = 'Form not connected yet — add your Formspree ID (see README). Your message was not sent.';
        return;
      }

      var btn = form.querySelector('button[type=submit]');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            status.className = 'form-status ok';
            status.textContent = '✓ Thank you! We’ll be in touch soon.';
          } else {
            return r.json().then(function (d) {
              throw new Error(d && d.errors ? d.errors.map(function (x) { return x.message; }).join(', ') : 'submission failed');
            });
          }
        })
        .catch(function () {
          status.className = 'form-status err';
          status.textContent = 'Something went wrong. Please email us directly or try again.';
        })
        .finally(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
    });
  }
  wireForm('contactForm', 'contactStatus');

  /* ---- Brotherhood directory counts (Active / Alumni link cards) ---- */
  var caEl = document.getElementById('countActive');
  var clEl = document.getElementById('countAlumni');
  if (caEl && clEl && window.ZBXI && window.ZBXI.configured) {
    var now = new Date();
    var CUTOFF = now.getFullYear() + (now.getMonth() >= 5 ? 1 : 0);
    var pledgeYear = function (cls) {
      if (!cls) return null;
      var m4 = cls.match(/(19|20)\d{2}/); if (m4) return parseInt(m4[0], 10);
      var m2 = cls.match(/'(\d{2})/); if (!m2) return null;
      var yy = parseInt(m2[1], 10); return yy >= 93 ? 1900 + yy : 2000 + yy;
    };
    window.ZBXI.listFamilyPublic().then(function (rows) {
      if (!rows || !rows.length) return;
      var active = rows.filter(function (b) {
        var grad = (b.registered && b.grad_year) ? b.grad_year
                 : (b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null));
        return grad != null && grad >= CUTOFF;
      }).length;
      caEl.textContent = active + ' brothers';
      clEl.textContent = (rows.length - active) + ' brothers';
    }).catch(function () {});
  }
})();
