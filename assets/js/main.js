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
    var setNav = function (open) {
      links.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();                    // keep the document handler from instantly re-closing
      setNav(!links.classList.contains('open'));
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setNav(false);
    });
    // Click anywhere off the menu — or press Esc — to dismiss it.
    document.addEventListener('click', function (e) {
      if (!links.classList.contains('open')) return;
      if (links.contains(e.target) || toggle.contains(e.target)) return;
      setNav(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });
  }

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

  /* ---- Gallery teaser: latest posts for approved brothers, CTA otherwise ---- */
  var teaser = document.getElementById('galleryTeaser');
  function teaserCta(msg) {
    teaser.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Brothers only</b>' +
      '<span>' + msg + '</span>' +
      '<a class="btn btn--gold" href="gallery.html">Open the gallery</a></div>';
  }
  if (teaser) {
    if (!(window.ZBXI && window.ZBXI.configured)) {
      teaserCta('The private gallery opens with the members area.');
    } else {
      window.ZBXI.amApprovedBrother().then(function (ok) {
        if (!ok) { teaserCta('Sign in as a verified brother to see photos shared by the brotherhood.'); return; }
        window.ZBXI.galleryList().then(function (posts) {
          posts = (posts || []).slice(0, 6);
          if (!posts.length) { teaserCta('No posts yet — be the first to share a memory.'); return; }
          var paths = posts.map(function (p) { return p.image_path; });
          window.ZBXI.gallerySignedUrls(paths).then(function (urls) {
            teaser.innerHTML = '<div class="gallery">' + posts.map(function (p) {
              var u = urls[p.image_path];
              return '<a href="gallery.html" aria-label="Open the gallery">' + (u ? '<img src="' + esc(u) + '" loading="lazy" alt="">' : '') + '</a>';
            }).join('') + '</div>' +
            '<p class="center" style="margin-top:1.6rem"><a class="btn btn--navy" href="gallery.html">Open the full gallery →</a></p>';
          });
        }).catch(function () { teaserCta('Sign in as a verified brother to see photos shared by the brotherhood.'); });
      });
    }
  }

  /* ---- Brother of the Month (deterministic monthly rotation) ---- */
  var spotSec = document.getElementById('spotlight');
  var spotEl = document.getElementById('spotlightCard');
  if (spotSec && spotEl && window.ZBXI && window.ZBXI.configured) {
    var monthKey = new Date().getFullYear() + '-' + (new Date().getMonth() + 1);
    var hash = 0;
    for (var hi = 0; hi < monthKey.length; hi++) hash = (hash * 31 + monthKey.charCodeAt(hi)) >>> 0;

    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (ok) {
        window.ZBXI.listVerifiedDetail().then(function (rows) {
          var cands = (rows || []).filter(function (b) { return b.user_id && b.photo_url && b.bio; })
            .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
          if (!cands.length) return; // section stays hidden until profiles are complete
          var b = cands[hash % cands.length];
          spotSec.style.display = '';
          var sub = [b.pledge_class, b.grad_year ? 'Class of ' + b.grad_year : null,
                     [b.occupation, b.city].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
          var excerpt = b.bio.length > 260 ? b.bio.slice(0, 260).replace(/\s+\S*$/, '') + '…' : b.bio;
          spotEl.innerHTML =
            '<div class="spot-card">' +
              '<img class="spot-card__photo" src="' + esc(b.photo_url) + '" alt="">' +
              '<div class="spot-card__body">' +
                '<h3>' + esc(b.full_name) + '</h3>' +
                '<p class="spot-card__sub">' + esc(sub) + '</p>' +
                (b.quote ? '<p class="spot-card__quote">“' + esc(b.quote) + '”</p>' : '') +
                '<p class="spot-card__bio">' + esc(excerpt) + '</p>' +
                '<button class="btn btn--navy" id="spotMore">Read his full profile →</button>' +
              '</div></div>';
          var more = document.getElementById('spotMore');
          if (more) more.onclick = function () {
            if (window.BrotherCard) window.BrotherCard.open({ id: b.id, full_name: b.full_name, pledge_class: b.pledge_class, role: b.role, role_term: b.role_term, photo_url: b.photo_url, registered: true }, { portal: '#brothers-portal' });
          };
        });
      } else {
        // Public teaser (names/details are members-only now)
        spotSec.style.display = '';
        spotEl.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🏅 <b>This month\'s featured brother</b>' +
          '<span>Every month we spotlight one brother\'s story — where the brotherhood took him. Sign in to read it.</span>' +
          '<a class="btn btn--gold" href="#brothers-portal">Log In / Sign Up</a></div>';
      }
    });
  }

  /* ---- Greek Excellence awards (admin-editable; static markup is the fallback) ---- */
  var awardsGrid = document.getElementById('awardsGrid');
  if (awardsGrid && window.ZBXI && window.ZBXI.configured) {
    var PILLAR_IC = { community: '★', service: '✚', leadership: '♛', responsibility: '⚖', other: '◆' };
    window.ZBXI.awardsList().then(function (rows) {
      if (!rows || !rows.length) return; // keep the hard-coded four
      var years = [];
      rows.forEach(function (a) { if (years.indexOf(a.year_label) === -1) years.push(a.year_label); });
      var title = document.getElementById('awardsTitle');
      var yearsEl = document.getElementById('awardYears');

      function showYear(y) {
        if (title) title.textContent = y + ' Greek Excellence Awards';
        awardsGrid.innerHTML = rows.filter(function (a) { return a.year_label === y; }).map(function (a) {
          return '<div class="medal">' +
            '<div class="medal__seal"><span>' + (PILLAR_IC[a.pillar] || '◆') + '</span></div>' +
            '<b>' + esc(a.title) + '</b>' +
            '<span class="medal__pillar">' + esc(a.pillar === 'other' ? 'Excellence' : a.pillar.charAt(0).toUpperCase() + a.pillar.slice(1)) + '</span>' +
            (a.note ? '<p>' + esc(a.note) + '</p>' : '') +
          '</div>';
        }).join('');
        if (yearsEl) yearsEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.y === y); });
      }

      if (yearsEl && years.length > 1) {
        yearsEl.style.display = '';
        yearsEl.innerHTML = years.map(function (y) {
          return '<button data-y="' + esc(y) + '">' + esc(y) + '</button>';
        }).join('');
        yearsEl.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () { showYear(b.dataset.y); };
        });
      }
      showYear(years[0]);
    }).catch(function () {}); // fallback markup stands
  }

  /* ---- Giving campaigns (links from config.js DONATION_LINKS) ---- */
  var giveEl = document.getElementById('giveGrid');
  if (giveEl) {
    var LINKS = (window.ZBXI_CONFIG && window.ZBXI_CONFIG.DONATION_LINKS) || {};
    var CAMPAIGNS = [
      { key: 'annual_fund', icon: '🏛️', title: 'Annual Brotherhood Fund', blurb: 'Keeps the chapter running — rush, brotherhood events and day-to-day operations.' },
      { key: 'scholarship', icon: '🎓', title: 'Scholarship & Academics', blurb: 'Supports active brothers with books, fees and academic awards.' },
      { key: 'philanthropy', icon: '🤝', title: 'Philanthropy Drives', blurb: 'Fuels our service work in the Geneseo community and beyond.' }
    ];
    // Only advertise giving once a real link exists — a wall of "coming soon"
    // buttons advertises a gap. Tiles without a link are simply not shown.
    var live = CAMPAIGNS.filter(function (c) { return LINKS[c.key]; });
    if (!live.length) {
      giveEl.style.display = 'none';
    } else {
      giveEl.innerHTML = live.map(function (c) {
        return '<div class="give-tile">' +
          '<span class="give-tile__ic">' + c.icon + '</span>' +
          '<h4>' + c.title + '</h4><p>' + c.blurb + '</p>' +
          '<a class="btn btn--gold" href="' + esc(LINKS[c.key]) + '" target="_blank" rel="noopener">Give now</a>' +
        '</div>';
      }).join('');
    }
  }

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
      if (!rows || !rows.length) { caEl.textContent = '🔒 members'; clEl.textContent = '🔒 members'; return; }
      var active = rows.filter(function (b) {
        var grad = (b.registered && b.grad_year) ? b.grad_year
                 : (b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null));
        return grad != null && grad >= CUTOFF;
      }).length;
      caEl.textContent = active + ' brothers';
      clEl.textContent = (rows.length - active) + ' brothers';
    }).catch(function () { caEl.textContent = '🔒 members'; clEl.textContent = '🔒 members'; });
  }
})();
