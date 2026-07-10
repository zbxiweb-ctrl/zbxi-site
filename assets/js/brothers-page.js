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
    var extra = [b.city, b.occupation, b.company].filter(Boolean).join(' · ');
    var OT_IC = { mentor: '🎓', hire: '💼', connect: '🤝' };
    var ot = (b.open_to || []).filter(function (k) { return OT_IC[k]; })
      .map(function (k) { return '<i class="bro-card__ot" title="Open to ' + (k === 'mentor' ? 'mentoring' : k === 'hire' ? 'hiring & referrals' : 'connecting') + '">' + OT_IC[k] + '</i>'; }).join('');
    return '<button class="bro-card' + (reg ? ' bro-card--live' : '') + '" data-id="' + b.id + '">' +
      '<span class="bro-card__av">' + av + (reg ? '<i class="bro-card__dot"></i>' : '') + '</span>' +
      '<span class="bro-card__meta"><b>' + esc(b.full_name) + (ot ? ' <span class="bro-card__ots">' + ot + '</span>' : '') + '</b>' +
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

  var ALL_ROWS = [];
  function wire(scope) {
    scope.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var b = ALL_ROWS.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
      });
    });
  }

  function ebOrder(a, z) {
    return EBOARD_ORDER.indexOf(String(a.role).toLowerCase().replace(/\s+/g, '-')) -
           EBOARD_ORDER.indexOf(String(z.role).toLowerCase().replace(/\s+/g, '-'));
  }

  function render(all) {
    ALL_ROWS = all;
    var side = all.filter(MODE === 'active' ? isActive : function (b) { return !isActive(b); });
    // E-boards are assigned explicitly (role + which board), independent of
    // the grad-year page split — the Active and Alumni boards are separate.
    EB = all.filter(function (b) { return b.role && b.role_scope === MODE; }).sort(ebOrder);
    LIST = side.slice().sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
    if (MODE === 'alumni') renderPrevBoard(all);

    if (countEl) countEl.textContent = side.length + (MODE === 'active' ? ' active brothers' : ' alumni brothers');
    if (eboardEl) {
      eboardEl.innerHTML = EB.length ? EB.map(eboardCard).join('')
        : '<p class="page-empty">E-board positions will appear here once assigned' + (MODE === 'active' ? '.' : ' for the alumni board.') + '</p>';
      wire(eboardEl);
    }
    renderFilters();
    renderGrid();
  }

  /* ---- Previous Executive Board (alumni page): filterable by title ---- */
  var PREV_F = '';
  function renderPrevBoard(all) {
    var sec = document.getElementById('prevEboard');
    var grid = document.getElementById('prevGrid');
    var chipsEl = document.getElementById('prevChips');
    if (!sec || !grid) return;
    var prev = all.filter(function (b) { return b.role && b.role_scope === 'previous'; })
      .sort(function (a, z) { return ebOrder(a, z) || String(z.role_term || '').localeCompare(String(a.role_term || '')); });
    if (!prev.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    var TITLES = ['President', 'Vice-President', 'Treasurer', 'Secretary'];
    chipsEl.innerHTML = '<button class="fam-chip' + (!PREV_F ? ' on' : '') + '" data-pf="">All titles</button>' +
      TITLES.map(function (t) {
        return '<button class="fam-chip' + (PREV_F === t ? ' on' : '') + '" data-pf="' + t + '">' + t + '</button>';
      }).join('');
    chipsEl.querySelectorAll('[data-pf]').forEach(function (c) {
      c.onclick = function () { PREV_F = c.dataset.pf; renderPrevBoard(all); };
    });
    var rows = PREV_F ? prev.filter(function (b) { return b.role === PREV_F; }) : prev;
    grid.innerHTML = rows.length ? rows.map(eboardCard).join('')
      : '<p class="page-empty">No previous ' + esc(PREV_F) + 's recorded yet.</p>';
    wire(grid);
  }

  if (searchEl) searchEl.addEventListener('input', function () { F.q = searchEl.value.trim().toLowerCase(); renderGrid(); });

  /* ---- member hydration: photos, city, occupation for approved viewers ---- */
  var RAW = [], ME = null;   // ME = the viewer's own brother row (drives discovery)
  function hydrate() {
    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (!ok) return;
      Promise.all([window.ZBXI.listVerifiedDetail(), window.ZBXI.getUser()]).then(function (res) {
        var rows = res[0], user = res[1];
        var det = {};
        (rows || []).forEach(function (d) { det[d.id] = d; });
        RAW.forEach(function (b) {
          var d = det[b.id];
          if (!d) return;
          b.photo_url = d.photo_url; b.city = d.city; b.occupation = d.occupation;
          b.role_term = d.role_term; b.skills = d.skills; b.major = d.major;
          b.company = d.company; b.industry = d.industry; b.open_to = d.open_to;
          b.user_id = d.user_id;
        });
        ME = user ? (rows || []).filter(function (d) { return d.user_id === user.id; })[0] || null : null;
        APPROVED = true;
        render(RAW);
        renderMentorFinder();
        renderDiscovery();
        renderClassIndex();
        // Hand the hydrated roster to other scripts (e.g. the alumni map).
        window.ZBXI_MEMBERS = RAW;
        document.dispatchEvent(new CustomEvent('zbxi:hydrated'));
      });
    });
  }

  /* ---- discovery rails: brothers in your field / near you ---- */
  function renderDiscovery() {
    var sec = document.getElementById('discoverRail');
    if (!sec || !APPROVED) return;
    if (!ME || (!ME.industry && !ME.city)) {
      sec.style.display = '';
      sec.innerHTML = '<p class="eyebrow">🧭 Discover</p>' +
        '<div class="disc-empty">Add your <b>industry</b> and <b>current city</b> to your profile and this fills with brothers who share them.' +
        ' <a href="index.html#my-profile">Complete my profile →</a></div>';
      return;
    }
    var others = ALL_ROWS.filter(function (b) { return !ME || b.id !== ME.id; });
    var field = ME.industry
      ? others.filter(function (b) { return b.industry && b.industry === ME.industry; }) : [];
    var near = ME.city
      ? others.filter(function (b) { return b.city && b.city.toLowerCase() === ME.city.toLowerCase(); }) : [];

    var html = '<p class="eyebrow">🧭 Discover</p>';
    function rail(title, rows, emptyMsg) {
      if (!rows.length) return '<div class="disc-rail"><h4>' + title + '</h4><p class="disc-none">' + emptyMsg + '</p></div>';
      return '<div class="disc-rail"><h4>' + title + ' <i>' + rows.length + '</i></h4>' +
        '<div class="disc-scroll">' + rows.slice(0, 12).map(card).join('') + '</div></div>';
    }
    if (ME.industry) html += rail('Brothers in ' + esc(ME.industry), field, 'No other brothers have listed this field yet.');
    if (ME.city) html += rail('Brothers near ' + esc(ME.city), near, 'No other brothers list this city yet.');
    sec.style.display = '';
    sec.innerHTML = html;
    wire(sec);
  }

  /* ---- reunion / pledge-class index (alumni page) ---- */
  function renderClassIndex() {
    var sec = document.getElementById('classIndex');
    if (!sec || MODE !== 'alumni') return;
    var counts = {};
    ALL_ROWS.forEach(function (b) {
      if (b.pledge_class) counts[b.pledge_class] = (counts[b.pledge_class] || 0) + 1;
    });
    var classes = Object.keys(counts).sort(function (a, z) {
      return (pledgeYear(z) || 0) - (pledgeYear(a) || 0) || a.localeCompare(z);
    });
    if (!classes.length) return;
    sec.style.display = '';
    sec.innerHTML = '<p class="eyebrow">🎓 Reunions &amp; Pledge Classes</p>' +
      '<p class="lede" style="margin-bottom:1rem">Every class has its own page — the brothers who crossed together, and a thread to plan the next reunion.</p>' +
      '<div class="class-chips">' + classes.map(function (c) {
        return '<a class="class-chip" href="class.html?c=' + encodeURIComponent(c) + '">' + esc(c) + ' <i>' + counts[c] + '</i></a>';
      }).join('') + '</div>';
  }

  /* ---- mentorship finder (alumni page, members only) ---- */
  function renderMentorFinder() {
    if (MODE !== 'alumni' || !APPROVED) return;
    var sec = document.getElementById('mentorFinder');
    var grid = document.getElementById('mentorGrid');
    var input = document.getElementById('mentorSearch');
    var chipsEl = document.getElementById('mentorChips');
    if (!sec || !grid || !input) return;
    var pool = LIST.filter(function (b) { return b.skills || b.occupation || b.industry; });
    if (!pool.length) return; // stays hidden until profiles carry skills/occupations
    sec.style.display = '';

    // Brothers who flagged "open to mentoring" float to the front of the pool.
    pool.sort(function (a, z) {
      var am = (a.open_to || []).indexOf('mentor') !== -1 ? 0 : 1;
      var zm = (z.open_to || []).indexOf('mentor') !== -1 ? 0 : 1;
      return am - zm;
    });

    var chips = uniqueSorted(pool.map(function (b) { return b.industry; }).concat(
      pool.map(function (b) { return b.occupation; }))).slice(0, 6);
    if (chipsEl) {
      chipsEl.innerHTML = chips.map(function (c) { return '<button class="fam-chip" data-mc="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
      chipsEl.querySelectorAll('[data-mc]').forEach(function (c) {
        c.onclick = function () { input.value = c.dataset.mc; show(c.dataset.mc.toLowerCase()); };
      });
    }

    function show(q) {
      var hits = q
        ? pool.filter(function (b) {
            return ((b.skills || '') + ' ' + (b.occupation || '') + ' ' + (b.major || '') + ' ' +
                    (b.industry || '') + ' ' + (b.company || '')).toLowerCase().indexOf(q) !== -1;
          })
        : pool;
      grid.innerHTML = hits.length ? hits.map(card).join('')
        : '<p class="page-empty">No alumni match that yet — try a broader term.</p>';
      wire(grid);
    }
    input.addEventListener('input', function () { show(input.value.trim().toLowerCase()); });
    show('');
    wireNetHelp();
    wireMentorRequest();
  }

  /* ---- request a mentor: state a field + goal, up to 5 matching alumni get a 🔔 ---- */
  var INDUSTRIES = ['Finance & Banking', 'Technology & Software', 'Healthcare & Medicine',
    'Law & Government', 'Engineering', 'Education', 'Marketing & Media',
    'Sales & Business Dev', 'Real Estate & Construction', 'Science & Research',
    'Arts & Entertainment', 'Military & Public Service', 'Other'];

  function wireMentorRequest() {
    var btn = document.getElementById('mentorReqBtn');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.style.display = '';
    btn.onclick = function () {
      var m = document.getElementById('mentorReqModal');
      if (!m) { m = document.createElement('div'); m.id = 'mentorReqModal'; m.className = 'pmodal'; document.body.appendChild(m); }
      m.innerHTML = '<div class="pmodal__card card-form">' +
        '<button class="pmodal__close" data-mr aria-label="Close">✕</button>' +
        '<h3 style="color:var(--navy);font-family:var(--display);margin-top:0">Request a mentor</h3>' +
        '<p class="form-note" style="margin-top:0">We\'ll notify up to five alumni who said they\'re open to mentoring in this field. They get your name and email, and can reply to you directly.</p>' +
        '<div class="field"><label>What field?</label><select id="mrField">' +
          INDUSTRIES.map(function (i) { return '<option>' + i + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>What are you hoping for? (optional)</label>' +
          '<textarea id="mrNote" maxlength="160" placeholder="e.g. Advice on breaking into investment banking after graduation"></textarea></div>' +
        '<button class="btn btn--gold" id="mrSend" style="width:100%">🎓 Send my request</button>' +
        '<p class="form-status" id="mrStatus"></p></div>';
      m.classList.add('open');
      m.setAttribute('aria-hidden', 'false');
      function close() { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
      m.querySelector('[data-mr]').onclick = close;
      m.addEventListener('click', function (x) { if (x.target === m) close(); });

      m.querySelector('#mrSend').onclick = function () {
        var send = m.querySelector('#mrSend'), st = m.querySelector('#mrStatus');
        send.disabled = true; send.textContent = 'Sending…';
        st.className = 'form-status'; st.textContent = '';
        window.ZBXI.mentorRequest(m.querySelector('#mrField').value, m.querySelector('#mrNote').value.trim())
          .then(function (res) {
            if (res === 'already') { st.className = 'form-status err'; st.textContent = 'You already sent a mentor request this week — give them a few days to reply.'; }
            else if (res === 'none') { st.className = 'form-status err'; st.textContent = 'No alumni have raised the “open to mentoring” flag in that field yet. Try a nearby field, or reach out directly with 🤝 Connect.'; }
            else { st.className = 'form-status ok'; st.textContent = '✓ Sent to ' + res + ' brother' + (res === '1' ? '' : 's') + ' — watch your inbox for a reply.'; }
            send.textContent = 'Sent';
          })
          .catch(function (e) {
            st.className = 'form-status err'; st.textContent = (e && e.message) || 'Could not send.';
            send.disabled = false; send.textContent = '🎓 Send my request';
          });
      };
    };
  }

  /* ---- "How networking works" — plain-English member brief ---- */
  function wireNetHelp() {
    var btn = document.getElementById('netHelpBtn');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.onclick = function () {
      var m = document.getElementById('netHelpModal');
      if (!m) { m = document.createElement('div'); m.id = 'netHelpModal'; m.className = 'pmodal'; document.body.appendChild(m); }
      m.innerHTML = '<div class="pmodal__card card-form">' +
        '<button class="pmodal__close" data-nh aria-label="Close">✕</button>' +
        '<h3 style="color:var(--navy);font-family:var(--display);margin-top:0">How networking works</h3>' +
        '<div class="cal-helpbody">' +
        '<p><b>1 · Fill in your profile.</b> Click your name in the top-right → My Profile. Your industry, city, company, and LinkedIn are what make you findable — the meter at the top shows what\'s missing.</p>' +
        '<p><b>2 · Raise your hand.</b> Tick the "I\'m open to…" boxes: 🎓 mentoring actives, 💼 hiring &amp; referrals, 🤝 connecting. They show as badges next to your name so brothers know it\'s welcome to reach out.</p>' +
        '<p><b>3 · Find brothers.</b> Search here by field ("finance", "law school", "engineer") or browse the directory filters. Brothers open to mentoring appear first. The <b>🧭 Discover</b> rails at the top show brothers who share your industry or city automatically.</p>' +
        '<p><b>4 · Press Connect.</b> On any brother\'s card, the 🤝 Connect button drops your name and email into his notifications — he just replies to your email. No inbox to check, nothing complicated.</p>' +
        '<p><b>5 · Or ask the room.</b> <b>🎓 Request a mentor</b> notifies up to five alumni who volunteered to mentor in that field — you don\'t have to know who to ask.</p>' +
        '<p><b>Privacy:</b> all of this is brothers-only. The public sees none of it, and your contact details only show what you chose under "Reach me via".</p>' +
        '</div></div>';
      m.classList.add('open');
      m.setAttribute('aria-hidden', 'false');
      m.querySelector('[data-nh]').onclick = function () { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); };
      m.addEventListener('click', function (x) { if (x.target === m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); } });
    };
  }

  /* ---- load ---- */
  function lockedRoster() {
    var lock = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Members only</b>' +
      '<span>The brotherhood roster is private. Brothers sign in to browse names, classes and profiles.</span>' +
      '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a></div>';
    gridEl.innerHTML = lock;
    if (eboardEl) eboardEl.innerHTML = '<p class="page-empty">Members only.</p>';
    if (searchEl) searchEl.style.display = 'none';
    if (filtersEl) filtersEl.style.display = 'none';
  }

  if (window.ZBXI && window.ZBXI.configured) {
    window.ZBXI.listFamilyPublic().then(function (rows) {
      if (rows && rows.length) { RAW = rows; render(RAW); hydrate(); }
      else lockedRoster(); // anon gets an empty result — names are members-only
    }).catch(function () { lockedRoster(); });
  } else {
    gridEl.innerHTML = '<p class="page-empty">Members area is being set up — check back soon.</p>';
  }
})();
