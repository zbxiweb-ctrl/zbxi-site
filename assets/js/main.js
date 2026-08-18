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
      // Opening announces itself so the bell / account menu stand down. See the
      // long note in notify.js for why propagation alone can't do this.
      if (open) document.dispatchEvent(new CustomEvent('zbxi:menu', { detail: 'nav' }));
    };
    document.addEventListener('zbxi:menu', function (e) { if (e.detail !== 'nav') setNav(false); });
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

  /* ---- Members-only teasers: Mentoring + Worldwide Map ----
     Both pages were reachable from exactly one place on the whole site before
     this. Same three-branch shape as the gallery teaser above.

     UNLOCKED shows COUNTS ONLY. LOCKED carries no live data whatsoever — no
     names, cities, pins, employers, industries or mentor flags, and not even the
     aggregate counts. That isn't caution for its own sake: 37 distinct cities
     across the brothers who've filled one in means most cities hold exactly ONE
     person, so "2 brothers in Denver" on a public page is a re-identification
     vector against a semi-public alumni list. The locked copy leans on the
     already-public "320+ brothers" figure instead.

     Both counts come out of listVerifiedDetail(), which the roster already
     caches for 30 minutes, so these two sections add ZERO network requests.

     And deliberately NO Leaflet here: worldwide-map.js lazy-loads a CDN library
     and geocodes sequentially at <=1 request/sec, so 37 cities would be ~40
     seconds of Nominatim traffic on every single homepage load — and an OSM
     usage-policy problem. A teaser is a count and a button. */
  var MENTOR_LOCK = 'Brothers have volunteered to mentor, and others have asked for one. Sign in as a verified brother to see both lists.';
  var MAP_LOCK = 'Brothers have landed all over the world since 1993. Sign in as a verified brother to see the map and find who is near you.';

  function homeLock(id, msg, href, cta) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Brothers only</b>' +
      '<span>' + msg + '</span>' +
      '<a class="btn btn--gold" href="' + href + '">' + cta + '</a></div>';
  }
  function homeStats(id, stats, href, cta) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<div class="home-stats">' + stats.map(function (s) {
      return '<div class="home-stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
    }).join('') + '</div>' +
      '<p class="center" style="margin-top:1.8rem"><a class="btn btn--navy" href="' + href + '">' + cta + '</a></p>';
  }
  function homeTeasersLocked() {
    homeLock('mentorTeaser', MENTOR_LOCK, 'mentoring.html', 'Mentoring');
    homeLock('mapTeaser', MAP_LOCK, 'map.html', 'Open the map');
  }

  if (document.getElementById('mentorTeaser')) {
    if (!(window.ZBXI && window.ZBXI.configured)) {
      homeTeasersLocked();
    } else {
      window.ZBXI.amApprovedBrother().then(function (ok) {
        if (!ok) { homeTeasersLocked(); return; }
        window.ZBXI.listVerifiedDetail().then(function (rows) {
          rows = rows || [];
          var mentors = rows.filter(function (b) { return (b.open_to || []).indexOf('mentor') !== -1; });
          var fields = {}, cities = {}, placed = 0;
          mentors.forEach(function (b) { if (b.industry) fields[String(b.industry).trim()] = 1; });
          rows.forEach(function (b) {
            if (!b.city) return;
            placed++;
            cities[String(b.city).trim().toLowerCase()] = 1;
          });
          var nf = Object.keys(fields).length, nc = Object.keys(cities).length;

          if (mentors.length) {
            homeStats('mentorTeaser', [
              [mentors.length, mentors.length === 1 ? 'brother open to mentoring' : 'brothers open to mentoring'],
              [nf, nf === 1 ? 'field' : 'fields']
            ], 'mentoring.html', 'Open Mentoring →');
          } else {
            homeLock('mentorTeaser', 'Nobody has ticked “Being a Mentor” yet — raise your hand in My Profile and you will be the first.', 'mentoring.html', 'Open Mentoring');
          }

          if (nc) {
            homeStats('mapTeaser', [
              [nc, nc === 1 ? 'city' : 'cities'],
              [placed, placed === 1 ? 'brother on the map' : 'brothers on the map']
            ], 'map.html', 'Open the map →');
          } else {
            homeLock('mapTeaser', 'No cities on file yet — add your current city in My Profile to put the first pin on the map.', 'map.html', 'Open the map');
          }
        })['catch'](homeTeasersLocked);
      })['catch'](homeTeasersLocked);
    }
  }

  /* ---- Brother of the Month (upgrade67: chosen, not hashed) ----
     Until now this hashed the string "2026-8" and took hash % candidateCount over the
     brothers who had BOTH a photo and a bio — ten men out of 359. Two things were wrong
     with that beyond the arbitrariness: the count is part of the divisor, so an eleventh
     brother writing a bio moved every future pick AND silently swapped the current one
     mid-month; and nothing was recorded, so the same few recurred forever.

     Now: the crowned brother from botm_cycles, who stays up until someone replaces him.
     The hash survives only as a first-run fallback, so the section is never blank on the
     day this ships and never again after the first crowning. */
  var spotSec = document.getElementById('spotlight');
  var spotEl = document.getElementById('spotlightCard');
  if (spotSec && spotEl && window.ZBXI && window.ZBXI.configured) {
    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (ok) {
        Promise.all([
          window.ZBXI.listVerifiedDetail(),
          window.ZBXI.botmCurrent()
        ]).then(function (res) {
          var rows = res[0] || [], crowned = res[1];
          var byId = {};
          rows.forEach(function (b) { byId[b.id] = b; });

          var b = crowned && crowned.winner_brother ? byId[crowned.winner_brother] : null;
          if (!b) b = legacySpotlightPick(rows);
          if (!b) return;               // nothing to show at all: leave the section hidden

          spotSec.style.display = '';
          var sub = [b.pledge_class, b.grad_year ? 'Class of ' + b.grad_year : null,
                     [b.occupation, b.city].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
          var bio = b.bio || '';
          var excerpt = bio.length > 260 ? bio.slice(0, 260).replace(/\s+\S*$/, '') + '…' : bio;
          spotEl.innerHTML =
            '<div class="spot-card">' +
              (b.photo_url
                ? '<img class="spot-card__photo" src="' + esc(b.photo_url) + '" alt="">'
                : '<div class="spot-card__photo spot-card__photo--none" aria-hidden="true">🏅</div>') +
              '<div class="spot-card__body">' +
                '<h3>' + esc(b.full_name) + '</h3>' +
                '<p class="spot-card__sub">' + esc(sub) + '</p>' +
                (b.quote ? '<p class="spot-card__quote">“' + esc(b.quote) + '”</p>' : '') +
                (excerpt ? '<p class="spot-card__bio">' + esc(excerpt) + '</p>' : '') +
                '<button class="btn btn--navy" id="spotMore">Read his full profile →</button>' +
              '</div></div>';
          var more = document.getElementById('spotMore');
          if (more) more.onclick = function () {
            if (window.BrotherCard) window.BrotherCard.open({ id: b.id, full_name: b.full_name, pledge_class: b.pledge_class, role: b.role, role_term: b.role_term, photo_url: b.photo_url, registered: true }, { portal: '#brothers-portal' });
          };

          buildVotePanel(rows, byId);
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

  /* The old rotation, kept ONLY for the window between shipping this and the first
     crowning. Once a winner exists this is never reached again. */
  function legacySpotlightPick(rows) {
    var key = new Date().getFullYear() + '-' + (new Date().getMonth() + 1);
    var hash = 0, i;
    for (i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    var cands = (rows || []).filter(function (b) { return b.user_id && b.photo_url && b.bio; })
      .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
    return cands.length ? cands[hash % cands.length] : null;
  }

  /* ---- The vote for NEXT month ----
     Sits under the spotlight, members-only, because that is where a brother is already
     looking at the man who won. Percentages are live by the owner's decision; the ballot
     itself is never readable here — botm_tally returns counts only, and botm_votes returns
     a brother his own row and nothing else. */
  function buildVotePanel(rows, byId) {
    var host = document.getElementById('botmVote');
    if (!host) return;

    window.ZBXI.botmCycle().then(function (cycle) {
      if (!cycle) { host.style.display = 'none'; return; }   // no month open: no panel

      var closes = new Date(cycle.closes_at);
      var eligible = (rows || []).filter(function (b) { return b.user_id; })
        .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });

      Promise.all([
        window.ZBXI.botmTally(cycle.id),
        window.ZBXI.botmMyVote(cycle.id)
      ]).then(function (res) {
        var tally = res[0] || [], mine = res[1];
        var counts = {}, total = 0;
        tally.forEach(function (t) { counts[t.brother_id] = t; total += t.votes; });

        // Anyone with a vote first (most votes down), then the rest alphabetically — so
        // the race is readable without hiding the 100+ brothers nobody has picked yet.
        var ranked = eligible.slice().sort(function (a, z) {
          var av = (counts[a.id] || {}).votes || 0, zv = (counts[z.id] || {}).votes || 0;
          if (av !== zv) return zv - av;
          return a.full_name.localeCompare(z.full_name);
        });
        var withVotes = ranked.filter(function (b) { return (counts[b.id] || {}).votes; });
        var shown = withVotes.length ? withVotes : ranked.slice(0, 6);

        host.style.display = '';
        host.innerHTML =
          '<div class="botm">' +
            '<div class="botm__head">' +
              '<h3>Who should be next?</h3>' +
              '<p class="botm__meta">' +
                esc(total ? total + (total === 1 ? ' brother has voted' : ' brothers have voted') : 'No votes yet — be the first') +
                ' · closes ' + esc(closes.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })) +
              '</p>' +
            '</div>' +
            '<div class="botm__list">' +
              shown.map(function (b) { return nomineeRow(b, counts[b.id], mine); }).join('') +
            '</div>' +
            '<div class="botm__pick">' +
              '<label for="botmPick">Vote for someone else</label>' +
              '<select id="botmPick"><option value="">Choose a brother…</option>' +
                ranked.map(function (b) {
                  return '<option value="' + esc(b.id) + '"' + (b.id === mine ? ' selected' : '') + '>' +
                         esc(b.full_name) + (b.pledge_class ? ' · ' + esc(b.pledge_class) : '') + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<p class="botm__note" id="botmNote">Your vote is private — only the webmaster can see who you picked.</p>' +
          '</div>';

        function nomineeRow(b, t, myPick) {
          var votes = (t || {}).votes || 0;
          var pct = (t || {}).pct != null ? Number(t.pct) : 0;
          var isMine = b.id === myPick;
          return '<button class="botm-row' + (isMine ? ' is-mine' : '') + '" data-vote="' + esc(b.id) + '" type="button">' +
            (b.photo_url
              ? '<img class="botm-row__pic" src="' + esc(b.photo_url) + '" alt="">'
              : '<span class="botm-row__pic botm-row__pic--none" aria-hidden="true">' + esc((b.full_name || '?').charAt(0)) + '</span>') +
            '<span class="botm-row__body">' +
              '<span class="botm-row__name">' + esc(b.full_name) +
                (isMine ? ' <em>· your pick</em>' : '') + '</span>' +
              '<span class="botm-row__sub">' + esc(b.pledge_class || '') + '</span>' +
              '<span class="botm-row__bar"><span style="width:' + pct + '%"></span></span>' +
            '</span>' +
            '<span class="botm-row__pct">' + (votes ? pct + '%' : '—') + '</span>' +
          '</button>';
        }

        function cast(id) {
          var note = document.getElementById('botmNote');
          if (note) note.textContent = 'Saving…';
          window.ZBXI.botmVote(id).then(function (r) {
            if (r && r.error) {
              if (note) note.textContent = r.error.message || 'That vote was refused.';
              return;
            }
            buildVotePanel(rows, byId);      // re-read, so the bar shows the real tally
          });
        }

        host.querySelectorAll('[data-vote]').forEach(function (el) {
          el.onclick = function () { cast(el.getAttribute('data-vote')); };
        });
        var sel = document.getElementById('botmPick');
        if (sel) sel.onchange = function () { if (sel.value) cast(sel.value); };
      });
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

  /* The three DONATION_LINKS campaign tiles used to be built here. No links were ever
     configured, so the block hid itself and the home page said nothing about giving —
     while donations.html existed and worked. It is now a plain link in index.html; there
     is no JavaScript left to run, and DONATION_LINKS is no longer read by anything. */

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
