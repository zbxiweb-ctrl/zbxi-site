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

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

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

  /* ---- Events: upcoming from the DB (public for anyone; members see all) ---- */
  var evEl = document.getElementById('eventsList');
  if (evEl) {
    var CAT_LABEL = { rush: 'Rush', philanthropy: 'Philanthropy', reunion: 'Reunion', meeting: 'Chapter Meeting', social: 'Social' };
    var renderEvents = function (rows) {
      var upcoming = (rows || []).filter(function (e) {
        var end = e.ends_at ? new Date(e.ends_at) : new Date(new Date(e.starts_at).getTime() + 3 * 3600 * 1000);
        return end.getTime() > Date.now();
      });
      if (!upcoming.length) {
        evEl.innerHTML = '<p class="page-empty">No upcoming events on the calendar yet — check back soon.</p>';
        return;
      }
      evEl.innerHTML = upcoming.map(function (e) {
        var d = new Date(e.starts_at);
        var mon = d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
        var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return '<article class="ev-card' + (e.is_public ? '' : ' ev-card--members') + '">' +
          '<div class="ev-card__date"><b>' + d.getDate() + '</b><span>' + mon + '</span><small>' + d.getFullYear() + '</small></div>' +
          '<div class="ev-card__body">' +
            '<span class="event__tag">' + (CAT_LABEL[e.category] || e.category) + (e.is_public ? '' : ' · members') + '</span>' +
            '<h3>' + esc(e.title) + '</h3>' +
            '<p class="ev-card__meta">' + time + (e.location ? ' · ' + esc(e.location) : '') + '</p>' +
            (e.description ? '<p>' + esc(e.description) + '</p>' : '') +
          '</div></article>';
      }).join('');
    };
    if (window.ZBXI && window.ZBXI.configured) {
      window.ZBXI.eventsList().then(renderEvents)
        .catch(function () { evEl.innerHTML = '<p class="page-empty">Could not load events.</p>'; });
    } else {
      evEl.innerHTML = '<p class="page-empty">The events calendar is being set up.</p>';
    }
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
    giveEl.innerHTML = CAMPAIGNS.map(function (c) {
      var url = LINKS[c.key];
      return '<div class="give-tile">' +
        '<span class="give-tile__ic">' + c.icon + '</span>' +
        '<h4>' + c.title + '</h4><p>' + c.blurb + '</p>' +
        (url ? '<a class="btn btn--gold" href="' + esc(url) + '" target="_blank" rel="noopener">Give now</a>'
             : '<span class="give-tile__soon">Online giving coming soon</span>') +
      '</div>';
    }).join('');
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
