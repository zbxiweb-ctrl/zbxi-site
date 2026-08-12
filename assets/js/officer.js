/* Officer Console — day-to-day chapter tools for the Alumni Presidents.
   Shows ONLY the tools the Admin has switched on for this President's seat
   (officer_grants). This is UI gating; the DATABASE is the real gate —
   officer_can() is baked into the safe-table RLS policies (see upgrade17.sql),
   so a President who somehow reached a hidden tool is still refused server-side.

   upgrade44 retired the Active President seat: my_officer_seat() can no longer
   return 'active_president', so that holder lands on the "not an officer"
   message. His public title is unaffected.

   Approvals is the one tool that touches a DANGEROUS table (brothers). It does
   not get RLS treatment like the others — it goes through two SECURITY DEFINER
   functions whose whole job is to be narrow. See upgrade44.sql.

   By design this keeps its OWN copies of the editors it borrows from the Admin
   Console (events / committees / awards / suggestions) so the working Admin
   Console is never touched. The announcement-banner editor from the admin Events
   tab is deliberately omitted: that is the (still-admin-only) announcements power,
   not events.manage. */
(function () {
  'use strict';
  var Z = window.ZBXI;
  var root = document.getElementById('officerRoot');
  if (!root) return;
  if (!Z || !Z.configured) { root.innerHTML = '<div class="admin-msg"><h2>Not configured</h2><p>The site backend isn’t reachable right now.</p></div>'; return; }

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  // "Jul 3, 2026 · 2:14 PM" — compact date + time for console rows.
  function stamp(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function btn(action, label, kind) {
    var cls = kind === 'gold' ? 'btn btn--gold' : kind === 'danger' ? 'btn btn--danger' : 'btn btn--ghost';
    return '<button class="' + cls + '" data-' + action + '>' + label + '</button>';
  }
  function each(el, sel, fn) { var n = el.querySelector(sel); if (n) n.onclick = fn; }

  /* A missing big is only a PROBLEM if the brother should have one. The 1993
     founding class ARE the roots of the tree, legitimately — every one of them
     has no big by definition. Counting them as work to do turns the founding
     class into a permanent 12-item false alarm, which is exactly what the first
     version of this card did.

     classYear + needsBig are lifted verbatim from admin.js (which has had the
     rule right since it was written) rather than re-derived, so the two consoles
     can never disagree about what "needs a big" means. */
  function classYear(cls) {
    var s = String(cls || '');
    var m4 = s.match(/(19|20)\d{2}/);
    if (m4) return parseInt(m4[0], 10);
    var m2 = s.match(/'(\d{2})/);
    if (!m2) return null;
    var yy = parseInt(m2[1], 10);
    return yy >= 93 ? 1900 + yy : 2000 + yy;
  }
  function needsBig(b) { return !b.big_id && (classYear(b.pledge_class) || 9999) > 1993; }
  function msg(title, body) { return '<div class="admin-msg"><h2>' + esc(title) + '</h2><p>' + body + '</p></div>'; }

  // The Core tools, in the order they appear in the rail. `perm` is the grant
  // key; `render` is this console's own copy of the editor. Approvals leads —
  // a brother waiting at the front door is the only time-sensitive item here.
  var TOOLS = [
    { perm: 'members.approve',     id: 'members',    ic: '✅', label: 'Approvals',   render: renderApprovalsTab },
    // Membership flow, in the order it actually happens: invite a man, approve
    // him, then fix whatever was typed wrong. (upgrade46)
    { perm: 'members.invite',      id: 'invite',     ic: '✉️', label: 'Invite',      render: renderInviteTab },
    { perm: 'members.edit',        id: 'records',    ic: '🗂', label: 'Records',     render: renderRecordsTab },
    { perm: 'events.manage',       id: 'events',     ic: '📅', label: 'Events',      render: renderEventsTab },
    { perm: 'committees.manage',   id: 'committees', ic: '👥', label: 'Committees',  render: renderCommitteesTab },
    { perm: 'awards.manage',       id: 'awards',     ic: '🏅', label: 'Awards',      render: renderAwardsTab },
    { perm: 'suggestions.respond', id: 'suggest',    ic: '💡', label: 'Suggestions', render: renderSuggestTab },
    { perm: 'gallery.moderate',    id: 'gallery',    ic: '🖼', label: 'Gallery',     render: renderGalleryTab },
    // Shared composer (email-tab.js); the zbxi-email fn re-checks the grant
    // server-side, so this entry only decides whether the tab is visible.
    { perm: 'email.send',          id: 'email',      ic: '📧', label: 'Email',       render: function (q) { window.ZBXIEmailTab.render(q); } },
    // Last on the rail on purpose: it is a thing you look something up in, not a
    // job with a queue. Read-only, and the serious actions only. (upgrade46)
    { perm: 'history.view',        id: 'history',    ic: '📜', label: 'History',     render: renderHistoryTab }
  ];

  var state = { seat: null, seatLabel: '', grants: {}, tools: [], tab: null, events: [], verified: [] };

  /* ---------------- boot ---------------- */
  Z.getUser().then(function (u) {
    if (!u) { root.innerHTML = msg('Please sign in', 'This console is for chapter Presidents. <a href="index.html">Return to the site</a> and sign in first.'); return; }
    return Promise.all([Z.myOfficerSeat(), Z.officerGrantsList(), Z.memberDirectory()]).then(function (res) {
      state.seat = res[0];
      var grants = res[1] || [];
      var dir = res[2] || {};
      state.verified = Object.keys(dir).map(function (k) { return dir[k]; });
      state.myName = (dir[u.id] && dir[u.id].full_name) || (u.email || '').split('@')[0];
      state.seatLabel = state.seat === 'alumni_president' ? 'Alumni President' : '';
      grants.forEach(function (g) { if (g.seat === state.seat && g.enabled) state.grants[g.permission] = true; });
      state.tools = TOOLS.filter(function (t) { return state.grants[t.perm]; });
      renderConsole();
    });
  }).catch(function (e) { root.innerHTML = msg('Something went wrong', esc((e && e.message) || 'Please try again.')); });

  /* ---------------- console shell ---------------- */
  function renderConsole() {
    if (!state.seat) {
      root.innerHTML = msg('For the Alumni Presidents',
        'This console is available to the <b>Alumni Presidents</b>. If that’s you and you’re seeing this, ask the webmaster to confirm your title is set. <a href="index.html">Back to the site</a>.');
      return;
    }

    var nav = state.tools.length
      ? state.tools.map(function (t) {
          return '<button data-tab="' + t.id + '" class="admin-navbtn ' + (state.tab === t.id ? 'on' : '') + '">' +
            '<i>' + t.ic + '</i><span>' + esc(t.label) + '</span></button>';
        }).join('')
      : '';

    root.innerHTML =
      // ---- chapter-registry masthead (full on landing; collapses on tab change) ----
      '<div class="console-masthead" id="masthead">' +
        '<img class="console-masthead__crest" src="assets/img/crest-sm.png" alt="" />' +
        '<span class="console-masthead__eyebrow">Zeta Beta Xi · Chapter Registry · Est. 1993</span>' +
        '<h1 class="console-masthead__title">Officer Console</h1>' +
        '<div class="console-masthead__rule"><i>✦</i></div>' +
        '<p class="console-masthead__seat">Held by <b>' + esc(state.myName) + '</b> — ' + esc(state.seatLabel) + '</p>' +
      '</div>' +
      '<div class="admin-shell">' +
        '<aside class="admin-side">' +
          '<div class="admin-side__id">' +
            '<img class="crest-badge" src="assets/img/crest-sm.png" alt="" />' +
            '<div><b>ΖΒΞ</b><span>Officer Console</span></div>' +
          '</div>' +
          (state.tools.length ? '<button class="admin-side__burger" id="sideBurger" aria-label="Show tools">☰ Tools</button>' : '') +
          '<nav id="tabs" class="admin-side__nav">' +
            (state.tools.length ? '<div class="admin-navgroup">' +
              '<button data-tab="home" class="admin-navbtn ' + (state.tab === 'home' ? 'on' : '') + '"><i>⌂</i><span>Overview</span></button>' +
              '<span class="admin-navgroup__label" style="margin-top:.7rem">Chapter Tools</span>' + nav +
              '</div>' : '') +
          '</nav>' +
          '<button class="btn btn--ghost admin-side__out" id="so">Sign out</button>' +
        '</aside>' +
        '<div class="admin-main">' +
          '<div class="admin-head">' +
            '<div><h2 id="officerTitle">Chapter Tools</h2>' +
            '<span class="admin-head__sub">Signed in as ' + esc(state.seatLabel) + ' — you can only see the tools the webmaster has enabled for you.</span></div>' +
          '</div>' +
          '<div id="q">Loading…</div>' +
        '</div>' +
      '</div>';

    document.getElementById('so').onclick = function () { Z.signOut().then(function () { location.href = 'index.html'; }); };

    var side = root.querySelector('.admin-side');
    var burger = document.getElementById('sideBurger');
    if (burger) burger.onclick = function () { side.classList.toggle('open'); };

    document.getElementById('tabs').querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { enter(b.dataset.tab); };
    });

    if (!state.tools.length) {
      document.getElementById('q').innerHTML =
        '<p class="admin-hint">No officer tools are enabled for you yet. The webmaster turns these on from the ' +
        '<b>Admin Console → Officers</b>. As soon as one is enabled, it will appear in the list on the left.</p>';
      return;
    }
    // The bell links here as officer.html#members (tg_notify_status, upgrade44),
    // but nothing consumed the hash, so an officer following "someone is waiting"
    // landed on the Overview and had to find Approvals himself. Only honoured for
    // a tool he actually holds — an unknown or forbidden hash falls through to
    // the normal default rather than showing him an empty pane.
    var want = (location.hash || '').replace('#', '');
    if (want && state.tools.filter(function (t) { return t.id === want; }).length) state.tab = want;

    if (state.tab !== 'home' && !state.tools.filter(function (t) { return t.id === state.tab; }).length) state.tab = 'home';
    enter(state.tab);
  }

  function renderTab() {
    var q = document.getElementById('q');
    if (!q) return;
    var tool = state.tools.filter(function (t) { return t.id === state.tab; })[0];
    if (!tool) { q.innerHTML = ''; return; }
    document.querySelectorAll('#tabs [data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === state.tab); });
    var h = document.getElementById('officerTitle');
    if (h) h.textContent = tool.label;
    tool.render(q);
  }

  /* ---------------- landing overview ---------------- */
  // 'home' is the default tab: a card per enabled tool with a live count.
  // Clicking a card (or a rail button) enters that tool; "⌂ Overview" returns.
  function enter(tab) {
    state.tab = tab;
    var side = root.querySelector('.admin-side'); if (side) side.classList.remove('open');
    var m = document.getElementById('masthead'); if (m) m.classList.toggle('is-slim', tab !== 'home');
    document.querySelectorAll('#tabs [data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tab === 'home') {
      var h = document.getElementById('officerTitle'); if (h) h.textContent = 'Overview';
      renderHome();
    } else {
      renderTab();
    }
  }

  function renderHome() {
    var q = document.getElementById('q');
    if (!q) return;
    var cards = state.tools.map(function (t) {
      return '<button class="oc-card" data-go="' + t.id + '">' +
        '<span class="oc-card__ic">' + t.ic + '</span>' +
        '<span class="oc-card__label">' + esc(t.label) + '</span>' +
        '<span class="oc-card__meta" data-meta="' + t.id + '">…</span>' +
      '</button>';
    }).join('');
    q.innerHTML =
      '<p class="admin-hint">Welcome, <b>' + esc(state.myName) + '</b>. Here’s what needs attention — pick a tool to jump in.</p>' +
      '<div class="oc-home">' + cards + '</div>';
    q.querySelectorAll('[data-go]').forEach(function (b) {
      b.onclick = function () { enter(b.dataset.go); };
    });
    fillHomeCounts();
  }

  function setMeta(id, txt) {
    var el = document.querySelector('.oc-card [data-meta="' + id + '"]');
    if (el) el.textContent = txt;
  }

  // Fetch a live count for each enabled tool, in parallel, reusing this
  // console's own client calls. Only enabled tools are queried.
  function fillHomeCounts() {
    var have = {};
    state.tools.forEach(function (t) { have[t.id] = true; });
    if (have.members) Z.pendingQueue().then(function (rows) {
      setMeta('members', rows.length ? rows.length + ' waiting' : 'All caught up');
    }).catch(function () { setMeta('members', 'Open →'); });
    if (have.events) Z.eventsList().then(function (rows) {
      // Counts by END, not start — an event happening RIGHT NOW is still upcoming
      // as far as this tile is concerned, and used to silently drop off it.
      var n = rows.filter(function (e) { return !window.ZBXIEvent.isPast(e); }).length;
      setMeta('events', n ? n + ' upcoming' : 'None upcoming');
    }).catch(function () { setMeta('events', 'Open →'); });
    if (have.suggest) Z.suggestionsMine().then(function (rows) {
      var n = rows.filter(function (s) { return s.status === 'new'; }).length;
      setMeta('suggest', n ? n + ' new' : 'All caught up');
    }).catch(function () { setMeta('suggest', 'Open →'); });
    if (have.committees) Z.committeesList().then(function (rows) {
      setMeta('committees', rows.length + (rows.length === 1 ? ' committee' : ' committees'));
    }).catch(function () { setMeta('committees', 'Open →'); });
    if (have.awards) Z.awardsList().then(function (rows) {
      setMeta('awards', rows.length + (rows.length === 1 ? ' award' : ' awards'));
    }).catch(function () { setMeta('awards', 'Open →'); });
    // Invites count the ones still OUTSTANDING — sent and not yet joined. That
    // is the number worth chasing; total-ever is a vanity figure.
    if (have.invite) Z.officerInvitesList().then(function (rows) {
      var out = rows.filter(function (r) { return r.sent_at && !r.accepted_at; }).length;
      setMeta('invite', out ? out + ' awaiting reply' : 'Invite brothers →');
    }).catch(function () { setMeta('invite', 'Invite brothers →'); });
    // needsBig, NOT !big_id — see the note by the helper. The founders have no
    // big and never will; saying so on this card invents a to-do list.
    if (have.records) Z.listFamilyPublic().then(function (rows) {
      var n = rows.filter(needsBig).length;
      setMeta('records', rows.length + ' on the roster' + (n ? ' · ' + n + ' need a big' : ''));
    }).catch(function () { setMeta('records', 'Open →'); });
    if (have.gallery) setMeta('gallery', 'Moderate →');
    if (have.email) setMeta('email', 'Compose →');
    if (have.history) setMeta('history', 'Look something up →');
  }

  /* ================= APPROVALS (upgrade44) =================================
     The signup queue. Every field here comes from pending_queue(), which is the
     only way an officer can see a pending brother at all — and it returns the
     seven vetting fields rather than the whole row.

     The roster flag is a NORMALISED EXACT name match, computed server-side. It
     is deliberately weaker than the fuzzy matcher in the Admin Console, so the
     copy says "check the roster", not "this man is a stranger". */
  function initials(name) {
    return String(name || '').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean)
      .slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase() || 'ΖΒΞ';
  }

  // 'titled' is checked FIRST and beats the roster branches: it is the one flag
  // that changes what this officer is able to do rather than what he should think
  // about. Approving a titled profile would appoint an officer, so upgrade45
  // refuses it server-side — say so here, or he just hits an error he can't read.
  function vetLine(b) {
    if (b.b_flag === 'titled') return '<span class="admin-row__when admin-flag">🚩 This profile carries a chapter title — only the webmaster can approve it.</span>';
    if (b.b_claimed) return '<span class="admin-row__when">✓ Claimed an existing roster entry</span>';
    if (b.b_flag === 'duplicate') return '<span class="admin-row__when cls-warn">≈ Close to a brother already on the roster — possible duplicate.</span>';
    return '<span class="admin-row__when admin-flag">🚩 Name not found on the chapter roster — verify before approving.</span>';
  }

  function renderApprovalsTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading the queue…</p>';
    Z.pendingQueue().then(function (rows) {
      var intro = '<p class="admin-hint">Brothers who signed up and are waiting to be let in. Until you approve him, ' +
        'a brother can’t see the members side of the site at all. <b>Check the name against the chapter roster first</b> — ' +
        'approving opens the whole directory to him. Approving also sends him a welcome email.</p>';
      if (!rows.length) {
        q.innerHTML = intro + '<p class="admin-empty">🎉 Nobody is waiting. All caught up.</p>' + UNDO_SLOT;
        renderUndoBlock();
        return;
      }
      q.innerHTML = intro + rows.map(function (b) {
        return '<div class="admin-row" data-p="' + esc(b.b_id) + '">' +
          '<div class="admin-row__ph">' + esc(initials(b.b_name)) + '</div>' +
          '<div class="admin-row__info"><b>' + esc(b.b_name) + '</b>' +
            '<span>' + esc(b.b_class || 'no pledge class given') + '</span>' +
            (b.b_signed_up ? '<span class="admin-row__when">Signed up ' + esc(stamp(b.b_signed_up)) + '</span>' : '') +
            '<span class="admin-row__email">✉️ ' + esc(b.b_email || 'no email on file') + '</span>' +
            vetLine(b) +
          '</div>' +
          '<div class="admin-row__act">' + btn('ok', 'Approve', 'gold') + btn('no', 'Reject', 'danger') + '</div>' +
        '</div>';
      }).join('') + UNDO_SLOT;
      renderUndoBlock();

      q.querySelectorAll('[data-p]').forEach(function (el) {
        var id = el.dataset.p;
        var b = rows.filter(function (x) { return x.b_id === id; })[0];
        function decide(decision) {
          el.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
          Z.decidePending(id, decision).then(function () {
            // The welcome email rides behind a successful approval and never
            // blocks it — same contract as the Admin Console.
            if (decision === 'verified') Z.notifyApproved(id).catch(function () {});
            renderTab();
          }).catch(function (e) {
            el.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
            // ZBXIAsk escapes body/title itself — pass raw text, never esc()'d.
            ZBXIAsk.alert({ title: 'Could not save that', body: (e && e.message) || 'Please try again.' });
          });
        }
        each(el, '[data-ok]', function () {
          ZBXIAsk.confirm({ title: 'Approve ' + b.b_name + '?',
            body: 'He gets access to the full directory, family tree, gallery and board, and a welcome email.',
            ok: 'Approve' }, function () { decide('verified'); });
        });
        each(el, '[data-no]', function () {
          ZBXIAsk.confirm({ title: 'Reject ' + b.b_name + '?',
            body: 'He stays locked out. Nothing is deleted — the webmaster can restore him from the Admin Console.',
            ok: 'Reject', danger: true }, function () { decide('rejected'); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load the queue: ' + esc(e.message || '') + '</p>'; });
  }

  /* ---- undo: the correction path for the queue (upgrade46) ------------------
     Rides on members.approve rather than a switch of its own — being able to
     approve but not to fix your own mistake is the state this replaced.

     A decision is undoable only if decided_by matches the caller, which a
     trigger stamps and a client cannot spoof. So this list is short by
     construction: it is HIS decisions, not the chapter's. Anything decided
     before upgrade46, or by the server, has a null decided_by and can never
     appear here. */
  var UNDO_SLOT = '<div id="undoBlock"></div>';

  function renderUndoBlock() {
    var box = document.getElementById('undoBlock');
    if (!box) return;
    Z.myRecentDecisions().then(function (rows) {
      if (!rows.length) { box.innerHTML = ''; return; }
      box.innerHTML =
        '<h3 class="stat-h">Decisions you made</h3>' +
        '<p class="admin-hint">Changed your mind, or clicked the wrong button? Putting a brother back in the queue ' +
        'undoes the decision — it does not delete anything. You can only undo your own decisions.</p>' +
        rows.map(function (r) {
          var chip = r.d_status === 'verified'
            ? '<span class="schip schip--active">● Approved</span>'
            : '<span class="schip schip--warn">Rejected</span>';
          return '<div class="admin-row" data-u="' + esc(r.d_id) + '">' +
            '<div class="admin-row__ph">' + esc(initials(r.d_name)) + '</div>' +
            '<div class="admin-row__info"><b>' + esc(r.d_name) + ' ' + chip + '</b>' +
              (r.d_at ? '<span class="admin-row__when">' + esc(stamp(r.d_at)) + '</span>' : '') +
              (r.d_locked ? '<span class="admin-row__when admin-flag">🚩 Carries a chapter title — only the webmaster can change this one.</span>' : '') +
            '</div>' +
            // Not offered on a titled row rather than offered-and-refused: the
            // server raises either way, but a dead button reads as a broken site.
            (r.d_locked ? '' : '<div class="admin-row__act">' + btn('undo', 'Put back in the queue', '') + '</div>') +
          '</div>';
        }).join('');

      box.querySelectorAll('[data-u]').forEach(function (el) {
        var id = el.dataset.u;
        var r = rows.filter(function (x) { return x.d_id === id; })[0];
        each(el, '[data-undo]', function () {
          ZBXIAsk.confirm({
            title: 'Put ' + r.d_name + ' back in the queue?',
            body: r.d_status === 'verified'
              ? 'He loses access to the members side again until someone approves him. He is not deleted, and he keeps his account.'
              : 'He goes back to waiting, so he can be approved instead. Nothing was deleted when you rejected him.',
            ok: 'Put back'
          }, function () {
            el.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
            Z.undoMyDecision(id).then(function () { renderTab(); }).catch(function (e) {
              el.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
              ZBXIAsk.alert({ title: 'Could not undo that', body: (e && e.message) || 'Please try again.' });
            });
          });
        });
      });
    }).catch(function () { box.innerHTML = ''; });   // never break the queue above it
  }

  /* ================= INVITE (upgrade46) =====================================
     The chapter's alumni address book lives with the Alumni President, not with
     the webmaster, so this is the tool that most needed handing over.

     Deliberately NOT included from the Admin Console's version of this tab: the
     monthly digest. zbxi-digest is still admin-gated, and a "Send to all
     brothers" button that 403s would be worse than no button. */
  function renderInviteTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading…</p>';
    // officerInvitesList, NOT invitesList: the latter is select('*') on a table
    // that carries `token`, which is a credential. See supabase-client.js.
    Z.officerInvitesList().then(function (rows) {
      var sent = rows.filter(function (r) { return r.sent_at; }).length;
      var joined = rows.filter(function (r) { return r.accepted_at; }).length;
      var invited = {};
      rows.forEach(function (r) { invited[String(r.email).toLowerCase()] = r; });

      q.innerHTML =
        '<div class="acct-block"><h4>✉️ Invite brothers to claim their profile</h4>' +
        '<p class="form-note" style="margin-top:0">Most brothers on the tree have no account yet — so they never see the gallery, ' +
        'board or directory. Paste their emails (one per line, up to 25) and each gets a personal invite with a link to claim his name. ' +
        '<b>Only invite brothers you know.</b> This is a personal invitation, not a mailing list.</p>' +
        '<div class="field"><label>Email addresses</label><textarea id="invEmails" rows="5" placeholder="john.smith@gmail.com&#10;mike.jones@yahoo.com"></textarea></div>' +
        '<button class="btn btn--gold" id="invSend">Send invitations</button>' +
        '<p class="form-status" id="invStatus"></p></div>' +

        '<h3 class="stat-h">Invitations (' + sent + ' sent · ' + joined + ' joined)</h3>' +
        (rows.length
          ? rows.map(function (r) {
              var status = r.accepted_at ? '<span class="schip schip--active">● Joined</span>'
                         : r.sent_at ? '<span class="schip">Sent</span>'
                         : '<span class="schip schip--warn">Failed</span>';
              var when = stamp(r.sent_at || r.created_at) + (r.accepted_at ? ' · joined ' + stamp(r.accepted_at) : '');
              return '<div class="admin-row"><div class="admin-row__ph">✉️</div>' +
                '<div class="admin-row__info"><b>' + esc(r.email) + ' ' + status + '</b>' +
                '<span>' + esc(when) + (r.error ? ' · ⚠ ' + esc(r.error) : '') + '</span></div></div>';
            }).join('')
          : '<p class="admin-empty">No invitations sent yet.</p>');

      document.getElementById('invSend').onclick = function () {
        var b = this, st = document.getElementById('invStatus');
        var emails = document.getElementById('invEmails').value.split(/[\s,;]+/)
          .map(function (e) { return e.trim(); }).filter(Boolean);
        if (!emails.length) { st.className = 'form-status err'; st.textContent = 'Paste at least one email address.'; return; }
        if (emails.length > 25) { st.className = 'form-status err'; st.textContent = 'Send at most 25 at a time.'; return; }

        var dupes = emails.filter(function (e) { var i = invited[e.toLowerCase()]; return i && i.sent_at; });
        var go = function () {
          b.disabled = true; b.textContent = 'Queueing…';
          st.className = 'form-status'; st.textContent = '';
          Z.inviteBrothers(emails, null).then(function (r) {
            if (r.error) { st.className = 'form-status err'; st.textContent = r.error; b.disabled = false; b.textContent = 'Send invitations'; return; }
            var failed = (r.results || []).filter(function (x) { return !x.ok; });
            st.className = failed.length ? 'form-status err' : 'form-status ok';
            st.textContent = '✓ Queued ' + r.queued + ' invitation' + (r.queued === 1 ? '' : 's') +
              ' — they go out over the next day or so.' +
              (failed.length ? ' · ' + failed.length + ' failed: ' + failed[0].error : '');
            setTimeout(function () { renderTab(); }, 1200);
          }).catch(function (e) {
            st.className = 'form-status err'; st.textContent = String((e && e.message) || e);
            b.disabled = false; b.textContent = 'Send invitations';
          });
        };
        // ZBXIAsk escapes its own body — pass raw text.
        if (dupes.length) {
          ZBXIAsk.confirm({ title: 'Some of these were already invited',
            body: 'Already invited: ' + dupes.join(', ') + '. Send again anyway?', ok: 'Send again' }, go);
        } else { go(); }
      };
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load invitations: ' + esc((e && e.message) || '') + '</p>'; });
  }

  /* ================= RECORDS (upgrade46) ====================================
     Roster facts only — name, pledge class, graduation year, and who his big is.
     The form has no field for status, title, or account because the FUNCTION has
     no parameter for them (officer_update_brother, upgrade46). Nothing here is
     hidden UI that a determined browser could re-enable.

     Reads family_public: it is the roster view every brother can already see,
     and it carries exactly the four editable fields plus the id. Checked on the
     live database — it holds all 359 verified brothers and no pending ones, so
     a brother still in the queue is corrected after he is approved, not before. */
  function bigOptionsFor(b, all) {
    return ['<option value="">— none —</option>'].concat(
      all.filter(function (v) { return v.id !== b.id; })
        .sort(function (x, y) { return String(x.full_name).localeCompare(String(y.full_name)); })
        .map(function (v) {
          return '<option value="' + esc(v.id) + '"' + (b.big_id === v.id ? ' selected' : '') + '>' +
            esc(v.full_name) + (v.pledge_class ? ' · ' + esc(v.pledge_class) : '') + '</option>';
        })
    ).join('');
  }

  function renderRecordsTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading the roster…</p>';
    // The webmaster's row is fetched alongside the roster because family_public carries no
    // email — see Z.adminBrotherId. It stays IN the list (it is a real brother on the public
    // roster, and hiding it here would be a different kind of lie); it just loses its Edit
    // button. The server refuses the edit either way; this only explains why.
    Promise.all([Z.listFamilyPublic(), Z.adminBrotherId()]).then(function (res) {
      var all = res[0] || [], adminBid = res[1];
      var byId = {};
      all.forEach(function (b) { byId[b.id] = b; });

      // The worklist. Without it this tab told an officer that N brothers need a
      // big and then made him guess their names to find them. Hidden entirely
      // when there is nothing to do, so it never nags — same rule as admin.js.
      var need = all.filter(needsBig);
      var onlyNeed = false;

      q.innerHTML =
        '<p class="admin-hint">Fix a misspelled name, a wrong pledge class or graduation year, and record who someone’s ' +
        '<b>big brother</b> is — that last one is what draws the family tree. You cannot change a brother’s status, his ' +
        'chapter title, or which account he is attached to; those stay with the webmaster.</p>' +
        (need.length ? '<div class="admin-addbar"><button class="btn btn--ghost" id="recNeedBig">⚠️ ' +
          need.length + ' need a big</button></div>' : '') +
        // --on-navy-2, not the default: .field label is var(--heading) (navy),
        // which is right inside a cream modal and INVISIBLE here -- this is the
        // only .field in either console painted straight onto the navy shell.
        // Measured before and after: contrast 1.1 -> 11.4. Using the token rather
        // than a literal is what makes it flip correctly in dark mode.
        '<div class="field"><label style="color:var(--on-navy-2)">Find a brother</label>' +
        '<input id="recFind" placeholder="Type a name or pledge class…" autocomplete="off"></div>' +
        '<div id="recList"></div>';

      function draw(filter) {
        var f = String(filter || '').trim().toLowerCase();
        var list = document.getElementById('recList');
        var rows;
        if (onlyNeed) {
          rows = need.filter(function (b) {
            return !f || String(b.full_name || '').toLowerCase().indexOf(f) > -1 ||
                   String(b.pledge_class || '').toLowerCase().indexOf(f) > -1;
          });
        } else {
          rows = !f ? [] : all.filter(function (b) {
            return String(b.full_name || '').toLowerCase().indexOf(f) > -1 ||
                   String(b.pledge_class || '').toLowerCase().indexOf(f) > -1;
          }).slice(0, 40);
        }
        if (!f && !onlyNeed) {
          list.innerHTML = '<p class="admin-empty">Start typing to find one of the ' + all.length +
            ' brothers on the roster' + (need.length ? ', or use the button above to see the ' +
            need.length + ' who need a big' : '') + '.</p>';
          return;
        }
        if (!rows.length) {
          list.innerHTML = '<p class="admin-empty">' + (f
            ? 'Nobody matches “' + esc(filter) + '”' + (onlyNeed ? ' among those needing a big' : '') + '.'
            : '🎉 Every brother who should have a big has one.') + '</p>';
          return;
        }
        list.innerHTML = rows.map(function (b) {
          var big = b.big_id && byId[b.big_id] ? byId[b.big_id].full_name : null;
          // Three states, not two. A founder has no big and never will — calling
          // that "no big recorded" flags the founding class as broken data on the
          // one screen an officer is told to go fix things on.
          var bigCell = big ? 'Big: ' + big
                       : needsBig(b) ? '⚠️ no big recorded'
                       : 'root of the family tree';
          var meta = [b.pledge_class, (b.grad_year ? "'" + String(b.grad_year).slice(-2) : null),
                      bigCell].filter(Boolean).map(esc).join(' · ');
          return '<div class="admin-row" data-r="' + esc(b.id) + '">' +
            '<div class="admin-row__ph">' + esc(initials(b.full_name)) + '</div>' +
            '<div class="admin-row__info"><b>' + esc(b.full_name) + '</b><span>' + meta + '</span></div>' +
            '<div class="admin-row__act">' + (b.id === adminBid
              ? '<span class="admin-row__locked">🔒 Webmaster account — managed by the site administrator</span>'
              : btn('edit', 'Edit', '')) + '</div></div>';
        }).join('');
        list.querySelectorAll('[data-r]').forEach(function (el) {
          each(el, '[data-edit]', function () { openRecordEdit(byId[el.dataset.r], all); });
        });
      }

      var find = document.getElementById('recFind');
      var t = null;
      find.oninput = function () { clearTimeout(t); var v = find.value; t = setTimeout(function () { draw(v); }, 120); };

      var nb = document.getElementById('recNeedBig');
      if (nb) nb.onclick = function () {
        onlyNeed = !onlyNeed;
        nb.className = 'btn ' + (onlyNeed ? 'btn--gold' : 'btn--ghost');
        nb.textContent = onlyNeed ? '← Search everyone' : '⚠️ ' + need.length + ' need a big';
        draw(find.value);
      };
      draw('');
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load the roster: ' + esc((e && e.message) || '') + '</p>'; });
  }

  function openRecordEdit(b, all) {
    if (!b) return;
    var wrap = treeModal('Edit ' + esc(b.full_name),
      '<div class="form-row">' +
        '<div class="field"><label>Full name *</label><input data-f="full_name" value="' + esc(b.full_name) + '"></div>' +
        '<div class="field"><label>Pledge class</label><input data-f="pledge_class" value="' + esc(b.pledge_class) + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="field"><label>Graduation year</label><input data-f="grad_year" type="number" value="' + esc(b.grad_year) + '"></div>' +
        '<div class="field"><label>Big brother</label><select data-f="big_id">' + bigOptionsFor(b, all) + '</select></div>' +
      '</div>' +
      '<p class="form-note" style="margin:0 0 .8rem">Graduation year is what decides whether a brother is listed as Active or Alumni. ' +
      'Changing a big redraws the family tree.</p>' +
      '<button class="btn btn--navy" data-save style="width:100%">Save changes</button>');

    var get = function (f) { return wrap.querySelector('[data-f="' + f + '"]'); };
    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      st.className = 'form-status'; st.textContent = 'Saving…';
      Z.officerUpdateBrother(b.id, {
        full_name: get('full_name').value,
        pledge_class: get('pledge_class').value,
        grad_year: get('grad_year').value,
        big_id: get('big_id').value
      }).then(function () {
        wrap.close();
        renderTab();
      }).catch(function (e) {
        // The server refuses a loop in the tree, a big who isn't a verified
        // brother, and an empty name. Show its own words — they are written to
        // be read by a person.
        st.className = 'form-status err'; st.textContent = (e && e.message) || 'Could not save that.';
      });
    };
  }

  /* ================= HISTORY (upgrade46) ====================================
     Read-only, and the SERIOUS actions only — deletions, membership decisions,
     permission and title changes. The filter is applied server-side by
     activity_feed(); the everyday noise (profile edits, gallery posts, comments,
     replies) is never sent to the browser at all. Officers hold real power now,
     and being able to see what was done with it is what makes that safe. */
  var OC_ACT = {
    member_deleted: 'DELETED a brother record', member_approved: 'approved a brother',
    member_rejected: 'rejected a brother', status_changed: 'changed a brother’s status',
    record_edited: 'corrected a roster record',
    grant_enabled: 'GAVE an officer a permission', grant_disabled: 'REMOVED an officer permission',
    title_granted: 'granted a title', title_removed: 'removed a title',
    event_deleted: 'DELETED an event', poll_deleted: 'DELETED a poll',
    album_deleted: 'DELETED a gallery section', gallery_post_deleted: 'DELETED a gallery photo'
  };

  function renderHistoryTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading…</p>';
    Z.activityFeed().then(function (rows) {
      var intro = '<p class="admin-hint">Everything that <b>removed</b> something or <b>changed who can do what</b> — by you, ' +
        'by the webmaster, or by another officer. Everyday activity (photos, comments, profile edits) is not listed here. ' +
        'This is a record, not a control panel: nothing on this page can be undone from it.</p>';
      if (!rows.length) { q.innerHTML = intro + '<p class="admin-empty">Nothing recorded yet.</p>'; return; }
      q.innerHTML = intro + '<div class="stat-list">' + rows.map(function (a) {
        return '<div class="stat-list__row stat-list__row--warn">' +
          '<b>' + esc(a.a_actor) + ' · ' + esc(OC_ACT[a.a_action] || a.a_action) + '</b>' +
          '<span>' + esc(a.a_detail || '') + '</span><em>' + esc(stamp(a.a_at)) + '</em></div>';
      }).join('') + '</div>';
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load the history: ' + esc((e && e.message) || '') + '</p>'; });
  }

  /* ================= EVENTS (own copy; no announcement-banner editor) ======= */
  var EV_CATS = ['rush', 'philanthropy', 'reunion', 'meeting', 'social'];

  function renderEventsTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading events…</p>';
    Z.eventsList().then(function (rows) {
      state.events = rows;
      var list = rows.length ? rows.map(function (e) {
        // Both via event-when.js. This row used to format from starts_at alone,
        // so a 13-day Reunion read as one moment; and `past` keyed on the START,
        // so a still-running event greyed itself out from its second day.
        var when = window.ZBXIEvent.when(e);
        var past = window.ZBXIEvent.isPast(e);
        return '<div class="admin-row' + (past ? ' admin-row--past' : '') + '" data-ev="' + e.id + '">' +
          '<div class="admin-row__ph">📅</div>' +
          '<div class="admin-row__info"><b>' + esc(e.title) + (e.all_day ? ' <span class="tab-count">all-day</span>' : '') + '</b>' +
            '<span>' + esc(when) + (e.location ? ' · ' + esc(e.location) : '') + ' · ' + esc(e.category) + '</span></div>' +
          '<div class="admin-row__act">' + btn('evedit', 'Edit', 'ghost') + btn('evdel', 'Delete', 'danger') + '</div></div>';
      }).join('') : '<p class="admin-empty">No events yet — add the first one.</p>';

      // "Open the calendar" mirrors the Gallery tool's affordance — this tool
      // manages the same events brothers see on /events, and there was no way to
      // get there from here.
      q.innerHTML = '<p class="admin-hint">Add and edit the chapter calendar. Every event is visible to signed-in brothers.</p>' +
        '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="evNew">+ New event</button> ' +
        '<a class="btn btn--ghost" href="events.html">Open the calendar →</a></p>' + list;
      document.getElementById('evNew').onclick = function () { openEventEdit(null); };
      q.querySelectorAll('[data-ev]').forEach(function (el) {
        var ev = state.events.filter(function (x) { return x.id === el.dataset.ev; })[0];
        each(el, '[data-evedit]', function () { openEventEdit(ev); });
        each(el, '[data-evdel]', function () {
          ZBXIAsk.confirm({ title: 'Delete event', body: 'Delete "' + ev.title + '"?', ok: 'Delete', danger: true },
            function () { Z.eventDelete(ev.id).then(function () { renderTab(); }); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load events: ' + esc(e.message || '') + '</p>'; });
  }

  function toLocalInput(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openEventEdit(e) {
    e = e || {};
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x aria-label="Close">✕</button>' +
      '<h3>' + (e.id ? 'Edit event' : 'New event') + '</h3>' +
      '<div class="field"><label>Title *</label><input data-f="title" value="' + esc(e.title) + '"></div>' +
      '<div class="field"><label class="pref-box"><input type="checkbox" data-f="all_day"' + (e.all_day ? ' checked' : '') + '> All-day event (no start/end time)</label></div>' +
      '<div class="form-row">' +
        '<div class="field"><label>Starts *</label><input data-f="starts_at" type="datetime-local" value="' + toLocalInput(e.starts_at) + '"></div>' +
        '<div class="field"><label>Ends</label><input data-f="ends_at" type="datetime-local" value="' + toLocalInput(e.ends_at) + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="field"><label>Location</label><input data-f="location" value="' + esc(e.location) + '"></div>' +
        '<div class="field"><label>Category</label><select data-f="category">' +
          EV_CATS.map(function (c) { return '<option' + ((e.category || 'social') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>Description</label><textarea data-f="description">' + esc(e.description) + '</textarea></div>' +
      '<p class="form-note" style="margin:0 0 .8rem">🔒 The calendar is members-only — every event is visible to signed-in brothers.</p>' +
      '<button class="btn btn--navy" data-save style="width:100%">' + (e.id ? 'Save changes' : 'Create event') + '</button>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); document.removeEventListener('keydown', onEsc); }
    function onEsc(ev3) { if (ev3.key === 'Escape') close(); }
    document.addEventListener('keydown', onEsc);
    wrap.addEventListener('click', function (ev2) { if (ev2.target === wrap || ev2.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      var get = function (k) { return wrap.querySelector('[data-f="' + k + '"]'); };
      var row = {
        title: get('title').value.trim(),
        all_day: get('all_day').checked,
        starts_at: get('starts_at').value ? new Date(get('starts_at').value).toISOString() : null,
        ends_at: get('ends_at').value ? new Date(get('ends_at').value).toISOString() : null,
        location: get('location').value.trim() || null,
        category: get('category').value,
        description: get('description').value.trim() || null
      };
      if (!row.title || !row.starts_at) { st.className = 'form-status err'; st.textContent = 'Title and start time are required.'; return; }
      st.className = 'form-status'; st.textContent = 'Saving…';
      (e.id ? Z.eventUpdate(e.id, row) : Z.eventCreate(row)).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); renderTab();
      });
    };
  }

  /* ================= AWARDS (own copy) ===================================== */
  var PILLARS = [
    { id: 'community',      ic: '★', label: 'Community' },
    { id: 'service',        ic: '✚', label: 'Service' },
    { id: 'leadership',     ic: '♛', label: 'Leadership' },
    { id: 'responsibility', ic: '⚖', label: 'Responsibility' },
    { id: 'other',          ic: '◆', label: 'Other' }
  ];
  function pillarOf(id) { return PILLARS.filter(function (p) { return p.id === id; })[0] || PILLARS[4]; }

  function renderAwardsTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading awards…</p>';
    Z.awardsList().then(function (rows) {
      var years = [];
      rows.forEach(function (a) { if (years.indexOf(a.year_label) === -1) years.push(a.year_label); });
      var html = '<p class="admin-hint">These are the gold medallions in the <b>Recognized Excellence</b> section of the homepage. ' +
        'Add each year’s Greek awards here — the homepage updates itself and older years become a little archive.</p>' +
        '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="awNew">+ Add award</button></p>';
      if (!rows.length) {
        html += '<p class="admin-empty">No awards saved yet.</p>';
      } else {
        years.forEach(function (y) {
          html += '<h4 class="aw-year">' + esc(y) + '</h4>' + rows.filter(function (a) { return a.year_label === y; }).map(function (a) {
            var p = pillarOf(a.pillar);
            return '<div class="admin-row" data-aw="' + a.id + '">' +
              '<div class="admin-row__ph">' + p.ic + '</div>' +
              '<div class="admin-row__info"><b>' + esc(a.title) + '</b><span>' + p.label + (a.note ? ' · ' + esc(a.note) : '') + '</span></div>' +
              '<div class="admin-row__act">' + btn('awedit', 'Edit', 'ghost') + btn('awdel', 'Delete', 'danger') + '</div></div>';
          }).join('');
        });
      }
      q.innerHTML = html;
      document.getElementById('awNew').onclick = function () { openAwardEdit(null, years[0] || ''); };
      q.querySelectorAll('[data-aw]').forEach(function (el) {
        var a = rows.filter(function (x) { return x.id === el.dataset.aw; })[0];
        each(el, '[data-awedit]', function () { openAwardEdit(a); });
        each(el, '[data-awdel]', function () {
          ZBXIAsk.confirm({ title: 'Delete award', body: 'Delete "' + a.title + '" from the homepage?', ok: 'Delete', danger: true },
            function () { Z.awardDelete(a.id).then(function () { renderTab(); }); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load awards: ' + esc(e.message || '') + '</p>'; });
  }

  function openAwardEdit(a, presetYear) {
    a = a || {};
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x aria-label="Close">✕</button>' +
      '<h3>' + (a.id ? 'Edit award' : 'Add award') + '</h3>' +
      '<div class="form-row">' +
        '<div class="field"><label>Academic year *</label><input data-f="year_label" value="' + esc(a.year_label || presetYear || '') + '" placeholder="e.g. 2025–26"></div>' +
        '<div class="field"><label>Pillar</label><select data-f="pillar">' +
          PILLARS.map(function (p) { return '<option value="' + p.id + '"' + ((a.pillar || 'community') === p.id ? ' selected' : '') + '>' + p.ic + ' ' + p.label + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>Award title *</label><input data-f="title" value="' + esc(a.title) + '" placeholder="e.g. Greek Community Badge"></div>' +
      '<div class="field"><label>One-line note (optional)</label><input data-f="note" value="' + esc(a.note) + '" placeholder="e.g. Awarded for chapter-wide philanthropy hours"></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">' + (a.id ? 'Save changes' : 'Add to homepage') + '</button>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); document.removeEventListener('keydown', onEsc); }
    function onEsc(ev3) { if (ev3.key === 'Escape') close(); }
    document.addEventListener('keydown', onEsc);
    wrap.addEventListener('click', function (ev2) { if (ev2.target === wrap || ev2.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      var get = function (k) { return wrap.querySelector('[data-f="' + k + '"]'); };
      var row = {
        year_label: get('year_label').value.trim(),
        pillar: get('pillar').value,
        title: get('title').value.trim(),
        note: get('note').value.trim() || null
      };
      if (!row.year_label || !row.title) { st.className = 'form-status err'; st.textContent = 'Year and title are required.'; return; }
      st.className = 'form-status'; st.textContent = 'Saving…';
      (a.id ? Z.awardUpdate(a.id, row) : Z.awardCreate(row)).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); renderTab();
      });
    };
  }

  /* ================= COMMITTEES (own copy) ================================= */
  function treeModal(title, bodyHtml) {
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML = '<div class="admin-modal__card"><button class="admin-modal__close" data-x aria-label="Close">✕</button>' +
      '<h3>' + title + '</h3>' + bodyHtml + '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function onEsc(e) { if (e.key === 'Escape') wrap.close(); }
    wrap.close = function () { wrap.remove(); document.removeEventListener('keydown', onEsc); };
    document.addEventListener('keydown', onEsc);
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) wrap.close(); });
    return wrap;
  }

  function renderCommitteesTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading committees…</p>';
    Z.committeesList().then(function (cs) {
      q.innerHTML =
        '<p class="admin-hint">Each committee gets a private space on the Board that only its members (and the webmaster) can see. Only brothers with accounts can be added.</p>' +
        '<div class="admin-addbar"><button class="btn btn--gold" id="commNew">+ New committee</button></div>' +
        (cs.length ? cs.map(function (c) {
          return '<div class="admin-row" data-comm="' + c.id + '">' +
            '<div class="admin-row__ph">👥</div>' +
            '<div class="admin-row__info"><b>' + esc(c.name) + '</b><span data-commcount>…</span></div>' +
            '<div class="admin-row__act">' +
              '<button class="btn btn--ghost" data-members>Members</button>' +
              '<button class="btn btn--danger" data-del>Delete</button>' +
            '</div></div>';
        }).join('') : '<p class="admin-empty">No committees yet.</p>');

      document.getElementById('commNew').onclick = function () {
        ZBXIAsk.text({ title: 'New committee', placeholder: 'e.g. Rush Committee', ok: 'Create' }, function (name) {
          Z.committeeCreate(name).then(function () { renderTab(); });
        });
      };
      q.querySelectorAll('[data-comm]').forEach(function (el) {
        var c = cs.filter(function (x) { return x.id === el.dataset.comm; })[0];
        Z.committeeMembers(c.id).then(function (ids) {
          el.querySelector('[data-commcount]').textContent = ids.length + ' member' + (ids.length === 1 ? '' : 's');
        });
        each(el, '[data-members]', function () { openCommitteeMembers(c); });
        each(el, '[data-del]', function () {
          ZBXIAsk.confirm({ title: 'Delete committee', body: 'Delete "' + c.name + '"? Its private threads are deleted too.', ok: 'Delete', danger: true },
            function () { Z.committeeDelete(c.id).then(function () { renderTab(); }); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load committees: ' + esc(e.message || '') + '</p>'; });
  }

  function openCommitteeMembers(c) {
    var registered = state.verified.filter(function (b) { return b.user_id; });
    var wrap = treeModal('👥 ' + esc(c.name),
      '<div class="field"><label>Add a brother (accounts only)</label><select data-f="add">' +
        '<option value="">— pick a brother —</option>' +
        registered.sort(function (x, y) { return x.full_name.localeCompare(y.full_name); })
          .map(function (b) { return '<option value="' + b.user_id + '">' + esc(b.full_name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div data-list><p class="form-note">Loading members…</p></div>');
    function refreshList() {
      Z.committeeMembers(c.id).then(function (ids) {
        var box = wrap.querySelector('[data-list]');
        if (!ids.length) { box.innerHTML = '<p class="form-note">No members yet.</p>'; return; }
        box.innerHTML = ids.map(function (uid) {
          var b = registered.filter(function (x) { return x.user_id === uid; })[0];
          return '<div class="stat-list__row"><b>' + esc(b ? b.full_name : 'Unknown account') + '</b>' +
            '<em><a href="#" data-rm="' + uid + '">remove</a></em></div>';
        }).join('');
        box.querySelectorAll('[data-rm]').forEach(function (a) {
          a.onclick = function (e) { e.preventDefault(); Z.committeeRemove(c.id, a.dataset.rm).then(refreshList); };
        });
      });
    }
    refreshList();
    wrap.querySelector('[data-f="add"]').onchange = function (e) {
      if (!e.target.value) return;
      Z.committeeAdd(c.id, e.target.value).then(function () { e.target.value = ''; refreshList(); });
    };
  }

  /* ================= SUGGESTIONS (own copy; respond + archive, no delete) == */
  function renderSuggestTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading suggestions…</p>';
    Z.suggestionsMine().then(function (rows) { // RLS returns what this officer may see
      var groups = { new: [], responded: [], archived: [] };
      rows.forEach(function (s) { (groups[s.status] || groups.new).push(s); });

      function block(title, list, showActions) {
        if (!list.length) return '';
        return '<h3 class="stat-h">' + title + ' (' + list.length + ')</h3>' + list.map(function (s) {
          return '<div class="sug-card" data-sug="' + s.id + '">' +
            '<p class="sug-card__body">' + esc(s.body) + '</p>' +
            '<small>' + stamp(s.created_at) + (s.responded_at ? ' · replied ' + stamp(s.responded_at) : '') + '</small>' +
            (s.response ? '<p class="sug-card__resp">↩ ' + esc(s.response) + '</p>' : '') +
            (showActions
              ? '<div class="sug-card__act">' +
                  '<textarea data-resp placeholder="Write a response — the brother gets a 🔔"></textarea>' +
                  '<div><button class="btn btn--gold" data-send>Respond</button>' +
                  '<button class="btn btn--ghost" data-arch>Archive</button></div></div>'
              : '<div class="sug-card__act"><button class="btn btn--ghost" data-arch>Archive</button></div>') +
          '</div>';
        }).join('');
      }

      q.innerHTML = '<p class="admin-hint">Read and respond to member suggestions. Your reply sends the brother a notification. (Deleting a suggestion stays with the webmaster.)</p>' +
        (rows.length
          ? block('🆕 New', groups.new, true) + block('✅ Responded', groups.responded, false) + block('📦 Archived', groups.archived, false)
          : '<p class="admin-empty">No suggestions yet — brothers submit them from the Board page.</p>');

      q.querySelectorAll('[data-sug]').forEach(function (el) {
        var id = el.dataset.sug;
        var send = el.querySelector('[data-send]');
        if (send) send.onclick = function () {
          var resp = el.querySelector('[data-resp]').value.trim();
          if (!resp) return;
          Z.suggestionUpdate(id, { response: resp, status: 'responded', responded_at: new Date().toISOString() })
            .then(function () { renderTab(); });
        };
        var arch = el.querySelector('[data-arch]');
        if (arch) arch.onclick = function () { Z.suggestionUpdate(id, { status: 'archived' }).then(function () { renderTab(); }); };
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load suggestions: ' + esc(e.message || '') + '</p>'; });
  }

  /* ================= GALLERY (moderation happens on the Gallery page) ====== */
  function renderGalleryTab(q) {
    q.innerHTML = '<p class="admin-hint">You can remove inappropriate posts and comments. Moderation happens right on the gallery itself: ' +
      'open the <b>Gallery</b>, and a <b>Delete</b> button appears on every post and comment for you.</p>' +
      '<p style="margin-top:1rem"><a class="btn btn--gold" href="gallery.html">Open the Gallery →</a></p>';
  }

})();
