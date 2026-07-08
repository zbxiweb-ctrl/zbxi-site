/* Active / Alumni brothers page. Mode comes from <body data-mode="active|alumni">.
   Shows ALL brothers on the correct side of the graduation line:
   - registered brothers use their profile grad_year (authoritative)
   - unregistered brothers are inferred from pledge class year + 4
   E-board (President / Vice-President / Treasurer / Secretary) renders first.
   Registered cards are "live" (click -> gated detail modal); unregistered cards
   invite the brother to claim their profile. */
(function () {
  'use strict';
  var MODE = document.body.dataset.mode; // 'active' | 'alumni'
  var eboardEl = document.getElementById('pageEboard');
  var gridEl = document.getElementById('pageGrid');
  var countEl = document.getElementById('pageCount');
  var searchEl = document.getElementById('pageSearch');
  if (!gridEl) return;

  var EBOARD_ORDER = ['president', 'vice-president', 'treasurer', 'secretary'];

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function initials(name) { return String(name || '').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase() || 'ΖΒΞ'; }

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
    return '<button class="bro-card' + (reg ? ' bro-card--live' : '') + '" data-id="' + b.id + '">' +
      '<span class="bro-card__av">' + esc(initials(b.full_name)) + (reg ? '<i class="bro-card__dot"></i>' : '') + '</span>' +
      '<span class="bro-card__meta"><b>' + esc(b.full_name) + '</b>' +
        '<small>' + esc(b.pledge_class || '') + (b.grad_year ? " · Class of " + esc(b.grad_year) : '') + '</small>' +
        (reg ? '<em class="bro-card__tag">● on the site</em>' : '<em class="bro-card__tag bro-card__tag--off">unclaimed</em>') +
      '</span></button>';
  }

  function eboardCard(b) {
    return '<button class="eb-card' + (b.registered ? ' bro-card--live' : '') + '" data-id="' + b.id + '">' +
      '<span class="eb-card__av">' + esc(initials(b.full_name)) + '</span>' +
      '<b>' + esc(b.full_name) + '</b>' +
      '<span class="eb-card__role">' + esc(b.role) + '</span>' +
      '<small>' + esc(b.pledge_class || '') + '</small></button>';
  }

  var LIST = [];
  function renderGrid(q) {
    var rows = LIST;
    if (q) rows = rows.filter(function (b) { return (b.full_name + ' ' + (b.pledge_class || '')).toLowerCase().indexOf(q) !== -1; });
    gridEl.innerHTML = rows.length ? rows.map(card).join('')
      : '<p class="page-empty">' + (q ? 'No matches.' : 'No brothers here yet.') + '</p>';
    wire(gridEl);
  }

  function wire(scope) {
    scope.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var b = LIST.filter(function (x) { return x.id === el.dataset.id; })[0] ||
                EB.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (b) openProfile(b);
      });
    });
  }

  var EB = [];
  function render(all) {
    var side = all.filter(MODE === 'active' ? isActive : function (b) { return !isActive(b); });
    // E-board: titled brothers on this side, in fixed order
    EB = side.filter(function (b) { return b.role && EBOARD_ORDER.indexOf(String(b.role).toLowerCase().replace(/\s+/g, '-')) !== -1; })
      .sort(function (a, z) { return EBOARD_ORDER.indexOf(a.role.toLowerCase().replace(/\s+/g, '-')) - EBOARD_ORDER.indexOf(z.role.toLowerCase().replace(/\s+/g, '-')); });
    LIST = side.slice().sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });

    if (countEl) countEl.textContent = side.length + (MODE === 'active' ? ' active brothers' : ' alumni brothers');
    if (eboardEl) {
      eboardEl.innerHTML = EB.length ? EB.map(eboardCard).join('')
        : '<p class="page-empty">E-board positions will appear here once assigned' + (MODE === 'active' ? '.' : ' for the alumni board.') + '</p>';
      wire(eboardEl);
    }
    renderGrid('');
  }

  if (searchEl) searchEl.addEventListener('input', function () { renderGrid(searchEl.value.trim().toLowerCase()); });

  /* ---- detail modal (same gating as the family tree) ---- */
  function row(k, v) { return v ? '<div class="bm__row"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; }
  function openProfile(b) {
    var m = document.getElementById('brotherModal');
    if (!m) return;
    m.querySelector('[data-f=name]').textContent = b.full_name;
    m.querySelector('[data-f=sub]').textContent = [b.pledge_class, b.role].filter(Boolean).join(' · ');
    var av = m.querySelector('[data-f=avatar]');
    av.innerHTML = ''; av.textContent = initials(b.full_name);
    var body = m.querySelector('[data-f=body]');
    m.classList.add('open'); m.setAttribute('aria-hidden', 'false');

    if (!b.registered) {
      body.innerHTML = '<div class="bm__locked">🌳 <b>Profile unclaimed</b><span>Is this you? Sign in and claim your name to bring this profile to life.</span>' +
        '<a class="btn btn--gold" href="index.html#brothers-portal">Claim your profile</a></div>';
      return;
    }
    body.innerHTML = '<p class="bm__loading">…</p>';
    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (!ok) {
        body.innerHTML = '<div class="bm__locked">🔒 <b>Members only</b><span>Sign in as a verified brother to view the full profile.</span>' +
          '<a class="btn btn--gold" href="index.html#brothers-portal">Brother sign in</a></div>';
        return;
      }
      window.ZBXI.brotherDetail(b.id).then(function (d) {
        d = d || {};
        body.innerHTML =
          row('Major', d.major) + row('Class of', d.grad_year) + row('Hometown', d.hometown) +
          (d.linkedin ? '<div class="bm__row"><span>LinkedIn</span><b><a href="' + esc(d.linkedin) + '" target="_blank" rel="noopener">profile ↗</a></b></div>' : '') +
          (d.bio ? '<p class="bm__bio">' + esc(d.bio) + '</p>' : '') +
          (d.quote ? '<p class="bm__quote">“' + esc(d.quote) + '”</p>' : '');
        if (d.photo_url) av.innerHTML = '<img src="' + esc(d.photo_url) + '" alt="">';
      }).catch(function () { body.innerHTML = '<p class="bm__loading">Could not load details.</p>'; });
    });
  }
  var modal = document.getElementById('brotherModal');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-close]')) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); } });
  }

  /* ---- load ---- */
  if (window.ZBXI && window.ZBXI.configured) {
    window.ZBXI.listFamilyPublic().then(function (rows) {
      if (rows && rows.length) render(rows);
      else gridEl.innerHTML = '<p class="page-empty">The brotherhood roster hasn\'t been imported yet.</p>';
    }).catch(function () { gridEl.innerHTML = '<p class="page-empty">Could not load the roster. Try refreshing.</p>'; });
  } else {
    gridEl.innerHTML = '<p class="page-empty">Members area is being set up — check back soon.</p>';
  }
})();
