/* Active / Alumni brothers page. Mode comes from <body data-mode="active|alumni">.
   - registered brothers use their profile grad_year (authoritative)
   - unregistered brothers are inferred from pledge class year + 4
   E-board renders first; searchable + filterable grid follows. Approved
   signed-in brothers get photo thumbnails and location/profession filters
   (hydrated from the full member data). Modal = shared BrotherCard. */
(function () {
  'use strict';
  var MODE = document.body.dataset.mode; // 'active' | 'alumni'
  var eboardEl = document.getElementById('pageEboard');
  var gridEl = document.getElementById('pageGrid');
  var countEl = document.getElementById('pageCount');
  var searchEl = document.getElementById('pageSearch');
  var filtersEl = document.getElementById('pageFilters');
  if (!gridEl) return;

  var EBOARD_ORDER = ['president', 'vice-president', 'treasurer', 'secretary'];

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function initials(name) { return window.BrotherCard ? window.BrotherCard.initials(name) : 'ΖΒΞ'; }

  // Academic cutoff: after May, this year's class has graduated.
  var now = new Date();
  var CUTOFF = now.getFullYear() + (now.getMonth() >= 5 ? 1 : 0);

  // Parse a year out of a pledge class like "Gamma Rho · Fall '25" or "… Spring 1993".
  function pledgeYear(cls) {
    if (!cls) return null;
    var m4 = cls.match(/(19|20)\d{2}/);
    if (m4) return parseInt(m4[0], 10);
    var m2 = cls.match(/'(\d{2})/);
    if (!m2) return null;
    var yy = parseInt(m2[1], 10);
    return yy >= 93 ? 1900 + yy : 2000 + yy;
  }

  function isActive(b) {
    var grad = b.registered && b.grad_year ? b.grad_year
             : (b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null));
    if (grad == null) return false; // unknown -> alumni (safest for a 30-yr-old chapter)
    return grad >= CUTOFF;
  }

  function card(b) {
    var reg = b.registered;
    var av = b.photo_url
      ? '<img src="' + esc(b.photo_url) + '" alt="">'
      : esc(initials(b.full_name));
    var extra = [b.city, b.occupation].filter(Boolean).join(' · ');
    return '<button class="bro-card' + (reg ? ' bro-card--live' : '') + '" data-id="' + b.id + '">' +
      '<span class="bro-card__av">' + av + (reg ? '<i class="bro-card__dot"></i>' : '') + '</span>' +
      '<span class="bro-card__meta"><b>' + esc(b.full_name) + '</b>' +
        '<small>' + esc(b.pledge_class || '') + (b.grad_year ? " · Class of " + esc(b.grad_year) : '') + '</small>' +
        (extra ? '<small class="bro-card__extra">' + esc(extra) + '</small>' : '') +
        (reg ? '<em class="bro-card__tag">● on the site</em>' : '<em class="bro-card__tag bro-card__tag--off">unclaimed</em>') +
      '</span></button>';
  }

  function eboardCard(b) {
    var av = b.photo_url ? '<img src="' + esc(b.photo_url) + '" alt="">' : esc(initials(b.full_name));
    var roleLine = esc(b.role) + (b.role_term ? ' · ' + esc(b.role_term) : '');
    return '<button class="eb-card' + (b.registered ? ' bro-card--live' : '') + '" data-id="' + b.id + '">' +
      '<span class="eb-card__av">' + av + '</span>' +
      '<b>' + esc(b.full_name) + '</b>' +
      '<span class="eb-card__role">' + roleLine + '</span>' +
      '<small>' + esc(b.pledge_class || '') + '</small></button>';
  }

  /* ---- filters ---- */
  var LIST = [], EB = [], APPROVED = false;
  var F = { q: '', year: '', city: '', occupation: '' };

  function applyFilters() {
    var rows = LIST;
    if (F.q) rows = rows.filter(function (b) { return (b.full_name + ' ' + (b.pledge_class || '')).toLowerCase().indexOf(F.q) !== -1; });
    if (F.year) rows = rows.filter(function (b) {
      var y = b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null);
      return String(y) === F.year;
    });
    if (F.city) rows = rows.filter(function (b) { return (b.city || '') === F.city; });
    if (F.occupation) rows = rows.filter(function (b) { return (b.occupation || '') === F.occupation; });
    return rows;
  }

  function renderGrid() {
    var rows = applyFilters();
    gridEl.innerHTML = rows.length ? rows.map(card).join('')
      : '<p class="page-empty">' + (F.q || F.year || F.city || F.occupation ? 'No matches.' : 'No brothers here yet.') + '</p>';
    wire(gridEl);
  }

  function uniqueSorted(vals) {
    var seen = {};
    return vals.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; })
      .sort(function (a, z) { return String(a).localeCompare(String(z)); });
  }

  function renderFilters() {
    if (!filtersEl) return;
    var years = uniqueSorted(LIST.map(function (b) {
      return b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null);
    })).reverse();
    var html = '<select id="fYear" class="page-filter"><option value="">Class year — all</option>' +
      years.map(function (y) { return '<option' + (String(y) === F.year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>';

    if (APPROVED) {
      var cities = uniqueSorted(LIST.map(function (b) { return b.city; }));
      var jobs = uniqueSorted(LIST.map(function (b) { return b.occupation; }));
      html += '<select id="fCity" class="page-filter"><option value="">Location — all</option>' +
        cities.map(function (c) { return '<option' + (c === F.city ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>';
      html += '<select id="fJob" class="page-filter"><option value="">Profession — all</option>' +
        jobs.map(function (j) { return '<option' + (j === F.occupation ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('') + '</select>';
    } else {
      html += '<span class="page-filter-hint">🔒 Sign in to filter by location &amp; profession</span>';
    }
    filtersEl.innerHTML = html;

    var fy = filtersEl.querySelector('#fYear');
    if (fy) fy.onchange = function () { F.year = fy.value; renderGrid(); };
    var fc = filtersEl.querySelector('#fCity');
    if (fc) fc.onchange = function () { F.city = fc.value; renderGrid(); };
    var fj = filtersEl.querySelector('#fJob');
    if (fj) fj.onchange = function () { F.occupation = fj.value; renderGrid(); };
  }

  function wire(scope) {
    scope.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var b = LIST.filter(function (x) { return x.id === el.dataset.id; })[0] ||
                EB.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
      });
    });
  }

  function render(all) {
    var side = all.filter(MODE === 'active' ? isActive : function (b) { return !isActive(b); });
    EB = side.filter(function (b) { return b.role && EBOARD_ORDER.indexOf(String(b.role).toLowerCase().replace(/\s+/g, '-')) !== -1; })
      .sort(function (a, z) { return EBOARD_ORDER.indexOf(a.role.toLowerCase().replace(/\s+/g, '-')) - EBOARD_ORDER.indexOf(z.role.toLowerCase().replace(/\s+/g, '-')); });
    LIST = side.slice().sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });

    if (countEl) countEl.textContent = side.length + (MODE === 'active' ? ' active brothers' : ' alumni brothers');
    if (eboardEl) {
      eboardEl.innerHTML = EB.length ? EB.map(eboardCard).join('')
        : '<p class="page-empty">E-board positions will appear here once assigned' + (MODE === 'active' ? '.' : ' for the alumni board.') + '</p>';
      wire(eboardEl);
    }
    renderFilters();
    renderGrid();
  }

  if (searchEl) searchEl.addEventListener('input', function () { F.q = searchEl.value.trim().toLowerCase(); renderGrid(); });

  /* ---- member hydration: photos, city, occupation for approved viewers ---- */
  var RAW = [];
  function hydrate() {
    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (!ok) return;
      window.ZBXI.listVerifiedDetail().then(function (rows) {
        var det = {};
        (rows || []).forEach(function (d) { det[d.id] = d; });
        RAW.forEach(function (b) {
          var d = det[b.id];
          if (!d) return;
          b.photo_url = d.photo_url; b.city = d.city; b.occupation = d.occupation;
          b.role_term = d.role_term; b.skills = d.skills; b.major = d.major;
        });
        APPROVED = true;
        render(RAW);
        renderMentorFinder();
        // Hand the hydrated roster to other scripts (e.g. the alumni map).
        window.ZBXI_MEMBERS = RAW;
        document.dispatchEvent(new CustomEvent('zbxi:hydrated'));
      });
    });
  }

  /* ---- mentorship finder (alumni page, members only) ---- */
  function renderMentorFinder() {
    if (MODE !== 'alumni' || !APPROVED) return;
    var sec = document.getElementById('mentorFinder');
    var grid = document.getElementById('mentorGrid');
    var input = document.getElementById('mentorSearch');
    var chipsEl = document.getElementById('mentorChips');
    if (!sec || !grid || !input) return;
    var pool = LIST.filter(function (b) { return b.skills || b.occupation; });
    if (!pool.length) return; // stays hidden until profiles carry skills/occupations
    sec.style.display = '';

    var chips = uniqueSorted(pool.map(function (b) { return b.occupation; })).slice(0, 6);
    if (chipsEl) {
      chipsEl.innerHTML = chips.map(function (c) { return '<button class="fam-chip" data-mc="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
      chipsEl.querySelectorAll('[data-mc]').forEach(function (c) {
        c.onclick = function () { input.value = c.dataset.mc; show(c.dataset.mc.toLowerCase()); };
      });
    }

    function show(q) {
      var hits = q
        ? pool.filter(function (b) {
            return ((b.skills || '') + ' ' + (b.occupation || '') + ' ' + (b.major || '')).toLowerCase().indexOf(q) !== -1;
          })
        : pool;
      grid.innerHTML = hits.length ? hits.map(card).join('')
        : '<p class="page-empty">No alumni match that yet — try a broader term.</p>';
      wire(grid);
    }
    input.addEventListener('input', function () { show(input.value.trim().toLowerCase()); });
    show('');
  }

  /* ---- load ---- */
  if (window.ZBXI && window.ZBXI.configured) {
    window.ZBXI.listFamilyPublic().then(function (rows) {
      if (rows && rows.length) { RAW = rows; render(RAW); hydrate(); }
      else gridEl.innerHTML = '<p class="page-empty">The brotherhood roster hasn\'t been imported yet.</p>';
    }).catch(function () { gridEl.innerHTML = '<p class="page-empty">Could not load the roster. Try refreshing.</p>'; });
  } else {
    gridEl.innerHTML = '<p class="page-empty">Members area is being set up — check back soon.</p>';
  }
})();
