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

  /* ---- Brother roster (PLACEHOLDER DATA — replace names/roles/photos) ---- */
  var eboard = [
    { name: 'Alex Rivera',   role: 'President',      year: "'26", major: 'Political Science', quote: 'Leading the brotherhood we were trusted to carry forward.' },
    { name: 'Jordan Ellis',  role: 'Vice President', year: "'26", major: 'Business',          quote: 'Every brother makes us stronger than the sum of our parts.' },
    { name: 'Sam Bennett',   role: 'Treasurer',      year: "'27", major: 'Economics',         quote: 'Stewarding the chapter that raised us.' },
    { name: 'Chris Nguyen',  role: 'Rush Chair',     year: "'27", major: 'Communication',     quote: 'Come see what independent brotherhood really feels like.' }
  ];
  var brothers = [
    { name: 'Marcus Cole',   year: "'26", major: 'Biology' },
    { name: 'Devin Park',    year: "'27", major: 'Computer Science' },
    { name: 'Tyler Brooks',  year: "'27", major: 'History' },
    { name: 'Noah Fitzgerald', year: "'28", major: 'Psychology' },
    { name: 'Ethan Ramos',   year: "'28", major: 'Physics' },
    { name: 'Liam Carter',   year: "'26", major: 'Accounting' },
    { name: 'Owen Diaz',     year: "'27", major: 'English' },
    { name: 'Jared Kim',     year: "'28", major: 'Sociology' }
  ];

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

  function card(b) {
    var role = b.role ? '<span class="role">' + esc(b.role) + '</span>' : '';
    var frontSub = b.role || b.sub || [b.year, b.major].filter(Boolean).join(' · ');
    var photo = b.photo || 'assets/img/portrait.svg';
    var back = b.locked
      ? '<div class="flip__locked"><span class="flip__lock-ic">🔒</span><span>Sign in as a brother to view details</span></div>'
      : role +
        '<p class="quote">' + esc(b.quote || '"Proud to call these brothers family."') + '</p>' +
        '<p class="meta">' + [ (b.year ? 'Class of ' + String(b.year).replace("'", "20") : ''), b.major ].filter(Boolean).map(esc).join(' · ') + '</p>';
    return '' +
      '<div class="flip" tabindex="0">' +
        '<div class="flip__inner">' +
          '<div class="flip__face flip__front">' +
            '<img src="' + esc(photo) + '" alt="Portrait of ' + esc(b.name) + '" />' +
            '<div class="flip__name"><b>' + esc(b.name) + '</b><span>' + esc(frontSub) + '</span></div>' +
          '</div>' +
          '<div class="flip__face flip__back">' + back + '</div>' +
        '</div>' +
      '</div>';
  }

  var eb = document.getElementById('eboard');
  var br = document.getElementById('brothers');
  if (eb) eb.innerHTML = eboard.map(card).join('');
  if (br) br.innerHTML = brothers.map(card).join('');

  // Tap-to-flip on touch devices (hover doesn't exist there)
  document.addEventListener('click', function (e) {
    var flip = e.target.closest && e.target.closest('.flip');
    if (flip && window.matchMedia('(hover: none)').matches) flip.classList.toggle('is-flipped');
  });

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

  /* ---- Roster from Supabase: names public, details for approved brothers ---- */
  function renderRoster(list) {
    var ebs = list.filter(function (x) { return x.role; });
    var brs = list.filter(function (x) { return !x.role; });
    if (eb && ebs.length) eb.innerHTML = ebs.map(card).join('');
    if (br && brs.length) br.innerHTML = brs.map(card).join('');
  }
  function lockedList(pub) {
    return pub.map(function (p) { return { name: p.full_name, role: p.role || '', sub: p.pledge_class || '', locked: true }; });
  }
  if (window.ZBXI && window.ZBXI.configured && br) {
    window.ZBXI.listFamilyPublic().then(function (pub) {
      if (!pub || !pub.length) return; // keep placeholder cards until real data exists
      window.ZBXI.amApprovedBrother().then(function (approved) {
        if (!approved) { renderRoster(lockedList(pub)); return; }
        window.ZBXI.listVerifiedDetail().then(function (full) {
          var byId = {}; full.forEach(function (f) { byId[f.id] = f; });
          renderRoster(pub.map(function (p) {
            var f = byId[p.id] || {};
            return { name: p.full_name, role: p.role || '', year: f.grad_year ? "'" + String(f.grad_year).slice(-2) : '', major: f.major || '', quote: f.quote || '', photo: f.photo_url || '', locked: false };
          }));
        }).catch(function () { renderRoster(lockedList(pub)); });
      });
    }).catch(function () {});
  }
})();
