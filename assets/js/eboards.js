/* Executive Boards — the chapter's officers, term by term.
   Was a strip at the bottom of the Alumni page that listed whoever happened to
   carry a `brothers.role`, chairs and presidents jumbled together. Now it is its
   own destination: a card per term, click into one to see that board.

   A BOARD is a term (public.eboards). Its SEATS are the brother_titles rows
   carrying that board's id — the very same rows the profile card renders as a
   brother's positions history, so a term corrected here is corrected there too.

   Officer vs chair is DERIVED from the title, never stored: the canonical four
   are officers, everything else is a chair. One rule, one place. upgrade50
   normalised the spellings so it can be trusted ('Vice President' had no hyphen
   and matched nothing).

   The CURRENT board is not a row in eboards. It is read live from the roster's
   role/role_scope — the same source the Active and Alumni pages use, and the same
   source that decides who is an officer — so it can never drift from them. You
   edit it where you always did, in the admin console's E-Board tab.

   Editing is the admin, or an officer holding `eboard.manage`. The buttons here
   are convenience; RLS on eboards and brother_titles is the actual gate, and
   every write asks for its rows back so a refusal cannot read as a success. */
(function () {
  'use strict';
  var root = document.getElementById('eboardsRoot');
  if (!root) return;
  var Z = window.ZBXI;

  var OFFICERS = ['President', 'Vice-President', 'Treasurer', 'Secretary'];
  // Offered in the picker; the field stays free text because every chapter
  // invents its own and a fixed list would just send the owner back to us.
  var CHAIRS = ['Pledge Master', 'Rush Chair', 'Philanthropy Chair', 'Social Chair',
                'Alumni Chair', 'Risk Manager', 'Historian', 'Sergeant at Arms',
                'Scholarship Chair', 'Brotherhood Chair', 'Webmaster'];
  var SEMS = ['Fall', 'Spring'];

  /* ---------- the seasonal devices ----------
     Two marks, drawn once, replacing the 👑 that was identical on all seventeen
     cards and rendered as a different picture on every operating system.

     stroke="currentColor" throughout, so each inherits whatever colour the signet
     is in — one rule for the tinted history disc, one for the filled gold seal —
     and neither glyph needs a dark-mode rule of its own.

     THREE PATHS EACH, and FILLED rather than outlined. The first pass drew both as
     line art and it failed at real size: at 22px the acorn's cup-and-nut outline
     read as a goblet, and the two devices were hard to tell apart. Solid mass
     survives small sizes where an outline collapses into its own stroke. The fill
     and the stroke are both currentColor, so the edge just adds weight.

     Checked at real size in a screenshot, never zoomed in an editor — zooming is
     how the first version passed. */
  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" ' +
    'stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  // FALL — an acorn: a ROUND body under a dome cap.
  // The body is an ellipse, not a taper. A nut that narrows to a point beneath a
  // wide flat cap on a stalk is the silhouette of a wine glass, which is exactly
  // what the previous two versions drew.
  var OAK = SVG_OPEN +
    '<ellipse cx="12" cy="14.3" rx="4.7" ry="5.5"/>' +
    '<path d="M6.5 11.1c0-2.7 2.5-4.5 5.5-4.5s5.5 1.8 5.5 4.5z"/>' +
    '<path d="M12 6.6V5" fill="none" stroke-width="1.5"/></svg>';

  // SPRING — a leaf, TILTED and pointed at both ends, on a stem.
  // An earlier version read as a water droplet, and the reason was specific: it was
  // pointed at the top, ROUND at the bottom, and perfectly vertical — which is the
  // definition of a droplet. A leaf is pointed at BOTH ends, sits at an angle, and
  // grows from a stem. Those three things are what separate the two shapes, and all
  // three survive at 34px where surface detail like a midrib does not.
  var LAUREL = SVG_OPEN +
    '<path d="M18.3 5.2C11.2 6.2 7.2 11 7.2 17.8c7.1-1 11.1-5.8 11.1-12.6z"/>' +
    '<path d="M7.2 17.8 4.5 20.7" fill="none" stroke-width="1.7"/></svg>';

  /* The board in office has no term of its own to show — its officers' role_terms
     disagree (Aaron's says Spring 2027, Blake's Fall 2026) — so its seal carries
     the device for the CURRENT academic season and no year. Inventing a year for
     it would be stating something nobody recorded. August starts the fall term. */
  function currentSem() { return new Date().getMonth() >= 7 ? 'Fall' : 'Spring'; }

  /* A board wears its START season: one that ran Fall 2023 – Spring 2024 took
     office in the fall. The span itself is already spelled out underneath. */
  /* No year inside the disc. It was set at 11px under a hairline rule, which left
     the device only 24px — and at 24px an acorn and a leaf are the same blob. The
     year was also redundant: the card spells out "Spring 2026" on the very next
     line. Giving the device the whole disc is what makes the two seasons tell
     apart at a glance, which is the only job this mark has. */
  function signet(sem, now) {
    return '<span class="ebsig' + (now ? ' ebsig--now' : '') + '" aria-hidden="true">' +
      '<span class="ebsig__g">' + (sem === 'Spring' ? LAUREL : OAK) + '</span></span>';
  }

  /* The men, not just a count of them. seatsOf() already sorts officers above
     chairs, so the first four discs are the board proper. Capped at four because
     a fifth makes the row wider than the term above it. */
  function faces(seats) {
    if (!seats.length) return '';
    var shown = seats.slice(0, 4), extra = seats.length - shown.length;
    return '<span class="ebfaces" aria-hidden="true">' +
      shown.map(function (s) {
        var b = broOf(s);
        var nm = b ? b.full_name : '?';
        return '<span class="ebfaces__f">' + (b && b.photo_url
          ? '<img src="' + esc(b.photo_url) + '" alt="">'
          : esc(initials(nm))) + '</span>';
      }).join('') +
      (extra ? '<span class="ebfaces__f ebfaces__more">+' + esc(extra) + '</span>' : '') +
      '</span>';
  }

  var BOARDS = [], SEATS = [], ROSTER = [], BY_ID = {};
  var canEdit = false, scopeF = '', curId = null;

  var esc = ZBXIUtil.esc;
  function initials(name) { return window.BrotherCard ? window.BrotherCard.initials(name) : 'ΖΒΞ'; }
  function isOfficer(title) { return OFFICERS.indexOf(title) !== -1; }

  /* A board reads "Fall 2023 – Spring 2024" when it spans two semesters and
     "Fall 2023" when it is the single-semester stub the import produced. */
  function termLabel(b) {
    var start = b.start_sem + ' ' + b.start_year;
    if (!b.end_sem || !b.end_year) return start;
    return start + ' – ' + b.end_sem + ' ' + b.end_year;
  }
  function scopeLabel(s) { return s === 'alumni' ? 'Alumni Board' : 'Active Board'; }

  function seatsOf(boardId) {
    return SEATS.filter(function (s) { return s.board_id === boardId; })
      .sort(function (a, z) {
        return (a.sort || 0) - (z.sort || 0) ||
               String(a.title).localeCompare(String(z.title));
      });
  }
  function broOf(seat) { return BY_ID[seat.brother_id] || null; }

  /* ---------- the sitting board, synthesised ----------
     Not stored anywhere. `role_term` differs between officers (Aaron's says
     Spring 2027, Blake's Fall 2026), so the card carries no single term — the
     board it describes is simply the one in office. */
  function currentSeats(scope) {
    return ROSTER.filter(function (b) { return b.role && b.role_scope === scope && isOfficer(b.role); })
      .sort(function (a, z) { return OFFICERS.indexOf(a.role) - OFFICERS.indexOf(z.role); })
      .map(function (b) {
        return { id: 'live-' + b.id, brother_id: b.id, title: b.role,
                 term: b.role_term || '', live: true };
      });
  }

  /* ---------- cards ---------- */
  /* Only counts that exist get named. An imported stub holding one chair used to
     read "0 officers · 1 chair", which announces an absence instead of stating
     what is there. */
  function countLine(seats) {
    var off = seats.filter(function (s) { return isOfficer(s.title); }).length;
    var ch = seats.length - off;
    var bits = [];
    if (off) bits.push(off + (off === 1 ? ' officer' : ' officers'));
    if (ch) bits.push(ch + (ch === 1 ? ' chair' : ' chairs'));
    return bits.length ? bits.join(' · ') : 'Nobody recorded yet';
  }

  function boardCard(b) {
    var seats = seatsOf(b.id);
    var pres = seats.filter(function (s) { return s.title === 'President'; })[0];
    var who = pres && broOf(pres);
    return '<button class="bsec ebsec' + (seats.length ? '' : ' bsec--empty') +
        '" data-board="' + esc(b.id) + '" aria-label="' + esc('Open the ' + termLabel(b) + ' board') + '">' +
      signet(b.start_sem, false) +
      '<span class="bsec__name">' + esc(termLabel(b)) + '</span>' +
      (who ? '<span class="ebsec__pres">' + esc(who.full_name) + ', President</span>' : '') +
      faces(seats) +
      '<span class="bsec__n">' + esc(scopeLabel(b.scope)) + ' · ' + esc(countLine(seats)) + '</span>' +
      '</button>';
  }

  function currentCard(scope) {
    var seats = currentSeats(scope);
    if (!seats.length) return '';
    var pres = seats[0].title === 'President' ? broOf(seats[0]) : null;
    return '<button class="bsec ebsec ebsec--now" data-board="live-' + esc(scope) + '"' +
        ' aria-label="' + esc('Open the current ' + scopeLabel(scope)) + '">' +
      '<span class="ebsec__badge">● Current</span>' +
      signet(currentSem(), true) +
      '<span class="bsec__name">' + esc(scopeLabel(scope)) + '</span>' +
      (pres ? '<span class="ebsec__pres">' + esc(pres.full_name) + ', President</span>' : '') +
      faces(seats) +
      '<span class="bsec__n">' + esc(seats.length) + ' of 4 seats filled</span>' +
      '</button>';
  }

  /* The officer card is the one already used by the Active and Alumni E-Board
     grids — same markup, same class — so the three read as one thing. Chairs get
     the same card at lower weight rather than a second design. */
  /* showTerm is off inside a stored board: the heading already says "Spring 2022",
     so repeating it under all three men is noise, and it wraps the chair labels
     onto two lines. The live board is the exception — its heading is "Active
     Board" and each sitting officer carries his own term, so there it earns space. */
  function seatCard(seat, showTerm) {
    var b = broOf(seat);
    var name = b ? b.full_name : 'Unknown brother';
    var av = (b && b.photo_url) ? '<img src="' + esc(b.photo_url) + '" alt="">' : esc(initials(name));
    var line = esc(seat.title) + (showTerm && seat.term ? ' · ' + esc(seat.term) : '');
    return '<button class="eb-card' + (isOfficer(seat.title) ? '' : ' eb-card--chair') +
        (b && b.registered ? ' bro-card--live' : '') + '" data-bro="' + esc(seat.brother_id) + '">' +
      '<span class="eb-card__av">' + av + '</span>' +
      '<b>' + esc(name) + '</b>' +
      '<span class="eb-card__role">' + line + '</span>' +
      '<small>' + esc(b ? (b.pledge_class || '') : '') + '</small></button>';
  }

  /* ---------- the front door ---------- */
  function renderList() {
    curId = null;
    var boards = scopeF ? BOARDS.filter(function (b) { return b.scope === scopeF; }) : BOARDS;
    var chips = [['', 'All boards'], ['active', 'Active'], ['alumni', 'Alumni']].map(function (p) {
      return '<button class="fam-chip' + (scopeF === p[0] ? ' on' : '') + '" aria-pressed="' + (scopeF === p[0]) +
        '" data-scope="' + p[0] + '">' + esc(p[1]) + '</button>';
    }).join('');

    var nowCards = (scopeF !== 'alumni' ? currentCard('active') : '') +
                   (scopeF !== 'active' ? currentCard('alumni') : '');

    root.innerHTML =
      // NOT .fam-bar: that class is display:none below 700px on the family tree,
      // where a <select> replaces it. Borrowing it silently hid these filters on
      // every phone. Own class, no inherited baggage.
      '<div class="ebchips">' + chips + '</div>' +
      (canEdit ? '<div class="admin-addbar"><button class="btn btn--gold" id="ebNew">＋ New board</button></div>' : '') +
      (nowCards ? '<div class="bsecs__group"><span class="bsecs__label">IN OFFICE</span>' +
        '<div class="bsecs">' + nowCards + '</div></div>' : '') +
      '<div class="bsecs__group"><span class="bsecs__label">PAST BOARDS</span>' +
        (boards.length
          ? '<div class="bsecs">' + boards.map(boardCard).join('') + '</div>'
          : '<p class="page-empty">No past boards recorded yet.</p>') +
      '</div>';

    root.querySelectorAll('[data-scope]').forEach(function (c) {
      c.onclick = function () { scopeF = c.dataset.scope; renderList(); };
    });
    root.querySelectorAll('[data-board]').forEach(function (c) {
      c.onclick = function () { openBoard(c.dataset.board); };
    });
    var nb = document.getElementById('ebNew');
    if (nb) nb.onclick = function () { openBoardForm(null); };
  }

  /* ---------- one board ---------- */
  function openBoard(id) {
    curId = id;
    var live = id.indexOf('live-') === 0;
    var scope = live ? id.slice(5) : null;
    var b = live ? null : BOARDS.filter(function (x) { return x.id === id; })[0];
    if (!live && !b) return renderList();

    var seats = live ? currentSeats(scope) : seatsOf(b.id);
    var officers = seats.filter(function (s) { return isOfficer(s.title); });
    var chairs = seats.filter(function (s) { return !isOfficer(s.title); });
    var heading = live ? scopeLabel(scope) : termLabel(b);
    var sub = live ? 'In office now' : scopeLabel(b.scope);

    root.innerHTML =
      '<div class="bhead">' +
        '<button class="bback" id="ebBack" aria-label="Back to Executive Boards" title="Back to Executive Boards">←</button>' +
        // The same mark that was on the card you clicked, so arriving here feels
        // like opening that card rather than landing on a different page.
        (live ? signet(currentSem(), true) : signet(b.start_sem, false)) +
        '<div class="bhead__main"><div class="gsechead"><h3>' + esc(heading) + '</h3>' +
          '<span>' + esc(sub) + '</span></div></div>' +
      '</div>' +
      (!live && b.note ? '<p class="lede eb-note">' + esc(b.note) + '</p>' : '') +
      (live ? '<p class="admin-hint">This is the board in office right now, read straight from the roster. ' +
                'Seats are assigned in the admin console\'s 👑 E-Board tab — that keeps this card and the ' +
                'Active / Alumni pages from ever disagreeing.</p>' : '') +
      (officers.length
        ? '<div class="eb-grid">' +
            officers.map(function (s) { return seatCard(s, live); }).join('') + '</div>'
        : '<p class="page-empty">No officers recorded for this board yet.</p>') +
      (chairs.length
        ? '<p class="eyebrow" style="margin-top:2.4rem">Chairs &amp; Positions</p>' +
          '<div class="eb-grid eb-grid--chairs">' +
            chairs.map(function (s) { return seatCard(s, live); }).join('') + '</div>'
        : '') +
      (canEdit ? (live ? liveTools(scope, seats) : boardTools(b)) : '');

    document.getElementById('ebBack').onclick = renderList;
    root.querySelectorAll('[data-bro]').forEach(function (c) {
      c.onclick = function () {
        var bro = BY_ID[c.dataset.bro];
        if (bro && window.BrotherCard) window.BrotherCard.open(bro, { portal: ZBXIUtil.signInHref() });
      };
    });
    if (canEdit) { if (live) wireLiveTools(scope, seats); else wireTools(b); }
  }

  /* The other half of the semester rollover. When a board's term ends you want its
     four officers written into history — and retyping four names you are already
     looking at is exactly the chore that stops it happening. This copies them. */
  function liveTools(scope, seats) {
    if (!seats.length) return '';
    return '<div class="acct-block eb-tools"><h4>End of term</h4>' +
      '<p class="form-note">Writes these ' + seats.length + ' officer' + (seats.length === 1 ? '' : 's') +
        ' into a past board you can label and add chairs to. Nobody loses their seat — ' +
        'that still happens in the admin console.</p>' +
      '<div class="admin-addbar"><button class="btn btn--gold" data-archive>Archive this board as history →</button></div>' +
      '<p class="form-status" data-ebstatus></p></div>';
  }

  function wireLiveTools(scope, seats) {
    var btn = root.querySelector('[data-archive]');
    if (btn) btn.onclick = function () { openBoardForm(null, { scope: scope, seed: seats }); };
  }

  /* ---------- editing ---------- */
  function boardTools(b) {
    var others = BOARDS.filter(function (x) { return x.id !== b.id; });
    return '<div class="acct-block eb-tools"><h4>Manage this board</h4>' +
      '<div class="admin-addbar">' +
        '<button class="btn btn--gold" data-edit>Edit term &amp; notes</button>' +
        '<button class="btn btn--ghost" data-addseat>＋ Add a position</button>' +
        (others.length ? '<button class="btn btn--ghost" data-absorb>Absorb another board…</button>' : '') +
        '<button class="btn btn--danger" data-delboard>Delete board</button>' +
      '</div>' +
      (seatsOf(b.id).length
        ? '<div class="stat-list">' + seatsOf(b.id).map(function (s) {
            var bro = broOf(s);
            return '<div class="stat-list__row"><b>' + esc(bro ? bro.full_name : '—') + '</b>' +
              '<span>' + esc(s.title) + '</span>' +
              '<em><a href="#" data-delseat="' + esc(s.id) + '">remove</a></em></div>';
          }).join('') + '</div>'
        : '') +
      '<p class="form-status" data-ebstatus></p></div>';
  }

  function wireTools(b) {
    var st = root.querySelector('[data-ebstatus]');
    function fail(e) {
      st.className = 'form-status err';
      st.textContent = (e && e.message) || 'That did not save.';
    }
    function done() { load().then(function () { openBoard(b.id); }); }

    root.querySelector('[data-edit]').onclick = function () { openBoardForm(b); };
    root.querySelector('[data-addseat]').onclick = function () { openSeatForm(b); };

    var ab = root.querySelector('[data-absorb]');
    if (ab) ab.onclick = function () { openAbsorb(b); };

    root.querySelector('[data-delboard]').onclick = function () {
      var n = seatsOf(b.id).length;
      ZBXIAsk.confirm({
        title: 'Delete the ' + termLabel(b) + ' board?',
        body: n ? 'The ' + n + ' position' + (n === 1 ? '' : 's') +
              ' on it stay on the brothers’ records — they just stop belonging to a board.' : '',
        ok: 'Delete board', danger: true
      }, function () {
        st.className = 'form-status'; st.textContent = 'Deleting…';
        Z.eboardDelete(b.id).then(function () { load().then(renderList); })['catch'](fail);
      });
    };

    root.querySelectorAll('[data-delseat]').forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var seat = SEATS.filter(function (s) { return s.id === a.dataset.delseat; })[0];
        var bro = seat && broOf(seat);
        if (!seat) return;
        ZBXIAsk.confirm({
          title: 'Remove ' + (bro ? bro.full_name : 'this brother') + ' as ' + seat.title + '?',
          body: 'This deletes the position from his record too.',
          ok: 'Remove', danger: true
        }, function () {
          st.className = 'form-status'; st.textContent = 'Removing…';
          Z.eboardSeatRemove(seat.id).then(done)['catch'](fail);
        });
      };
    });
  }

  /* The term picker is two semester+year pairs. Leaving the end blank is what
     records a one-semester board — most run two, but the import produced stubs
     and some genuinely were one. */
  function openBoardForm(b, opts) {
    opts = opts || {};
    var yNow = new Date().getFullYear();
    var defScope = b ? b.scope : (opts.scope || 'active');
    function semSel(name, val) {
      return '<select data-f="' + name + '"><option value="">—</option>' +
        SEMS.map(function (s) {
          return '<option' + (val === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select>';
    }
    var wrap = modal(b ? 'Edit executive board' : (opts.seed ? 'Archive this board' : 'New executive board'),
      (opts.seed ? '<p class="form-note">' + esc(opts.seed.length) + ' officer' +
        (opts.seed.length === 1 ? '' : 's') + ' will be copied onto this board: ' +
        esc(opts.seed.map(function (s) {
          var bro = broOf(s); return (bro ? bro.full_name : '?') + ' (' + s.title + ')';
        }).join(', ')) + '</p>' : '') +
      '<div class="field"><label>Which board</label><select data-f="scope">' +
        ['active', 'alumni'].map(function (s) {
          return '<option value="' + s + '"' + (defScope === s ? ' selected' : '') +
            '>' + scopeLabel(s) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="field"><label>Term starts</label><div class="eb-termrow">' +
        semSel('start_sem', b ? b.start_sem : 'Fall') +
        '<input type="number" data-f="start_year" min="1993" max="2100" value="' +
          esc(b ? b.start_year : yNow) + '"></div></div>' +
      '<div class="field"><label>Term ends <small>(leave blank for a single semester)</small></label>' +
        '<div class="eb-termrow">' + semSel('end_sem', b ? b.end_sem : '') +
        '<input type="number" data-f="end_year" min="1993" max="2100" value="' +
          esc(b && b.end_year ? b.end_year : '') + '"></div></div>' +
      '<div class="field"><label>Note <small>(optional — what this board is remembered for)</small></label>' +
        '<textarea data-f="note" rows="2" maxlength="300">' + esc(b && b.note ? b.note : '') + '</textarea></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">' +
        (b ? 'Save board' : 'Create board') + '</button>');

    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      function v(n) { return wrap.querySelector('[data-f="' + n + '"]').value.trim(); }
      var row = {
        scope: v('scope'),
        start_sem: v('start_sem'), start_year: parseInt(v('start_year'), 10),
        end_sem: v('end_sem') || null,
        end_year: v('end_year') ? parseInt(v('end_year'), 10) : null,
        note: v('note') || null
      };
      if (!row.start_sem || !row.start_year) {
        st.className = 'form-status err'; st.textContent = 'A board needs a starting semester and year.'; return;
      }
      // Both halves of the end, or neither — half an end date renders as nothing
      // and silently loses what you typed.
      if ((row.end_sem && !row.end_year) || (!row.end_sem && row.end_year)) {
        st.className = 'form-status err';
        st.textContent = 'Give the ending semester AND year, or leave both blank.'; return;
      }
      st.className = 'form-status'; st.textContent = 'Saving…';
      var p = b ? Z.eboardUpdate(b.id, row).then(function () { return retermSeats(b.id, row); })
                : Z.eboardCreate(row).then(function (made) {
                    if (!opts.seed) return made;
                    // Copy the sitting officers in, one at a time. Sequential on
                    // purpose: four parallel inserts that half-fail would leave a
                    // board nobody could tell was incomplete.
                    var chain = Promise.resolve();
                    opts.seed.forEach(function (s) {
                      chain = chain.then(function () {
                        return Z.brotherTitleAdd({
                          brother_id: s.brother_id, title: s.title,
                          term: termLabel(row), scope: row.scope, board_id: made.id,
                          sort: OFFICERS.indexOf(s.title) + 1
                        });
                      });
                    });
                    return chain.then(function () { return made; });
                  });
      p.then(function (made) {
        wrap.close();
        load().then(function () { openBoard(b ? b.id : made.id); });
      })['catch'](function (e) {
        st.className = 'form-status err'; st.textContent = (e && e.message) || 'That did not save.';
      });
    };
  }

  /* A seat carries its own term text, because the profile card renders it out of
     any board context ("President · Fall 2023 – Spring 2024"). Re-term the board
     and the seats have to follow, or the two views start contradicting each other. */
  function retermSeats(boardId, row) {
    var label = termLabel(row);
    return Promise.all(seatsOf(boardId).map(function (s) {
      if (s.term === label && s.scope === row.scope) return Promise.resolve();
      return Z.eboardSeatUpdate(s.id, { term: label, scope: row.scope });
    }));
  }

  function openSeatForm(b) {
    var wrap = modal('Add a position — ' + termLabel(b),
      '<div class="field"><label>Search brothers</label><input data-search placeholder="Start typing a name…"></div>' +
      '<div class="field"><label>Brother</label><select data-f="who" size="6" style="height:auto"></select></div>' +
      '<div class="field"><label>Position</label><select data-f="pick">' +
        '<optgroup label="Executive Board">' +
          OFFICERS.map(function (t) { return '<option>' + t + '</option>'; }).join('') +
        '</optgroup><optgroup label="Chairs &amp; positions">' +
          CHAIRS.map(function (t) { return '<option>' + t + '</option>'; }).join('') +
        '</optgroup><option value="__other">Something else…</option></select></div>' +
      '<div class="field" data-otherwrap hidden><label>Position name</label>' +
        '<input data-f="other" maxlength="60" placeholder="e.g. Steward"></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">Add position</button>');

    var sel = wrap.querySelector('[data-f="who"]');
    function fill(qs) {
      sel.innerHTML = ROSTER
        .filter(function (v) { return !qs || v.full_name.toLowerCase().indexOf(qs) !== -1; })
        .sort(function (x, y) { return x.full_name.localeCompare(y.full_name); })
        .slice(0, 200)
        .map(function (v) {
          return '<option value="' + esc(v.id) + '">' + esc(v.full_name) +
            (v.pledge_class ? ' (' + esc(v.pledge_class) + ')' : '') + '</option>';
        }).join('');
    }
    fill('');
    wrap.querySelector('[data-search]').oninput = function (e) { fill(e.target.value.trim().toLowerCase()); };

    var pick = wrap.querySelector('[data-f="pick"]');
    var otherWrap = wrap.querySelector('[data-otherwrap]');
    pick.onchange = function () { otherWrap.hidden = pick.value !== '__other'; };

    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      var title = pick.value === '__other'
        ? wrap.querySelector('[data-f="other"]').value.trim() : pick.value;
      if (!sel.value) { st.className = 'form-status err'; st.textContent = 'Pick a brother first.'; return; }
      if (!title) { st.className = 'form-status err'; st.textContent = 'Give the position a name.'; return; }
      // The four officer seats are one to a board — the database says so too
      // (eboard_seats_officer_uniq), this just says it in English first.
      if (isOfficer(title) && seatsOf(b.id).some(function (s) { return s.title === title; })) {
        st.className = 'form-status err';
        st.textContent = 'This board already has a ' + title + '. Remove him first.'; return;
      }
      st.className = 'form-status'; st.textContent = 'Adding…';
      Z.brotherTitleAdd({
        brother_id: sel.value, title: title, term: termLabel(b),
        scope: b.scope, board_id: b.id,
        sort: isOfficer(title) ? OFFICERS.indexOf(title) + 1 : 10
      }).then(function (made) {
        if (!made) throw new Error('The position was not added — you may not have permission.');
        wrap.close();
        load().then(function () { openBoard(b.id); });
      })['catch'](function (e) {
        st.className = 'form-status err'; st.textContent = (e && e.message) || 'That did not save.';
      });
    };
  }

  /* Merging, spelled as one action. The import produced a stub per semester, and
     a real board usually spans two — this moves the other board's positions in
     and deletes the husk. Nothing about who held what is touched. */
  function openAbsorb(b) {
    var others = BOARDS.filter(function (x) { return x.id !== b.id; });
    var wrap = modal('Absorb another board into ' + termLabel(b),
      '<p class="form-note">Its positions move onto this board and the empty board is deleted. ' +
        'Use this to join two single-semester boards into the full term they really were.</p>' +
      '<div class="field"><label>Board to absorb</label><select data-f="src">' +
        others.map(function (o) {
          return '<option value="' + esc(o.id) + '">' + esc(termLabel(o)) + ' · ' +
            esc(scopeLabel(o.scope)) + ' (' + seatsOf(o.id).length + ')</option>';
        }).join('') + '</select></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">Absorb it</button>');

    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      var src = others.filter(function (o) { return o.id === wrap.querySelector('[data-f="src"]').value; })[0];
      if (!src) return;
      var moving = seatsOf(src.id);
      var clash = moving.filter(function (s) {
        return isOfficer(s.title) && seatsOf(b.id).some(function (t) { return t.title === s.title; });
      })[0];
      if (clash) {
        st.className = 'form-status err';
        st.textContent = 'Both boards have a ' + clash.title + '. Remove one before absorbing.'; return;
      }
      st.className = 'form-status'; st.textContent = 'Absorbing…';
      var chain = Promise.resolve();
      moving.forEach(function (s) {
        chain = chain.then(function () { return Z.eboardSeatMove(s.id, b.id); });
      });
      chain.then(function () { return Z.eboardDelete(src.id); })
        // Reload BEFORE re-terming: the seats just moved server-side, but the local
        // list still has them on the old board, so seatsOf() would miss every one of
        // them and they would keep the absorbed board's term forever.
        .then(load)
        .then(function () { return retermSeats(b.id, b); })
        .then(function () { wrap.close(); load().then(function () { openBoard(b.id); }); })
        ['catch'](function (e) {
          st.className = 'form-status err'; st.textContent = (e && e.message) || 'That did not finish.';
        });
    };
  }

  /* The admin console's dialog shell (admin.js treeModal), class for class, so a
     granted officer meets the form he already knows from everywhere else on the
     site — and so this page inherits its styling rather than growing its own.
     One difference: the title is esc()'d here. The console's version interpolates
     it raw, which is safe there because every caller passes a literal; the titles
     below carry a board's term, so it gets escaped. */
  function modal(title, body) {
    var el = document.createElement('div');
    el.className = 'admin-modal open';
    el.innerHTML = '<div class="admin-modal__card">' +
      '<button class="admin-modal__close" data-x aria-label="Close">✕</button>' +
      '<h3>' + esc(title) + '</h3>' + body +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(el);
    el.close = function () { el.remove(); };
    el.addEventListener('click', function (e) {
      if (e.target === el || (e.target.closest && e.target.closest('[data-x]'))) el.close();
    });
    return el;
  }

  /* ---------- load ---------- */
  function load() {
    return Promise.all([Z.eboardsList(), Z.eboardSeats()]).then(function (r) {
      BOARDS = r[0]; SEATS = r[1];
    });
  }

  function lockedOut() {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Members only</b>' +
      '<span>The chapter\'s executive boards are private. Brothers sign in to see them.</span>' +
      '<a class="btn btn--gold" href="' + ZBXIUtil.signInHref() + '">Log In / Sign Up</a></div>';
  }

  if (!Z || !Z.configured) {
    root.innerHTML = '<p class="page-empty">Members area is being set up — check back soon.</p>';
    return;
  }

  Z.approvalState().then(function (state) {
    // 'error' means the database was unreachable, not that he isn't a brother.
    if (state === 'error') return ZBXIUtil.loadError(root, 'the executive boards');
    if (state !== 'approved') return lockedOut();
    return Z.listFamilyPublic().then(function (rows) {
      ROSTER = rows || [];
      if (!ROSTER.length) return lockedOut();
      ROSTER.forEach(function (b) { BY_ID[b.id] = b; });
      return Promise.all([
        load(),
        Z.getUser().then(function (u) {
          var isAdmin = !!(u && Z.adminEmail && (u.email || '').toLowerCase() === Z.adminEmail);
          if (isAdmin) return true;
          return Z.officerCan ? Z.officerCan('eboard.manage') : false;
        }).then(function (can) { canEdit = !!can; })['catch'](function () { canEdit = false; })
      ]).then(function () {
        renderList();
        // Photos arrive second: names and boards should not wait on the signed
        // URLs. Re-render in place once they land.
        Z.listVerifiedDetail().then(function (det) {
          (det || []).forEach(function (d) {
            if (BY_ID[d.id]) {
              BY_ID[d.id].photo_url = d.photo_url;
              BY_ID[d.id].city = d.city; BY_ID[d.id].occupation = d.occupation;
              BY_ID[d.id].company = d.company; BY_ID[d.id].skills = d.skills;
              BY_ID[d.id].major = d.major; BY_ID[d.id].industry = d.industry;
              BY_ID[d.id].open_to = d.open_to; BY_ID[d.id].user_id = d.user_id;
            }
          });
          if (curId) openBoard(curId); else renderList();
        })['catch'](function () { /* photos are a nicety; the page already works */ });
      });
    });
  })['catch'](function () { ZBXIUtil.loadError(root, 'the executive boards'); });
})();
