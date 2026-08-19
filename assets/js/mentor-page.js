/* Mentoring page — two lists side by side: brothers offering to help (🎓 Mentors)
   and brothers asking (🌱 Mentees). Members-only bootstrap, same as map-page.js.

   WHAT CHANGED IN upgrade55, and why the old shape could not carry a second list:
   the pool used to be `!isActive(b) && (b.skills || b.occupation || b.industry)` —
   alumni only, and only those who had filled in a career. That silently hid two of
   the twenty-five brothers who had actually volunteered, and it made a Mentees list
   impossible: a mentee is usually an active, and a brother asking for advice has by
   definition not filled in a career yet. Membership is now the flag itself. Ticking
   the box on your profile is the whole opt-in, and it is the only thing that puts
   you on this page.

   Search lives INSIDE each card. One box above two lists cannot say which list it
   filters, and the page is quieter without a search bar in the header. */
(function () {
  'use strict';
  var gate = document.getElementById('mentorGate');
  var sec = document.getElementById('mentorSec');
  var Z = window.ZBXI;
  if (!gate || !sec || !Z || !Z.configured) return;

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function initials(name) { return window.BrotherCard ? window.BrotherCard.initials(name) : 'ΖΒΞ'; }

  function uniqueSorted(vals) {
    var seen = {};
    return vals.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; })
      .sort(function (a, z) { return String(a).localeCompare(String(z)); });
  }

  /* ---- one brother, as a card ---- */
  var ALL = [];               // every brother on either list, for the modal lookup
  function card(b) {
    var reg = b.registered;
    var av = b.photo_url
      ? '<img src="' + esc(b.photo_url) + '" alt="">'
      : esc(initials(b.full_name));
    var extra = [b.city, b.occupation, b.company].filter(Boolean).join(' · ');
    // Icons + wording from the shared list, in canon order (upgrade55).
    var mine = b.open_to || [];
    var ot = (Z.OPEN_TO || []).filter(function (o) { return mine.indexOf(o.key) !== -1; })
      .map(function (o) { return '<i class="bro-card__ot" title="Open to ' + esc(o.title) + '">' + o.icon + '</i>'; }).join('');
    return '<button class="bro-card' + (reg ? ' bro-card--live' : '') + '" data-id="' + esc(b.id) + '">' +
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
        var b = ALL.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
      });
    });
  }

  // Name is included deliberately — the old search matched skills and job title
  // but not the person, so typing a brother's name found nothing.
  function haystack(b) {
    return [b.full_name, b.skills, b.occupation, b.major, b.industry, b.company, b.city]
      .filter(Boolean).join(' ').toLowerCase();
  }

  /* ---- a list: its own pool, its own search box, its own empty state ---- */
  function makeList(opts) {
    var grid = document.getElementById(opts.gridId);
    var input = document.getElementById(opts.searchId);
    var countEl = document.getElementById(opts.countId);
    var pool = opts.pool;

    function draw(q) {
      var hits = q ? pool.filter(function (b) { return haystack(b).indexOf(q) !== -1; }) : pool;
      grid.innerHTML = hits.length
        ? hits.map(card).join('')
        : '<p class="page-empty">' + (q ? 'Nobody on this list matches that.' : opts.emptyHtml) + '</p>';
      wire(grid);
    }

    if (countEl) countEl.textContent = pool.length
      ? pool.length + (pool.length === 1 ? ' brother' : ' brothers')
      : opts.zeroCount;

    if (input) {
      // An empty list has nothing to search; leaving the box live would be a dead control.
      if (!pool.length) { input.disabled = true; input.placeholder = opts.zeroPlaceholder; }
      input.addEventListener('input', function () {
        if (opts.onType) opts.onType();
        draw(input.value.trim().toLowerCase());
      });
    }
    draw('');
    return { draw: draw, input: input, pool: pool };
  }

  function renderFinder(rows) {
    ALL = (rows || []).slice().sort(function (a, z) {
      return String(a.full_name).localeCompare(String(z.full_name));
    });
    ALL.forEach(function (b) { b.registered = !!b.user_id; });

    function flagged(key) {
      return ALL.filter(function (b) { return (b.open_to || []).indexOf(key) !== -1; });
    }
    var mentors = flagged('mentor');
    var mentees = flagged('mentee');

    gate.innerHTML = '';
    sec.style.display = '';

    /* ---- 🎓 Mentors ---- */
    var filterSel = document.getElementById('mentorFilter');
    var mentorList = makeList({
      gridId: 'mentorGrid', searchId: 'mentorSearch', countId: 'mtgMentorsCount',
      pool: mentors,
      zeroCount: 'nobody yet',
      zeroPlaceholder: 'No mentors to search yet',
      emptyHtml: 'No brother has offered to mentor yet. Tick <b>Being a Mentor</b> on your ' +
                 'profile to be the first — <a href="index.html#brothers-portal">open your profile</a>.',
      onType: function () { if (filterSel && filterSel.value) filterSel.value = ''; }
    });

    // Profession filter, mentors only: it is derived from their fields, and a brother
    // asking for advice usually has no field to filter on yet.
    if (filterSel) {
      var fields = uniqueSorted(mentors.map(function (b) { return b.industry; })
        .concat(mentors.map(function (b) { return b.occupation; })));
      filterSel.innerHTML = '<option value="">Every profession</option>' +
        fields.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
      if (!fields.length) filterSel.disabled = true;
      filterSel.onchange = function () {
        if (mentorList.input) mentorList.input.value = filterSel.value;
        mentorList.draw(filterSel.value.toLowerCase());
      };
    }

    /* ---- 🌱 Mentees ---- */
    // Empty by design on day one. An empty card here is an invitation, not a blank —
    // and it names the number of brothers already waiting to help, because "nobody has
    // asked yet" is only discouraging if you don't know anyone is listening.
    makeList({
      gridId: 'menteeGrid', searchId: 'menteeSearch', countId: 'mtgMenteesCount',
      pool: mentees,
      zeroCount: 'nobody yet',
      zeroPlaceholder: 'No mentees to search yet',
      emptyHtml: 'Nobody has asked yet — and there is no cost to being first. Tick ' +
                 '<b>Being a Mentee</b> on your profile and you\'ll show up here' +
                 (mentors.length ? ', where <b>' + mentors.length + '</b> ' +
                   (mentors.length === 1 ? 'brother has' : 'brothers have') + ' already offered to help' : '') + '.'
    });

    var foot = document.getElementById('menteeFoot');
    if (foot) {
      foot.innerHTML = '<a class="btn btn--ghost" href="index.html#brothers-portal">Add me to a list →</a>' +
        '<p class="mtg-card__foothint">Both lists come straight from the “I\'m open to…” boxes on ' +
        'your profile. Tick one, tick both, or untick at any time.</p>';
    }

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
        '<h3 style="color:var(--heading);font-family:var(--display);margin-top:0">Request a mentor</h3>' +
        '<p class="form-note" style="margin-top:0">We\'ll notify up to five brothers who said they\'re open to mentoring in this field. They get your name and email, and can reply to you directly.</p>' +
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
            else if (res === 'none') { st.className = 'form-status err'; st.textContent = 'No brother has raised the “Being a Mentor” flag in that field yet. Try a nearby field, or reach out directly with 🤝 Connect.'; }
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
        '<h3 style="color:var(--heading);font-family:var(--display);margin-top:0">How networking works</h3>' +
        '<div class="cal-helpbody">' +
        '<p><b>1 · Fill in your profile.</b> Click your name in the top-right → My Profile. Your industry, city, company, and LinkedIn are what make you findable — the meter at the top shows what\'s missing.</p>' +
        '<p><b>2 · Raise your hand.</b> Tick the "I\'m open to…" boxes: 🎓 <b>Being a Mentor</b> if you\'ll help someone, 🌱 <b>Being a Mentee</b> if you\'re the one asking, 🤝 <b>Connecting</b> for no reason at all. Each box puts you on the matching list here, and shows as a badge next to your name so brothers know it\'s welcome to reach out.</p>' +
        '<p><b>3 · Read the two lists.</b> <b>🎓 Mentors</b> are brothers offering; <b>🌱 Mentees</b> are brothers asking. Search inside either card by name, field, city or skill — "finance", "law school", "engineer". Click anyone to open his card.</p>' +
        '<p><b>4 · Press Connect.</b> On any brother\'s card, the 🤝 Connect button drops your name, email and a short note into his notifications — he just replies to your email. Add the note: "wants to connect" on its own leaves him guessing what you\'re after.</p>' +
        '<p><b>5 · Or ask the room.</b> <b>🎓 Request a mentor</b> notifies up to five brothers who volunteered to mentor in that field — you don\'t have to know who to ask.</p>' +
        '<p><b>Where the conversation actually happens.</b> There is deliberately no chat app here — one brother to one brother goes over email via 🤝 Connect, and anything the whole chapter might want to weigh in on belongs on the <a href="board.html">Board</a>, where it stays findable instead of dying in someone\'s inbox. If a group of you meets regularly, ask an officer or the webmaster for a <b>private committee space</b> — a members-only corner of the Board that nobody outside it can see.</p>' +
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
      '<span>Sign in as a verified brother to see who is offering to help and who is asking.</span>' +
      '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a></div>';
  }

  gate.innerHTML = '<p class="page-empty">Loading…</p>';
  Z.approvalState().then(function (state) {
    if (state === 'error') { ZBXIUtil.loadError(gate, 'the mentoring lists'); return; }
    if (state !== 'approved') { lock(); return; }
    Z.listVerifiedDetail().then(function (rows) {
      renderFinder(rows);
    }).catch(function () {
      gate.innerHTML = '<p class="page-empty">The Mentoring lists couldn\'t load right now.</p>';
    });
  }).catch(function () { ZBXIUtil.loadError(gate, 'the mentoring lists'); });
})();
