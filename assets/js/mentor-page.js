/* Find a Mentor page — the mentorship finder, extracted from the alumni page
   (same members-only bootstrap as map-page.js). Approved brothers get the
   alumni pool from roster_detail; everyone else gets the standard lock.
   Cards open the shared BrotherCard modal; "Request a mentor" uses the
   existing mentor_request RPC (capped + rate-limited server-side). */
(function () {
  'use strict';
  var gate = document.getElementById('mentorGate');
  var sec = document.getElementById('mentorSec');
  var Z = window.ZBXI;
  if (!gate || !sec || !Z || !Z.configured) return;

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function initials(name) { return window.BrotherCard ? window.BrotherCard.initials(name) : 'ΖΒΞ'; }

  // Academic cutoff: after May, this year's class has graduated (same rule as
  // the Active/Alumni page split).
  var now = new Date();
  var CUTOFF = now.getFullYear() + (now.getMonth() >= 5 ? 1 : 0);
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
    if (b.standing) return b.standing === 'active';
    var grad = b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null);
    if (grad == null) return false;
    return grad >= CUTOFF;
  }

  function uniqueSorted(vals) {
    var seen = {};
    return vals.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; })
      .sort(function (a, z) { return String(a).localeCompare(String(z)); });
  }

  var POOL = [];
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

  function wire(scope) {
    scope.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var b = POOL.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
      });
    });
  }

  var grid = document.getElementById('mentorGrid');
  var input = document.getElementById('mentorSearch');
  var filterSel = document.getElementById('mentorFilter');

  function show(q) {
    var hits = q
      ? POOL.filter(function (b) {
          return ((b.skills || '') + ' ' + (b.occupation || '') + ' ' + (b.major || '') + ' ' +
                  (b.industry || '') + ' ' + (b.company || '')).toLowerCase().indexOf(q) !== -1;
        })
      : POOL;
    grid.innerHTML = hits.length ? hits.map(card).join('')
      : '<p class="page-empty">No alumni match that yet — try a broader term.</p>';
    wire(grid);
  }

  function renderFinder(rows) {
    POOL = (rows || []).filter(function (b) {
      return !isActive(b) && (b.skills || b.occupation || b.industry);
    }).sort(function (a, z) { return String(a.full_name).localeCompare(String(z.full_name)); });
    POOL.forEach(function (b) { b.registered = !!b.user_id; });
    if (!POOL.length) {
      gate.innerHTML = '<p class="page-empty">No alumni have added a profession or skills yet — this fills in as profiles are completed.</p>';
      return;
    }
    gate.innerHTML = '';
    sec.style.display = '';

    // Brothers who flagged "open to mentoring" float to the front of the pool.
    POOL.sort(function (a, z) {
      var am = (a.open_to || []).indexOf('mentor') !== -1 ? 0 : 1;
      var zm = (z.open_to || []).indexOf('mentor') !== -1 ? 0 : 1;
      return am - zm;
    });

    var fields = uniqueSorted(POOL.map(function (b) { return b.industry; }).concat(
      POOL.map(function (b) { return b.occupation; })));
    filterSel.innerHTML = '<option value="">Filter by profession — all</option>' +
      fields.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    filterSel.onchange = function () {
      input.value = filterSel.value;
      show(filterSel.value.toLowerCase());
    };

    input.addEventListener('input', function () {
      if (filterSel.value) filterSel.value = '';
      show(input.value.trim().toLowerCase());
    });
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
        '<p><b>3 · Find brothers.</b> Search here by field ("finance", "law school", "engineer") or pick a profession from the dropdown. Brothers open to mentoring appear first.</p>' +
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
  function lock() {
    gate.innerHTML =
      '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Brothers only</b>' +
      '<span>Sign in as a verified brother to search alumni by skill, field, or profession.</span>' +
      '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a></div>';
  }

  gate.innerHTML = '<p class="page-empty">Loading…</p>';
  Z.amApprovedBrother().then(function (ok) {
    if (!ok) { lock(); return; }
    Z.listVerifiedDetail().then(function (rows) {
      renderFinder(rows);
    }).catch(function () {
      gate.innerHTML = '<p class="page-empty">The mentor finder couldn\'t load right now.</p>';
    });
  }).catch(lock);
})();
