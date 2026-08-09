/* Members-only discussion board: category tabs (Chapter Business / Advice /
   Social / Opportunities), thread list -> thread view with replies, new-thread
   composer. Opportunities threads carry an Offering/Seeking tag (job board).
   RLS-gated server-side. Renders into #boardRoot. */
(function () {
  'use strict';
  var root = document.getElementById('boardRoot');
  if (!root) return;
  var Z = window.ZBXI;

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function when(ts) {
    var d = new Date(ts), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.round(diff / 86400) + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  var CATS = [
    { id: 'introductions', label: 'Introductions',    ic: '👋', desc: 'New here? Say hi — your class, where you landed, what you’re up to.' },
    { id: 'chapter',       label: 'Chapter Business', ic: '⚖️', desc: 'Official chapter matters — meetings, votes, house business.' },
    { id: 'advice',        label: 'Advice',           ic: '🧭', desc: 'Classes, careers, life — ask the brotherhood anything.' },
    { id: 'social',        label: 'Social',           ic: '🎉', desc: 'Plans, memories, class threads and everything fun.' },
    { id: 'opportunities', label: 'Opportunities',    ic: '💼', desc: 'Jobs, internships and referrals — offering or seeking.' }
  ];
  // Introductions has its own composer (introCard) — it's never a "+ New thread" target.
  var POSTABLE = CATS.filter(function (c) { return c.id !== 'introductions'; });
  function catLabel(id) {
    if (id === 'all') return 'the board';
    // esc() the fallthrough: `id` can be a DB `category`, which is client-supplied
    // (RLS doesn't constrain it) and lands unescaped in emptyState/renderCompose.
    // Don't make the CHECK constraint the only thing standing between us and HTML.
    var c = CATS.filter(function (x) { return x.id === id; })[0]; return c ? c.label : esc(id);
  }
  function catMeta(id) { return CATS.filter(function (x) { return x.id === id; })[0] || null; }

  /* ---------- unread tracking (per browser) ---------- */
  function seenMap() { try { return JSON.parse(localStorage.getItem('zbxi_seen') || '{}'); } catch (e) { return {}; } }
  function markSeen(id) {
    var m = seenMap(); m[id] = Date.now();
    try { localStorage.setItem('zbxi_seen', JSON.stringify(m)); } catch (e) {}
  }
  function lastActivity(t) { return (META[t.id] && META[t.id].lastAt) || t.created_at; }
  function isUnread(t) {
    var seen = seenMap()[t.id];
    return !seen || new Date(lastActivity(t)).getTime() > seen;
  }
  function isHot(t) { return Date.now() - new Date(lastActivity(t)).getTime() < 48 * 3600 * 1000; }

  function locked(msg, needSignin) {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>' + msg + '</b>' +
      '<span>' + (needSignin
        ? 'The board is private to verified brothers. Sign in (or create your profile) to join the conversation.'
        : 'Your profile is awaiting verification by chapter leadership. The board unlocks once you\'re approved.') + '</span>' +
      (needSignin ? '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a>' : '') +
      '</div>';
  }

  if (!Z || !Z.configured) { locked('Members only', true); return; }

  var me = null, dir = {}, threads = [], META = {}, isAdmin = false;
  // Poll moderation: edit/delete ANY brother's poll. Ships OFF and is granted per
  // seat in Admin -> Officers, exactly like gallery.moderate. Authoring your own
  // poll needs nothing — every approved brother can (upgrade38). RLS is the real
  // gate; this flag only decides which buttons get drawn.
  var canModPolls = false;
  var MY_COMMITTEES = [], POLLS = [], VOTES = [];
  // view: 'spaces' = the card front door, 'space' = inside one.
  var state = { cat: 'all', thread: null, sort: 'active', view: 'spaces' };

  // Paint the skeleton NOW for a likely-signed-in brother: the auth checks below
  // take ~200ms, twice as long as the data fetch, and used to be a blank screen.
  // Signed-out visitors skip this and go straight to the lock (no false promise).
  if (Z.hasSessionHint && Z.hasSessionHint()) root.innerHTML = boardSkeleton();

  function committeeOf(id) { return MY_COMMITTEES.filter(function (c) { return c.id === id; })[0]; }
  function feedThreads() { return threads.filter(function (t) { return !t.committee_id; }); }

  function author(uid) { return dir[uid] || { full_name: 'A brother', photo_url: null }; }
  function chip(uid) {
    var a = author(uid);
    var av = a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="">' :
      '<span>' + esc(String(a.full_name || 'Ζ').trim()[0] || 'Ζ') + '</span>';
    return '<span class="author-chip"><i class="author-chip__av">' + av + '</i><b>' + esc(a.full_name) + '</b></span>';
  }

  /* ---------- thread list ---------- */
  /* ---------- spaces nav: one row model, two controls ----------
     The rail (desktop) and the select (mobile) are BOTH rendered every time;
     CSS decides which is visible. No resize listener, no breakpoint detection. */
  function spaceRows() {
    var feed = feedThreads();
    var rows = [{ id: 'all', ic: '✦', label: 'All', n: feed.length,
                  unread: feed.filter(isUnread).length > 0, group: 'SPACES', dim: false }];
    CATS.forEach(function (c) {
      var inCat = feed.filter(function (t) { return t.category === c.id; });
      rows.push({ id: c.id, ic: c.ic, label: c.label, n: inCat.length,
                  unread: inCat.filter(isUnread).length > 0, group: 'SPACES', dim: inCat.length === 0 });
    });
    // noun: what this space actually contains. Everything holds threads except
    // Polls, where "No threads yet" would just be wrong.
    rows.push({ id: 'polls', ic: '🗳️', label: 'Polls', n: POLLS.length, noun: 'poll',
                unread: false, group: 'CHAPTER', dim: POLLS.length === 0 });
    MY_COMMITTEES.forEach(function (c) {
      rows.push({ id: c.id, ic: '🔒', label: c.name,
                  n: threads.filter(function (t) { return t.committee_id === c.id; }).length,
                  unread: false, group: 'PRIVATE', dim: false });
    });
    // FOOT: not a space brothers post in — a line to the webmaster. n:null = no count badge.
    rows.push({ id: 'suggestions', ic: '💡', label: 'Suggestion box', n: null,
                unread: false, group: 'FOOT', dim: false });
    return rows;
  }

  /* ---------- the front door: spaces as cards ----------
     Was a rail down the left of every screen, repeating all nine destinations
     whether or not you cared. Same shape as the gallery's sections page: you
     pick a space, then you are in it, and a back pill is how you leave.
     Built from spaceRows() unchanged — no new data. */
  function spaceCard(r) {
    var noun = r.noun || 'thread';
    var count = r.n === null ? '' :
      '<span class="bsec__n">' + (r.n === 0 ? 'No ' + noun + 's yet' : r.n + ' ' + noun + (r.n === 1 ? '' : 's')) + '</span>';
    return '<button class="bsec' + (r.dim ? ' bsec--empty' : '') + (r.unread ? ' bsec--new' : '') +
      '" data-cat="' + esc(r.id) + '" aria-label="' + esc('Open ' + r.label) + '">' +
      '<span class="bsec__ic" aria-hidden="true">' + r.ic + '</span>' +
      '<span class="bsec__name">' + esc(r.label) + '</span>' + count +
      (r.unread ? '<span class="bsec__dot" aria-label="New activity"></span>' : '') +
      '</button>';
  }

  function spacesHtml() {
    var rows = spaceRows();
    var group = function (name) {
      var mine = rows.filter(function (r) { return r.group === name; });
      if (!mine.length) return '';                    // no committees -> no empty heading
      return '<div class="bsecs__group"><span class="bsecs__label">' + name + '</span>' +
        '<div class="bsecs">' + mine.map(spaceCard).join('') + '</div></div>';
    };
    // The foot holds the two things that aren't places to post: a line to the
    // webmaster, and help. They stay buttons — a card would imply a destination
    // full of threads.
    var foot = '<div class="bsecs__foot">' +
      rows.filter(function (r) { return r.group === 'FOOT'; }).map(function (r) {
        return '<button class="back-pill" data-cat="' + esc(r.id) + '">' + r.ic + ' ' + esc(r.label) + '</button>';
      }).join('') +
      '<button class="back-pill board-help" title="How the board works">❓ How the board works</button>' +
      '</div>';
    return group('SPACES') + group('CHAPTER') + group('PRIVATE') + foot;
  }

  /* ---------- the way out lives INSIDE the header ----------
     It used to be a pill on a row of its own, above the section header: a whole
     line of vertical space spent on navigation, pushing the content down and
     sitting on top of the thing you came to read. Now it is a round button at the
     left of the header it belongs to, vertically centred with the title — top-left
     corner, and it costs no row at all.
     Icon-only by design: the destination rides in aria-label + title, so a screen
     reader and a hover both get the words while the control stays a square target.
     `to` is RAW here and esc()'d below — it can be a committee name, which is
     brother-supplied. Every call site passes raw and lets this do the escaping. */
  function bhead(id, to, inner) {
    var label = esc('Back to ' + to);
    return '<div class="bhead">' +
      '<button class="bback" id="' + id + '" aria-label="' + label + '" title="' + label + '">←</button>' +
      '<div class="bhead__main">' + inner + '</div></div>';
  }

  function avatarOf(uid) {
    var a = author(uid);
    return a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="">' :
      '<span>' + esc(String(a.full_name || 'Ζ').trim()[0] || 'Ζ') + '</span>';
  }

  function emptyState(label) {
    // label is null on the feed, where "Nothing in the board yet" reads wrong.
    var head = label ? 'Nothing in ' + label + ' yet.' : 'Nothing here yet.';
    return '<div class="board-empty">' +
      '<img src="assets/img/crest-mark.webp" alt="" />' +
      '<p><b>' + head + '</b><br>Be the brother who starts the first thread.</p></div>';
  }

  function threadCard(t) {
    var m = META[t.id] || { count: 0 };
    // esc() in the class attrs below: category/tag are plain `text` columns and RLS
    // doesn't constrain them, so their CHECK enums are the only thing keeping HTML
    // out of here. esc() is a no-op on every legal value — it just stops the
    // constraint from being load-bearing.
    var tag = t.tag ? '<span class="thr-tag thr-tag--' + esc(t.tag) + '">' + (t.tag === 'offering' ? 'Offering' : 'Seeking') + '</span>' : '';
    var preview = String(t.body || '').replace(/\s+/g, ' ').slice(0, 92);
    if ((t.body || '').length > 92) preview += '…';
    var flags = (isHot(t) ? ' <i class="thr-hot" title="Active in the last 48h">🔥</i>' : '') +
                (t.image_path ? ' <i title="Has a photo">📷</i>' : '');
    var a = author(t.author_user);
    return '<button class="thread-row thread-row--' + (t.committee_id ? 'comm' : esc(t.category)) + (isUnread(t) ? ' unread' : '') + '" data-thr="' + t.id + '">' +
      '<span class="thread-row__av">' + avatarOf(t.author_user) + '</span>' +
      '<div class="thread-row__main">' +
        '<b>' + (isUnread(t) ? '<i class="thr-dot"></i>' : '') + tag + esc(t.title) + flags + '</b>' +
        '<span class="thread-row__prev">' + esc(preview) + '</span>' +
        '<span>' + esc(a.full_name) + ' · ' + when(lastActivity(t)) + '</span>' +
      '</div>' +
      '<div class="thread-row__count">' + m.count + ' ↩</div></button>';
  }

  function sortThreads(list) {
    var s = state.sort;
    return list.slice().sort(function (a, z) {
      if (s === 'newest') return new Date(z.created_at) - new Date(a.created_at);
      if (s === 'oldest') return new Date(a.created_at) - new Date(z.created_at);
      if (s === 'replies') return ((META[z.id] || {}).count || 0) - ((META[a.id] || {}).count || 0);
      return new Date(lastActivity(z)) - new Date(lastActivity(a)); // active
    });
  }

  /* ---------- introductions composer ---------- */
  // Deliberately not the generic composer: one textarea, no title field. The title
  // is generated, because every extra field is a brother who doesn't post.
  function myIntro() {
    return (me && threads.filter(function (t) {
      return t.category === 'introductions' && t.author_user === me.id;
    })[0]) || null;
  }
  function hasIntro() { return !!myIntro(); }
  function introTitle() {
    var p = dir[me.id] || {};
    var name = String(p.full_name || 'A brother').trim();
    return p.pledge_class ? (name + ' · ' + p.pledge_class) : name;
  }
  function introCard() {
    var p = dir[me.id] || {};
    var first = String(p.full_name || '').trim().split(' ')[0];
    var cls = p.pledge_class ? '<span class="intro-card__class">' + esc(p.pledge_class) + '</span>' : '';
    return '<div class="intro-card">' +
      '<div class="intro-card__head"><b>👋 Welcome home' + (first ? ', ' + esc(first) : '') + '.</b>' + cls + '</div>' +
      '<form id="introForm" novalidate>' +
        '<textarea id="introText" maxlength="2000" required ' +
          'placeholder="Where’d you land, what are you doing now, and what do you miss most?"></textarea>' +
        '<div class="intro-card__foot">' +
          '<span class="intro-card__hint">Posts to 👋 Introductions, where every brother can find you.</span>' +
          '<button class="btn btn--gold" type="submit">Post my intro →</button>' +
        '</div>' +
        '<p class="form-status" id="introStatus" role="status"></p>' +
      '</form></div>';
  }
  // Once he's said hi the composer is gone, so its slot carries the way back to
  // what he wrote. Without this, "edit your intro" means finding your own post in
  // a list of everyone else's.
  function introDone() {
    return '<p class="intro-done">👋 You’ve said hi. ' +
      '<button type="button" id="introEdit">Edit your intro</button></p>';
  }
  function wireIntroCard() {
    var ie = document.getElementById('introEdit');
    if (ie) ie.onclick = function () {
      var t = myIntro();
      if (t) renderThread(t, true);
    };
    var f = document.getElementById('introForm');
    if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var ta = document.getElementById('introText');
      var st = document.getElementById('introStatus');
      var body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Posting…';
      // Promise.resolve(): threadCreate returns a Supabase query builder (a thenable),
      // which has no .catch of its own.
      Promise.resolve(Z.threadCreate({
        author_user: me.id, category: 'introductions', committee_id: null,
        tag: null, title: introTitle(), body: body, image_path: null
      })).then(function (r) {
        if (r.error) throw r.error;
        return loadAll().then(function () {
          // Stay in Introductions: it is now the only place the composer lives, so
          // bouncing him to All would carry him away from the post he just wrote.
          renderList();
          window.scrollTo(0, 0);
        });
      }).catch(function (err) {
        st.className = 'form-status err';
        st.textContent = (err && err.message) || 'Could not post your intro.';
        btn.disabled = false; btn.textContent = 'Post my intro →';   // his text is never cleared
      });
    };
  }

  // The front door: cards, nothing else. The intro composer used to sit on top of
  // them and it dominated the page — it now lives only in 👋 Introductions, which
  // is the space it posts to.
  function renderSpaces() {
    state.thread = null;
    state.view = 'spaces';
    root.innerHTML = '<div class="board-main board-main--spaces">' + spacesHtml() + '</div>';
    wireTabs();
    wireHelp();
  }

  function renderList() {
    state.thread = null;
    state.view = 'space';
    if (state.cat === 'polls') return renderPolls();
    if (state.cat === 'suggestions') return renderSuggestions();
    var comm = committeeOf(state.cat);
    var meta = catMeta(state.cat);
    var isAll = state.cat === 'all';
    var mine = comm
      ? threads.filter(function (t) { return t.committee_id === state.cat; })
      : (isAll ? feedThreads() : feedThreads().filter(function (t) { return t.category === state.cat; }));
    mine = sortThreads(mine);

    // All never had a band, because the rail told you where you were. The back
    // control lives in the header now, so All needs one too — and a section that
    // says what it holds is the point of putting the header first.
    var band = comm
      ? '<div class="cat-band cat-band--comm">🔒 <div><b>' + esc(comm.name) + '</b><span>Private — only committee members and the webmaster can see this space.</span></div></div>'
      : meta
        ? '<div class="cat-band cat-band--' + meta.id + '">' + meta.ic + ' <div><b>' + meta.label + '</b><span>' + meta.desc + '</span></div></div>'
        : isAll
          ? '<div class="cat-band">✦ <div><b>All</b><span>Every thread from the open spaces — private committee rooms stay in their own.</span></div></div>'
          : '';

    // Introductions is composer-only: no "+ New thread" there, which also stops second intros.
    var controls = '<div class="board-controls">' +
      (state.cat === 'introductions' ? '' :
        '<button class="btn btn--gold" id="newThread">+ New ' + (state.cat === 'opportunities' ? 'opportunity' : 'thread') + '</button>') +
      '<span class="board-controls__right">' +
      (mine.length > 1 ? '<select class="page-filter" id="threadSort">' +
        [['active', 'Recently active'], ['newest', 'Newest'], ['replies', 'Most replies'], ['oldest', 'Oldest']].map(function (o) {
          return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>' : '') +
      '</span></div>';   // help lives on the front door now, not in every space

    var list = mine.length ? '<div class="thread-list">' + mine.map(threadCard).join('') + '</div>'
      : emptyState(isAll ? null : (comm ? esc(comm.name) : catLabel(state.cat)));

    // Introductions only. It posts there, so it belongs there — and on the front
    // door it was the first thing every brother met, every visit, forever.
    var intro = state.cat !== 'introductions' ? '' : (hasIntro() ? introDone() : introCard());

    // Header first: the band explains what the space is, so it has to arrive
    // before the box asking you to write in it.
    root.innerHTML = '<div class="board-main">' +
      bhead('bspaceBack', 'All spaces', band) + intro + controls + list + '</div>';
    wireTabs();
    wireIntroCard();
    wireSuggestionCard();
    wireHelp();
    var nt = document.getElementById('newThread');
    if (nt) nt.onclick = function () { renderCompose(); };
    var sortSel = document.getElementById('threadSort');
    if (sortSel) sortSel.onchange = function () { state.sort = sortSel.value; renderList(); };
    root.querySelectorAll('[data-thr]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = threads.filter(function (x) { return x.id === b.dataset.thr; })[0];
        if (t) renderThread(t);
      });
    });
  }

  /* ---------- member help popup ---------- */
  function wireHelp() {
    var open = function () {
      var wrap = document.createElement('div');
      wrap.className = 'admin-modal open';
      wrap.innerHTML = '<div class="admin-modal__card"><button class="admin-modal__close" data-x aria-label="Close">✕</button>' +
        '<h3>❓ How the board works</h3><div class="treeed-help">' +
        '<p><b>👋 Say hi first.</b> Your intro tells 320+ brothers your class, where you landed and what you\'re up to. It\'s the one post everyone can write, and it\'s how brothers find each other.</p>' +
        '<p><b>Post a thread.</b> Hit <b>+ New thread</b>, pick the space that fits (⚖️ Chapter, 🧭 Advice, 🎉 Social, 💼 Opportunities), write it, optionally attach a photo.</p>' +
        '<p><b>Jobs &amp; referrals.</b> In 💼 Opportunities, mark your post <i>Offering</i> (you have something) or <i>Seeking</i> (you\'re looking).</p>' +
        '<p><b>Reply &amp; react.</b> Open any thread to reply. Tap 👍 ❤️ 😂 under a reply to react — tap again to take it back.</p>' +
        '<p><b>Gold = new.</b> A gold dot or count means there\'s activity you haven\'t seen yet. It clears when you open the thread.</p>' +
        '<p><b>🗳️ Polls.</b> Vote once per poll; you can change your vote until it closes.</p>' +
        '<p><b>🔒 Locked spaces</b> are private committee rooms — you only see the ones you belong to.</p>' +
        '<p><b>💡 Suggestion box</b> (bottom of the page) goes straight to the webmaster — you\'ll get a 🔔 when he responds.</p>' +
        '</div></div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) wrap.remove(); });
    };
    // Two help buttons (rail + mobile) share a CLASS — a duplicate id would be
    // invalid HTML and getElementById would only ever find the first.
    root.querySelectorAll('.board-help').forEach(function (b) { b.onclick = open; });
  }

  function wireTabs() {
    // Changing space is arriving somewhere new, so land at the top of it. Keeping
    // the old scroll offset drops you into the middle of a section you've never
    // seen — or past the end of a shorter one, where the browser clamps you to a
    // view of nothing.
    // The jump must be INSTANT. html{scroll-behavior:smooth} is set site-wide for
    // anchor links, and it animates window.scrollTo too — measured still gliding
    // 250ms later, panning over a list you didn't ask for while its content is
    // being replaced. An inline style out-specifies that rule.
    var go = function (id) {
      state.cat = id;
      renderList();
      var h = document.documentElement, prev = h.style.scrollBehavior;
      h.style.scrollBehavior = 'auto';
      // Load-bearing, do not remove: renderList() just invalidated style, and
      // scrollTo reads the STALE computed scroll-behavior (still smooth) unless
      // something forces a recalc first. Measured: without this read the jump
      // animates; with it, scrollY is 0 synchronously.
      void getComputedStyle(h).scrollBehavior;
      window.scrollTo(0, 0);
      h.style.scrollBehavior = prev;
    };
    root.querySelectorAll('[data-cat]').forEach(function (b) {
      b.onclick = function () { go(b.dataset.cat); };
    });
    // Back to the cards. Same jump-to-top treatment, for the same reason.
    var back = document.getElementById('bspaceBack');
    if (back) back.onclick = function () {
      renderSpaces();
      var h = document.documentElement, prev = h.style.scrollBehavior;
      h.style.scrollBehavior = 'auto';
      void getComputedStyle(h).scrollBehavior;
      window.scrollTo(0, 0);
      h.style.scrollBehavior = prev;
    };
  }

  /* ---------- polls ---------- */
  function renderPolls() {
    // Every approved brother can post a poll now (upgrade38) — this used to be
    // admin-only, which is why the owner saw a bare "No polls yet."
    var newBtn = '<p style="margin:1rem 0"><button class="btn btn--gold" id="newPoll">+ New poll</button></p>';
    var cards = POLLS.length ? POLLS.map(function (p) {
      var opts = p.options || [];
      var votes = VOTES.filter(function (v) { return v.poll_id === p.id; });
      var myVote = me && (votes.filter(function (v) { return v.user_id === me.id; })[0] || null);
      var total = votes.length;
      var closed = p.closes_at && new Date(p.closes_at).getTime() < Date.now();
      var bars = opts.map(function (o, i) {
        var n = votes.filter(function (v) { return v.choice === i; }).length;
        var pct = total ? Math.round(100 * n / total) : 0;
        var mine = myVote && myVote.choice === i;
        return '<button class="poll-opt' + (mine ? ' on' : '') + (closed ? ' closed' : '') + '" data-vote="' + i + '">' +
          '<span class="poll-opt__bar" style="width:' + pct + '%"></span>' +
          '<span class="poll-opt__label">' + (mine ? '✓ ' : '') + esc(o) + '</span>' +
          '<span class="poll-opt__n">' + n + ' · ' + pct + '%</span></button>';
      }).join('');
      var meta = total + ' vote' + (total === 1 ? '' : 's') +
        (p.closes_at ? (closed ? ' · <b class="poll-closed">CLOSED</b>' : ' · closes ' + new Date(p.closes_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : '');
      // Your own poll, or anyone's if you hold polls.moderate / are the admin.
      // RLS enforces the same rule server-side, so a hand-crafted request that
      // skipped these buttons would still be refused.
      var mine = me && p.author_user && p.author_user === me.id;
      var canEdit = mine || canModPolls;
      var byLine = mine ? ' · <span class="poll-mine">yours</span>'
        : (p.author_user && dir[p.author_user] ? ' · ' + esc(dir[p.author_user].full_name || '') : '');
      return '<div class="poll-card" data-poll="' + p.id + '">' +
        '<h3>' + esc(p.question) + '</h3>' + bars +
        '<div class="poll-card__meta">' + meta + byLine +
        (canEdit ? ' · <a href="#" data-editpoll>edit</a> · <a href="#" data-delpoll>delete</a>' : '') +
        '</div></div>';
    }).join('') : '<p class="page-empty">No polls yet — post the first one.</p>';

    root.innerHTML = '<div class="board-main">' +
        bhead('bspaceBack', 'All spaces',
          '<div class="gsechead"><h3>🗳️ Polls</h3><span>' +
            (POLLS.length === 0 ? 'None yet' : POLLS.length + (POLLS.length === 1 ? ' poll' : ' polls')) +
          '</span></div>') +
        newBtn + cards +
      '</div>';
    wireTabs();
    wireSuggestionCard();
    wireHelp();

    var np = document.getElementById('newPoll');
    if (np) np.onclick = renderNewPoll;
    root.querySelectorAll('[data-poll]').forEach(function (card) {
      var p = POLLS.filter(function (x) { return x.id === card.dataset.poll; })[0];
      var closed = p.closes_at && new Date(p.closes_at).getTime() < Date.now();
      if (!closed) card.querySelectorAll('[data-vote]').forEach(function (b) {
        b.onclick = function () {
          var choice = parseInt(b.dataset.vote, 10);
          VOTES = VOTES.filter(function (v) { return !(v.poll_id === p.id && v.user_id === me.id); });
          VOTES.push({ poll_id: p.id, user_id: me.id, choice: choice });
          renderPolls();
          Z.pollVote(p.id, me.id, choice).then(function (r) {
            if (r.error) Z.pollVotesAll().then(function (vs) { VOTES = vs; renderPolls(); });
          });
        };
      });
      var edit = card.querySelector('[data-editpoll]');
      if (edit) edit.onclick = function (e) { e.preventDefault(); renderNewPoll(p); };
      var del = card.querySelector('[data-delpoll]');
      if (del) del.onclick = function (e) {
        e.preventDefault();
        ZBXIAsk.confirm({ title: 'Delete poll', body: 'Delete this poll and its votes?', ok: 'Delete', danger: true }, function () {
          Z.pollDelete(p.id).then(function (r) {
            // RLS is the real gate — surface a refusal instead of silently
            // pretending it worked and having the row reappear on refresh.
            if (r && r.error) { ZBXIAsk.alert({ title: 'Could not delete', body: r.error.message }); return; }
            POLLS = POLLS.filter(function (x) { return x.id !== p.id; });
            renderPolls();
          });
        });
      };
    });
  }

  // One form for both create and edit — pass an existing poll to edit it.
  function renderNewPoll(poll) {
    var editing = !!(poll && poll.id);
    // datetime-local needs local wall-clock "YYYY-MM-DDTHH:mm", not an ISO Z
    // string, or the field renders blank and a saved close time is silently lost.
    var closesLocal = '';
    if (editing && poll.closes_at) {
      var d = new Date(poll.closes_at);
      closesLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    root.innerHTML =
      '<div class="card-form" style="max-width:640px">' +
        bhead('backList', 'Polls',
          '<h3 style="color:var(--heading);font-family:var(--display);margin:0">' + (editing ? 'Edit poll' : 'New poll') + '</h3>') +
        '<form id="pollForm" novalidate>' +
          '<div class="field"><label>Question *</label><input name="question" required maxlength="200" value="' +
            (editing ? esc(poll.question) : '') + '"></div>' +
          '<div class="field"><label>Options (one per line, 2–6) *</label><textarea name="opts" rows="5" required>' +
            (editing ? esc((poll.options || []).join('\n')) : '') + '</textarea></div>' +
          '<div class="field"><label>Closes (optional)</label><input name="closes" type="datetime-local" value="' + closesLocal + '"></div>' +
          '<button class="btn btn--navy" type="submit" style="width:100%">' + (editing ? 'Save changes' : 'Post poll') + '</button>' +
          '<p class="form-status" id="pollStatus">' +
            (editing && (poll.options || []).length ? 'Changing the options resets nothing — existing votes keep their position.' : '') +
          '</p>' +
        '</form></div>';
    document.getElementById('backList').onclick = renderList;
    document.getElementById('pollForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = document.getElementById('pollStatus');
      var opts = f.opts.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!f.question.value.trim() || opts.length < 2 || opts.length > 6) {
        st.className = 'form-status err'; st.textContent = 'Question plus 2–6 options required.'; return;
      }
      var row = {
        question: f.question.value.trim(),
        options: opts,
        closes_at: f.closes.value ? new Date(f.closes.value).toISOString() : null
      };
      // author_user is required by polls_member_insert and must be YOU — that is
      // what stops a brother posting under someone else's name. Not sent on edit:
      // the update policy's WITH CHECK would reject a reassignment anyway.
      var op;
      if (editing) {
        op = Z.pollUpdate(poll.id, row);
      } else {
        row.author_user = me.id;
        op = Z.pollCreate(row);
      }
      op.then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        Z.pollsList().then(function (ps) { POLLS = ps; renderList(); });
      });
    };
  }

  /* ---------- suggestion box ---------- */
  // Its own space in the rail. It used to render at the foot of every view — the
  // same box eight times over — which is noise, not availability.
  function renderSuggestions() {
    state.thread = null;
    root.innerHTML = '<div class="board-main">' +
        bhead('bspaceBack', 'All spaces',
          '<div class="gsechead"><h3>💡 Suggestion box</h3><span>Straight to the webmaster</span></div>') +
        suggestionCard() +
      '</div>';
    wireTabs();
    wireSuggestionCard();
    wireHelp();
  }

  var MY_SUGS = null;
  function suggestionCard() {
    return '<div class="sug-box" id="sugBox">' +
      '<div class="sug-box__head"><b>💡 Suggestion box</b><span>Tell the webmaster what would make this site better.</span></div>' +
      '<form class="gcompose" id="sugForm"><input id="sugInput" placeholder="Your idea…" maxlength="600"><button class="btn btn--navy" type="submit">Send</button></form>' +
      '<div id="sugMine"></div></div>';
  }
  function wireSuggestionCard() {
    var form = document.getElementById('sugForm');
    if (!form) return;
    form.onsubmit = function (e) {
      e.preventDefault();
      var input = document.getElementById('sugInput');
      var body = input.value.trim();
      if (!body) return;
      input.value = '';
      Z.suggestionCreate(me.id, body).then(function () { MY_SUGS = null; renderMySugs(); });
    };
    renderMySugs();
  }
  function renderMySugs() {
    var box = document.getElementById('sugMine');
    if (!box) return;
    var draw = function () {
      if (!MY_SUGS.length) { box.innerHTML = ''; return; }
      box.innerHTML = MY_SUGS.slice(0, 3).map(function (s) {
        var chipHtml = s.status === 'responded' ? '<i class="schip schip--active">answered</i>' : '<i class="schip">' + esc(s.status) + '</i>';
        return '<div class="sug-mine">' + chipHtml + ' <span>' + esc(s.body) + '</span>' +
          (s.response ? '<p class="sug-card__resp">↩ ' + esc(s.response) + '</p>' : '') + '</div>';
      }).join('');
    };
    if (MY_SUGS) return draw();
    Z.suggestionsMine().then(function (rows) {
      MY_SUGS = isAdmin ? [] : rows; // the admin manages these in the console instead
      draw();
    });
  }

  /* ---------- new thread ---------- */
  function renderCompose(prefillTitle) {
    var comm = committeeOf(state.cat);
    var isAll = state.cat === 'all';
    var where = comm ? comm.name : catLabel(state.cat);   // raw; esc()'d at each use
    // From the feed there's no implied category, so ask — 'all' isn't a valid
    // category and would fail the CHECK constraint.
    var catField = isAll
      ? '<div class="field"><label>Where should this go? *</label><select name="cat" id="thrCat">' +
          POSTABLE.map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === 'social' ? ' selected' : '') + '>' + c.ic + ' ' + c.label + '</option>';
          }).join('') + '</select></div>'
      : '';
    var oppNow = isAll ? false : state.cat === 'opportunities';   // 'social' is the default pick
    root.innerHTML =
      '<div class="card-form" style="max-width:680px">' +
        bhead('backList', where,
          '<h3 style="color:var(--heading);font-family:var(--display);margin:0">New ' +
            (oppNow ? 'opportunity' : 'thread') + ' · ' + esc(where) + '</h3>') +
        '<form id="thrForm" novalidate>' +
          catField +
          '<div class="field" id="tagField"' + (oppNow ? '' : ' style="display:none"') + '><label>Type</label><select name="tag">' +
            '<option value="offering">💼 Offering — I have a job/internship/referral</option>' +
            '<option value="seeking">🔎 Seeking — I\'m looking for opportunities</option></select></div>' +
          '<div class="field"><label>Title *</label><input name="title" required maxlength="140" value="' + esc(prefillTitle || '') + '"></div>' +
          '<div class="field"><label>Post *</label><textarea name="body" required></textarea></div>' +
          '<div class="field"><label>Photo (optional)</label><input type="file" name="photo" accept="image/*">' +
            '<img class="file-prev" id="thrPhotoPrev" alt="Preview of the photo you chose" hidden></div>' +
          '<button class="btn btn--navy" type="submit" style="width:100%">Post thread</button>' +
          '<p class="form-status" id="thrStatus" role="status"></p>' +
        '</form></div>';
    document.getElementById('backList').onclick = renderList;

    // Thumbnail the chosen photo — a filename alone doesn't tell you if it's the
    // right picture. Revoke the old object URL on every re-pick so it can't leak.
    var thrPhoto = document.querySelector('#thrForm input[name=photo]');
    var thrPrev = document.getElementById('thrPhotoPrev');
    // 25MB matches the gallery composer, and for the same reason: downscale()
    // decodes the whole image into a canvas, so an enormous file is a memory
    // problem long before it's a storage one (it uploads at ~400KB either way).
    // There was no guard here at all, which mattered less when only two accounts
    // could attach a photo; every brother can now.
    var MAX_PICK = 25 * 1024 * 1024;
    if (thrPhoto && thrPrev) thrPhoto.addEventListener('change', function () {
      if (thrPrev.src) URL.revokeObjectURL(thrPrev.src);
      var f = thrPhoto.files[0];
      if (!f) { thrPrev.hidden = true; thrPrev.removeAttribute('src'); return; }
      if (f.size > MAX_PICK) {
        thrPhoto.value = ''; thrPrev.hidden = true; thrPrev.removeAttribute('src');
        var s = document.getElementById('thrStatus');
        if (s) { s.className = 'form-status err'; s.textContent = 'That image is too big to process on a phone (max 25MB). Try a smaller version.'; }
        return;
      }
      thrPrev.src = URL.createObjectURL(f);
      thrPrev.hidden = false;
    });

    // Same show/hide pattern as the profile pledge-class picker in portal.js.
    var catSel = document.getElementById('thrCat');
    if (catSel) {
      var tagField = document.getElementById('tagField');
      var syncTag = function () { tagField.style.display = catSel.value === 'opportunities' ? '' : 'none'; };
      catSel.onchange = syncTag;
      syncTag();
    }
    document.getElementById('thrForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = document.getElementById('thrStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var chosen = comm ? 'chapter' : (isAll ? f.cat.value : state.cat);
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Posting…';
      var file = f.photo.files[0];
      var photoP = file
        ? Z.downscale(file, 1600).then(function (blob) { return Z.galleryUpload(me.id, blob, 'jpg'); })
        : Promise.resolve(null);
      photoP.then(function (imagePath) {
        return Z.threadCreate({
          author_user: me.id,
          category: chosen,
          committee_id: comm ? comm.id : null,
          tag: chosen === 'opportunities' ? f.tag.value : null,
          title: f.title.value.trim(),
          body: f.body.value.trim(),
          image_path: imagePath
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        return loadAll().then(function () { renderThread(r.data); });
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not post.';
        btn.disabled = false; btn.textContent = 'Post thread';
      });
    };
  }

  /* ---------- thread view ---------- */
  // openEdit: land straight in the editor instead of on the post. Used by the
  // "Edit your intro" line, where reading it again is not what he came to do.
  function renderThread(t, openEdit) {
    state.thread = t;
    state.cat = t.committee_id || t.category;
    markSeen(t.id);
    var comm = committeeOf(t.committee_id);
    var backLabel = comm ? comm.name : catLabel(t.category);   // raw; bhead esc()s it
    var tag = t.tag ? '<span class="thr-tag thr-tag--' + esc(t.tag) + '">' + (t.tag === 'offering' ? 'Offering' : 'Seeking') + '</span>' : '';
    var canDel = me && (t.author_user === me.id || isAdmin);
    // Edit is drawn for the AUTHOR only. upgrade49's policy also permits the admin,
    // matching delete, but rewording a brother's own words is not a button the
    // console should offer casually. RLS stays the real gate either way.
    var canEdit = me && t.author_user === me.id;
    root.innerHTML =
      '<article class="thread-view">' +
        bhead('backList', backLabel, '<h2>' + tag + esc(t.title) + '</h2>') +
        '<div class="thread-view__meta">' + chip(t.author_user) + ' · ' + when(t.created_at) +
          (canEdit ? ' · <a href="#" id="editThread">edit</a>' : '') +
          (canDel ? ' · <a href="#" id="delThread">delete thread</a>' : '') + '</div>' +
        (t.image_path ? '<div class="thread-view__photo" id="threadPhoto"></div>' : '') +
        '<div class="thread-view__body" id="thrBody">' + esc(t.body).replace(/\n/g, '<br>') + '</div>' +
        '<div id="thrEdit" hidden></div>' +
        '<h3 class="stat-h">Replies</h3>' +
        '<div id="replies"><p class="form-note">…</p></div>' +
        '<form class="gcompose" id="replyForm" style="margin-top:1rem">' +
          '<input id="replyInput" placeholder="Write a reply…" maxlength="2000" />' +
          '<button type="submit" class="btn btn--navy">Reply</button>' +
        '</form>' +
      '</article>';
    document.getElementById('backList').onclick = renderList;
    var ed = document.getElementById('editThread');
    if (ed) ed.onclick = function (e) { e.preventDefault(); showThreadEdit(t); };
    if (openEdit && canEdit) showThreadEdit(t);
    var del = document.getElementById('delThread');
    if (del) del.onclick = function (e) {
      e.preventDefault();
      ZBXIAsk.confirm({ title: 'Delete thread', body: 'Delete this thread and all replies?', ok: 'Delete', danger: true }, function () {
        Z.threadDelete(t.id).then(function () { loadAll().then(renderList); });
      });
    };
    if (t.image_path) {
      Z.gallerySignedUrls([t.image_path]).then(function (urls) {
        var ph = document.getElementById('threadPhoto');
        var u = urls[t.image_path];
        if (ph && u) ph.innerHTML = '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Photo attached to this thread — opens full size"></a>';
      });
    }
    loadReplies(t);
    document.getElementById('replyForm').onsubmit = function (e) {
      e.preventDefault();
      var input = document.getElementById('replyInput');
      var body = input.value.trim();
      if (!body) return;
      input.value = '';
      Z.replyCreate({ thread_id: t.id, author_user: me.id, body: body }).then(function () {
        var m = META[t.id] = META[t.id] || { count: 0, lastAt: null };
        m.count++; m.lastAt = new Date().toISOString();
        markSeen(t.id);
        loadReplies(t);
      });
    };
  }

  /* ---------- edit your own post (upgrade49) ----------
     Swaps the rendered body for a form in place, rather than navigating away: you
     can see the replies you're answering while you fix what you wrote.
     The title field is omitted on an intro because introTitle() generates it from
     his name and pledge class — it isn't his to edit, and the form must not send a
     column upgrade49 doesn't grant. */
  function showThreadEdit(t) {
    var box = document.getElementById('thrEdit');
    var body = document.getElementById('thrBody');
    if (!box || !body) return;
    var isIntro = t.category === 'introductions';
    box.innerHTML = '<form class="thr-edit" id="thrEditForm" novalidate>' +
      (isIntro ? '' :
        '<div class="field"><label>Title *</label>' +
          '<input name="title" required maxlength="140" value="' + esc(t.title) + '"></div>') +
      '<div class="field"><label>' + (isIntro ? 'Your intro *' : 'Post *') + '</label>' +
        '<textarea name="body" required maxlength="2000">' + esc(t.body) + '</textarea></div>' +
      '<div class="thr-edit__foot">' +
        '<button class="btn btn--navy" type="submit">Save changes</button>' +
        '<button class="back-pill" type="button" id="thrEditCancel">Cancel</button>' +
      '</div>' +
      '<p class="form-status" id="thrEditStatus" role="status"></p>' +
    '</form>';
    box.hidden = false;
    body.hidden = true;
    var ta = box.querySelector('textarea');
    if (ta) ta.focus();

    document.getElementById('thrEditCancel').onclick = function () {
      box.hidden = true; box.innerHTML = ''; body.hidden = false;
    };
    document.getElementById('thrEditForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = document.getElementById('thrEditStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var row = { body: f.body.value.trim() };
      if (!isIntro) row.title = f.title.value.trim();
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Saving…';
      Promise.resolve(Z.threadUpdate(t.id, row)).then(function (r) {
        if (r && r.error) throw r.error;
        // A PostgREST update that RLS refuses is not an error — it changes zero
        // rows and returns 200 with an empty array. Without this check a refused
        // edit would look like it saved until the next refresh put the old text
        // back. threadUpdate() asks for the rows back so there is something to test.
        if (!r || !r.data || !r.data.length) {
          throw new Error('The server would not save that — you can only edit your own posts.');
        }
        return loadAll();
      }).then(function () {
        renderThread(threads.filter(function (x) { return x.id === t.id; })[0] || t);
      })['catch'](function (err) {
        st.className = 'form-status err';
        st.textContent = (err && err.message) || 'Could not save your changes.';
        btn.disabled = false; btn.textContent = 'Save changes';   // his text is never cleared
      });
    };
  }

  var RKINDS = [['up', '👍'], ['heart', '❤️'], ['laugh', '😂']];
  function loadReplies(t) {
    var box = document.getElementById('replies');
    Z.threadReplies(t.id).then(function (rs) {
      if (!rs.length) { box.innerHTML = '<p class="form-note">No replies yet.</p>'; return; }
      Z.reactionsFor(rs.map(function (r) { return r.id; })).then(function (reacts) {
        function reactBar(r) {
          return '<span class="react-bar">' + RKINDS.map(function (k) {
            var these = reacts.filter(function (x) { return x.reply_id === r.id && x.kind === k[0]; });
            var mine = me && these.some(function (x) { return x.user_id === me.id; });
            return '<button class="react' + (mine ? ' on' : '') + '" data-react="' + r.id + '|' + k[0] + '">' +
              k[1] + (these.length ? ' ' + these.length : '') + '</button>';
          }).join('') + '</span>';
        }
        // Same ledger shape as the gallery's comments — one .gcomment structure,
        // one stylesheet. Name in the display face, time right-aligned, delete a
        // quiet ✕ rather than a red word beside every timestamp.
        box.innerHTML = '<ul class="gcomment-list">' + rs.map(function (r) {
          var mine = me && (r.author_user === me.id || isAdmin);
          return '<li class="gcomment">' +
            '<i class="gcomment__av">' + avatarOf(r.author_user) + '</i>' +
            '<div class="gcomment__main">' +
              '<div class="gcomment__head">' +
                '<b class="gcomment__who">' + esc(author(r.author_user).full_name) + '</b>' +
                '<time class="gcomment__when">' + esc(when(r.created_at).replace(' ago', '')) + '</time>' +
                (mine ? '<button type="button" class="gcomment__x" data-delr="' + esc(r.id) +
                        '" aria-label="Delete your reply" title="Delete this reply">✕</button>' : '') +
              '</div>' +
              '<p class="gcomment__text">' + esc(r.body).replace(/\n/g, '<br>') + '</p>' +
              reactBar(r) +
            '</div></li>';
        }).join('') + '</ul>';
        box.querySelectorAll('[data-delr]').forEach(function (a) {
          a.onclick = function () {
            Z.replyDelete(a.dataset.delr).then(function () { loadReplies(t); });
          };
        });
        box.querySelectorAll('[data-react]').forEach(function (b) {
          b.onclick = function () {
            var parts = b.dataset.react.split('|');
            var on = b.classList.contains('on');
            (on ? Z.unreact(parts[0], me.id, parts[1]) : Z.react(parts[0], me.id, parts[1]))
              .then(function () { loadReplies(t); });
          };
        });
      });
    });
  }

  /* ---------- data ---------- */
  function loadAll() {
    return Promise.all([Z.threadsList(), Z.replyMeta(), Z.memberDirectory(),
                        Z.committeesList().catch(function () { return []; }),
                        Z.pollsList().catch(function () { return []; }),
                        Z.pollVotesAll().catch(function () { return []; })]).then(function (res) {
      threads = res[0]; META = res[1]; dir = res[2] || {};
      MY_COMMITTEES = res[3]; POLLS = res[4]; VOTES = res[5];
    });
  }

  function boardSkeleton() {
    var one = '<div class="thread-row sk-wrap" aria-hidden="true"><span class="thread-row__av sk"></span>' +
      '<div class="thread-row__main"><span class="sk sk-line" style="width:55%"></span>' +
      '<span class="sk sk-line" style="width:82%"></span></div>' +
      '<div class="thread-row__count"><span class="sk sk-line" style="width:2.2em"></span></div></div>';
    return '<div class="thread-list" aria-hidden="true">' + new Array(7).join(one) + '</div>';
  }

  Z.getUser().then(function (u) {
    me = u;
    if (!u) { locked('Members only', true); return; }
    isAdmin = Z.adminEmail && (u.email || '').toLowerCase() === Z.adminEmail;
    // Resolved once per page load; Z.officerCan caches internally and falls back
    // to false on any error, so a failure here can only hide buttons, never grant.
    if (Z.officerCan) {
      Z.officerCan('polls.moderate').then(function (can) { canModPolls = isAdmin || !!can; });
    }
    Z.amApprovedBrother().then(function (ok) {
      if (!ok) { locked('Awaiting verification', false); return; }
      if (!root.querySelector('.sk')) root.innerHTML = boardSkeleton();  // unless already painted below
      loadAll().then(function () {
        // Deep links: #thread=<id> (notifications), #compose=<title> (class pages)
        var m = location.hash.match(/thread=([\w-]+)/);
        var t = m && threads.filter(function (x) { return x.id === m[1]; })[0];
        if (t) { renderThread(t); return; }
        var cm = location.hash.match(/compose=([^&]+)/);
        if (cm) {
          var title = decodeURIComponent(cm[1]);
          var existing = threads.filter(function (x) { return x.title === title; })[0];
          if (existing) { renderThread(existing); return; }
          state.cat = 'social';
          renderCompose(title);
          return;
        }
        renderSpaces();          // the Board opens on its spaces, not on one of them
      }).catch(function () {
        root.innerHTML = '<p class="page-empty">Could not load the board. Try refreshing.</p>';
      });
    });
  });
})();
