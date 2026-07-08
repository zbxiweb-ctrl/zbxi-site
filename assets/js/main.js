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

    /* -- RSVPs (members only) -- */
    var RSVPS = [], RSVP_ME = null, RSVP_DIR = {}, CAN_RSVP = false;
    function rsvpsFor(id) { return RSVPS.filter(function (r) { return r.event_id === id; }); }
    function iGo(id) { return RSVP_ME && RSVPS.some(function (r) { return r.event_id === id && r.user_id === RSVP_ME.id; }); }
    function rsvpBar(e) {
      if (!CAN_RSVP) return '';
      var rs = rsvpsFor(e.id);
      var names = rs.map(function (r) {
        var m = RSVP_DIR[r.user_id];
        return m ? m.full_name.split(' ')[0] : 'a brother';
      });
      var who = names.length ? '<small class="ev-rsvp__who">Going: ' + esc(names.slice(0, 6).join(', ')) + (names.length > 6 ? ' +' + (names.length - 6) : '') + '</small>' : '';
      return '<div class="ev-rsvp" data-rsvp="' + e.id + '">' +
        '<button class="ev-rsvp__btn' + (iGo(e.id) ? ' on' : '') + '">' + (iGo(e.id) ? '✓ I\'m going' : '✋ I\'m going') + '</button>' +
        '<b>' + rs.length + '</b> going' + who + '</div>';
    }
    function wireRsvps(scope) {
      scope.querySelectorAll('[data-rsvp]').forEach(function (bar) {
        var id = bar.dataset.rsvp;
        bar.querySelector('.ev-rsvp__btn').onclick = function () {
          if (!RSVP_ME) return;
          var going = iGo(id);
          var op = going ? window.ZBXI.unrsvp(id, RSVP_ME.id) : window.ZBXI.rsvp(id, RSVP_ME.id);
          if (going) RSVPS = RSVPS.filter(function (r) { return !(r.event_id === id && r.user_id === RSVP_ME.id); });
          else RSVPS.push({ event_id: id, user_id: RSVP_ME.id });
          renderEvents(EV_ALL);
          op.then(function (r) { if (r.error) window.ZBXI.rsvpList().then(function (l) { RSVPS = l; renderEvents(EV_ALL); }); });
        };
      });
    }
    function loadRsvps() {
      window.ZBXI.amApprovedBrother().then(function (ok) {
        if (!ok) return;
        Promise.all([window.ZBXI.getUser(), window.ZBXI.rsvpList(), window.ZBXI.memberDirectory()]).then(function (res) {
          RSVP_ME = res[0]; RSVPS = res[1]; RSVP_DIR = res[2] || {};
          CAN_RSVP = true;
          renderEvents(EV_ALL);
        });
      });
    }

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
            rsvpBar(e) +
          '</div></article>';
      }).join('');
      wireRsvps(evEl);
    };
    /* -- month calendar view -- */
    var monthEl = document.getElementById('eventsMonth');
    var toggleEl = document.getElementById('evToggle');
    var EV_ALL = [];
    var cal = (function () { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

    function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

    function renderMonth() {
      if (!monthEl) return;
      var first = new Date(cal.y, cal.m, 1);
      var today = new Date();
      var startDow = (first.getDay() + 6) % 7; // Monday-first
      var daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
      var title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      var head = '<div class="cal-head">' +
        '<button class="cal-nav" data-cal="-1" aria-label="Previous month">‹</button>' +
        '<b>' + title + '</b>' +
        '<button class="cal-nav" data-cal="1" aria-label="Next month">›</button></div>';

      var dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span class="cal-dow">' + d + '</span>'; }).join('');

      var cells = '';
      for (var i = 0; i < startDow; i++) cells += '<span class="cal-cell cal-cell--pad"></span>';
      for (var day = 1; day <= daysInMonth; day++) {
        var date = new Date(cal.y, cal.m, day);
        var evs = EV_ALL.filter(function (e) { return sameDay(new Date(e.starts_at), date); });
        var chips = evs.slice(0, 2).map(function (e) {
          return '<span class="cal-chip cal-chip--' + e.category + '">' + esc(e.title) + '</span>';
        }).join('') + (evs.length > 2 ? '<span class="cal-more">+' + (evs.length - 2) + '</span>' : '');
        cells += '<button class="cal-cell' + (sameDay(date, today) ? ' cal-cell--today' : '') + (evs.length ? ' cal-cell--has' : '') + '" data-day="' + day + '">' +
          '<span class="cal-cell__n">' + day + '</span>' + chips + '</button>';
      }

      monthEl.innerHTML = head + '<div class="cal-grid">' + dows + cells + '</div><div class="cal-detail" id="calDetail"></div>';

      monthEl.querySelectorAll('[data-cal]').forEach(function (b) {
        b.onclick = function () {
          cal.m += parseInt(b.dataset.cal, 10);
          if (cal.m < 0) { cal.m = 11; cal.y--; }
          if (cal.m > 11) { cal.m = 0; cal.y++; }
          renderMonth();
        };
      });
      monthEl.querySelectorAll('.cal-cell--has').forEach(function (c) {
        c.onclick = function () { showDay(parseInt(c.dataset.day, 10)); };
      });
    }

    function showDay(day) {
      var date = new Date(cal.y, cal.m, day);
      var evs = EV_ALL.filter(function (e) { return sameDay(new Date(e.starts_at), date); });
      var box = document.getElementById('calDetail');
      if (!box || !evs.length) return;
      box.innerHTML = '<h4>' + date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + '</h4>' +
        evs.map(function (e) {
          var t = new Date(e.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          return '<div class="cal-detail__ev"><span class="event__tag">' + (CAT_LABEL[e.category] || e.category) + (e.is_public ? '' : ' · members') + '</span>' +
            '<b>' + esc(e.title) + '</b><small>' + t + (e.location ? ' · ' + esc(e.location) : '') + '</small>' +
            (e.description ? '<p>' + esc(e.description) + '</p>' : '') + rsvpBar(e) + '</div>';
        }).join('');
      wireRsvps(box);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (toggleEl) {
      toggleEl.querySelectorAll('[data-view]').forEach(function (b) {
        b.onclick = function () {
          toggleEl.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          var month = b.dataset.view === 'month';
          evEl.style.display = month ? 'none' : '';
          if (monthEl) monthEl.style.display = month ? '' : 'none';
          if (month) renderMonth();
        };
      });
    }

    if (window.ZBXI && window.ZBXI.configured) {
      window.ZBXI.eventsList().then(function (rows) {
        EV_ALL = rows || [];
        renderEvents(EV_ALL);
        loadRsvps();
      }).catch(function () { evEl.innerHTML = '<p class="page-empty">Could not load events.</p>'; });
    } else {
      evEl.innerHTML = '<p class="page-empty">The events calendar is being set up.</p>';
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
        // Public teaser (only when there are registered brothers to feature)
        window.ZBXI.listFamilyPublic().then(function (rows) {
          if (!(rows || []).some(function (r) { return r.registered; })) return;
          spotSec.style.display = '';
          spotEl.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🏅 <b>This month\'s featured brother</b>' +
            '<span>Every month we spotlight one brother\'s story — where the brotherhood took him. Sign in to read it.</span>' +
            '<a class="btn btn--gold" href="#brothers-portal">Brother sign in</a></div>';
        });
      }
    });
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
