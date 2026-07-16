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
  var MY_COMMITTEES = [], POLLS = [], VOTES = [];
  var state = { cat: 'all', thread: null, sort: 'active' };

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
  function tabsHtml() {
    var feed = feedThreads();
    var allUnread = feed.filter(isUnread).length;
    var all = '<button class="bt bt--all' + (state.cat === 'all' ? ' on' : '') + '" data-cat="all">' +
      '✦ All <i' + (allUnread ? ' class="bt__new"' : '') + '>' + feed.length + '</i></button>';
    var std = CATS.map(function (c) {
      var inCat = feed.filter(function (t) { return t.category === c.id; });
      var unread = inCat.filter(isUnread).length;
      return '<button class="bt bt--' + c.id + (state.cat === c.id ? ' on' : '') +
        (inCat.length ? '' : ' bt--empty') + '" data-cat="' + c.id + '">' +
        c.ic + ' ' + c.label + ' <i' + (unread ? ' class="bt__new"' : '') + '>' + inCat.length + '</i></button>';
    }).join('');
    var polls = '<button class="bt bt--polls' + (state.cat === 'polls' ? ' on' : '') + '" data-cat="polls">🗳️ Polls' +
      (POLLS.length ? ' <i>' + POLLS.length + '</i>' : '') + '</button>';
    var comms = MY_COMMITTEES.map(function (c) {
      var n = threads.filter(function (t) { return t.committee_id === c.id; }).length;
      return '<button class="bt board-tabs__comm' + (state.cat === c.id ? ' on' : '') + '" data-cat="' + c.id + '">🔒 ' + esc(c.name) + (n ? ' <i>' + n + '</i>' : '') + '</button>';
    }).join('');
    return '<div class="board-tabs">' + all + std + polls + comms +
      '<button class="bt bt--help" id="boardHelp" title="How the board works">❓</button></div>';
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
      '<img src="assets/img/crest-mark.png" alt="" />' +
      '<p><b>' + head + '</b><br>Be the brother who starts the first thread.</p></div>';
  }

  function threadCard(t) {
    var m = META[t.id] || { count: 0 };
    var tag = t.tag ? '<span class="thr-tag thr-tag--' + t.tag + '">' + (t.tag === 'offering' ? 'Offering' : 'Seeking') + '</span>' : '';
    var preview = String(t.body || '').replace(/\s+/g, ' ').slice(0, 92);
    if ((t.body || '').length > 92) preview += '…';
    var flags = (isHot(t) ? ' <i class="thr-hot" title="Active in the last 48h">🔥</i>' : '') +
                (t.image_path ? ' <i title="Has a photo">📷</i>' : '');
    var a = author(t.author_user);
    return '<button class="thread-row thread-row--' + (t.committee_id ? 'comm' : t.category) + (isUnread(t) ? ' unread' : '') + '" data-thr="' + t.id + '">' +
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
  function hasIntro() {
    return !!(me && threads.some(function (t) {
      return t.category === 'introductions' && t.author_user === me.id;
    }));
  }
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
  function wireIntroCard() {
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
          state.cat = 'all';           // land him back on a board that now has his post in it
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

  function renderList() {
    state.thread = null;
    if (state.cat === 'polls') return renderPolls();
    var comm = committeeOf(state.cat);
    var meta = catMeta(state.cat);
    var isAll = state.cat === 'all';
    var mine = comm
      ? threads.filter(function (t) { return t.committee_id === state.cat; })
      : (isAll ? feedThreads() : feedThreads().filter(function (t) { return t.category === state.cat; }));
    mine = sortThreads(mine);

    var band = comm
      ? '<div class="cat-band cat-band--comm">🔒 <div><b>' + esc(comm.name) + '</b><span>Private — only committee members and the webmaster can see this space.</span></div></div>'
      : ((!isAll && meta) ? '<div class="cat-band cat-band--' + meta.id + '">' + meta.ic + ' <div><b>' + meta.label + '</b><span>' + meta.desc + '</span></div></div>' : '');

    // Introductions is composer-only: no "+ New thread" there, which also stops second intros.
    var controls = '<div class="board-controls">' +
      (state.cat === 'introductions' ? '' :
        '<button class="btn btn--gold" id="newThread">+ New ' + (state.cat === 'opportunities' ? 'opportunity' : 'thread') + '</button>') +
      (mine.length > 1 ? '<select class="page-filter" id="threadSort">' +
        [['active', 'Recently active'], ['newest', 'Newest'], ['replies', 'Most replies'], ['oldest', 'Oldest']].map(function (o) {
          return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>' : '') +
      '</div>';

    var list = mine.length ? '<div class="thread-list">' + mine.map(threadCard).join('') + '</div>'
      : emptyState(isAll ? null : (comm ? esc(comm.name) : catLabel(state.cat)));

    var intro = (!hasIntro() && (isAll || state.cat === 'introductions')) ? introCard() : '';

    root.innerHTML = intro + tabsHtml() + band + controls + list + suggestionCard();
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
    var h = document.getElementById('boardHelp');
    if (h) h.onclick = function () {
      var wrap = document.createElement('div');
      wrap.className = 'admin-modal open';
      wrap.innerHTML = '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
        '<h3>❓ How the board works</h3><div class="treeed-help">' +
        '<p><b>Post a thread.</b> Pick the space that fits (⚖️ Chapter, 🧭 Advice, 🎉 Social, 💼 Opportunities), hit <b>+ New thread</b>, write it, optionally attach a photo.</p>' +
        '<p><b>Jobs &amp; referrals.</b> In 💼 Opportunities, mark your post <i>Offering</i> (you have something) or <i>Seeking</i> (you\'re looking).</p>' +
        '<p><b>Reply &amp; react.</b> Open any thread to reply. Tap 👍 ❤️ 😂 under a reply to react — tap again to take it back.</p>' +
        '<p><b>Gold dots = new.</b> A gold dot means there\'s activity you haven\'t seen yet. It clears when you open the thread.</p>' +
        '<p><b>🗳️ Polls.</b> Vote once per poll; you can change your vote until it closes.</p>' +
        '<p><b>🔒 Locked tabs</b> are private committee spaces — you only see the ones you belong to.</p>' +
        '<p><b>💡 Suggestion box</b> (top of the page) goes straight to the webmaster — you\'ll get a 🔔 when he responds.</p>' +
        '</div></div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) wrap.remove(); });
    };
  }

  function wireTabs() {
    root.querySelectorAll('[data-cat]').forEach(function (b) {
      b.onclick = function () { state.cat = b.dataset.cat; renderList(); };
    });
  }

  /* ---------- polls ---------- */
  function renderPolls() {
    var newBtn = isAdmin ? '<p style="margin:1rem 0"><button class="btn btn--gold" id="newPoll">+ New poll</button></p>' : '';
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
      return '<div class="poll-card" data-poll="' + p.id + '">' +
        '<h3>' + esc(p.question) + '</h3>' + bars +
        '<div class="poll-card__meta">' + meta +
        (isAdmin ? ' · <a href="#" data-delpoll>delete</a>' : '') + '</div></div>';
    }).join('') : '<p class="page-empty">No polls yet' + (isAdmin ? ' — post the first one.' : '.') + '</p>';

    root.innerHTML = tabsHtml() + newBtn + cards + suggestionCard();
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
      var del = card.querySelector('[data-delpoll]');
      if (del) del.onclick = function (e) {
        e.preventDefault();
        if (!confirm('Delete this poll and its votes?')) return;
        Z.pollDelete(p.id).then(function () {
          POLLS = POLLS.filter(function (x) { return x.id !== p.id; });
          renderPolls();
        });
      };
    });
  }

  function renderNewPoll() {
    root.innerHTML =
      '<button class="portal-signout" id="backList" style="margin-bottom:1rem">← Back to polls</button>' +
      '<div class="card-form" style="max-width:640px">' +
        '<h3 style="color:var(--navy);font-family:var(--display)">New poll</h3>' +
        '<form id="pollForm" novalidate>' +
          '<div class="field"><label>Question *</label><input name="question" required maxlength="200"></div>' +
          '<div class="field"><label>Options (one per line, 2–6) *</label><textarea name="opts" rows="5" required></textarea></div>' +
          '<div class="field"><label>Closes (optional)</label><input name="closes" type="datetime-local"></div>' +
          '<button class="btn btn--navy" type="submit" style="width:100%">Post poll</button>' +
          '<p class="form-status" id="pollStatus"></p>' +
        '</form></div>';
    document.getElementById('backList').onclick = renderList;
    document.getElementById('pollForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = document.getElementById('pollStatus');
      var opts = f.opts.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!f.question.value.trim() || opts.length < 2 || opts.length > 6) {
        st.className = 'form-status err'; st.textContent = 'Question plus 2–6 options required.'; return;
      }
      Z.pollCreate({
        question: f.question.value.trim(),
        options: opts,
        closes_at: f.closes.value ? new Date(f.closes.value).toISOString() : null
      }).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        Z.pollsList().then(function (ps) { POLLS = ps; renderList(); });
      });
    };
  }

  /* ---------- suggestion box ---------- */
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
    var where = comm ? esc(comm.name) : catLabel(state.cat);
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
      '<button class="portal-signout" id="backList" style="margin-bottom:1rem">← Back to ' + where + '</button>' +
      '<div class="card-form" style="max-width:680px">' +
        '<h3 style="color:var(--navy);font-family:var(--display)">New ' + (oppNow ? 'opportunity' : 'thread') + ' · ' + where + '</h3>' +
        '<form id="thrForm" novalidate>' +
          catField +
          '<div class="field" id="tagField"' + (oppNow ? '' : ' style="display:none"') + '><label>Type</label><select name="tag">' +
            '<option value="offering">💼 Offering — I have a job/internship/referral</option>' +
            '<option value="seeking">🔎 Seeking — I\'m looking for opportunities</option></select></div>' +
          '<div class="field"><label>Title *</label><input name="title" required maxlength="140" value="' + esc(prefillTitle || '') + '"></div>' +
          '<div class="field"><label>Post *</label><textarea name="body" required></textarea></div>' +
          '<div class="field"><label>Photo (optional)</label><input type="file" name="photo" accept="image/*"></div>' +
          '<button class="btn btn--navy" type="submit" style="width:100%">Post thread</button>' +
          '<p class="form-status" id="thrStatus" role="status"></p>' +
        '</form></div>';
    document.getElementById('backList').onclick = renderList;

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
  function renderThread(t) {
    state.thread = t;
    state.cat = t.committee_id || t.category;
    markSeen(t.id);
    var comm = committeeOf(t.committee_id);
    var backLabel = comm ? esc(comm.name) : catLabel(t.category);
    var tag = t.tag ? '<span class="thr-tag thr-tag--' + t.tag + '">' + (t.tag === 'offering' ? 'Offering' : 'Seeking') + '</span>' : '';
    var canDel = me && (t.author_user === me.id || isAdmin);
    root.innerHTML =
      '<button class="portal-signout" id="backList" style="margin-bottom:1rem">← Back to ' + backLabel + '</button>' +
      '<article class="thread-view">' +
        '<h2>' + tag + esc(t.title) + '</h2>' +
        '<div class="thread-view__meta">' + chip(t.author_user) + ' · ' + when(t.created_at) +
          (canDel ? ' · <a href="#" id="delThread">delete thread</a>' : '') + '</div>' +
        (t.image_path ? '<div class="thread-view__photo" id="threadPhoto"></div>' : '') +
        '<div class="thread-view__body">' + esc(t.body).replace(/\n/g, '<br>') + '</div>' +
        '<h3 class="stat-h">Replies</h3>' +
        '<div id="replies"><p class="form-note">…</p></div>' +
        '<form class="gcompose" id="replyForm" style="margin-top:1rem">' +
          '<input id="replyInput" placeholder="Write a reply…" maxlength="2000" />' +
          '<button type="submit" class="btn btn--navy">Reply</button>' +
        '</form>' +
      '</article>';
    document.getElementById('backList').onclick = renderList;
    var del = document.getElementById('delThread');
    if (del) del.onclick = function (e) {
      e.preventDefault();
      if (!confirm('Delete this thread and all replies?')) return;
      Z.threadDelete(t.id).then(function () { loadAll().then(renderList); });
    };
    if (t.image_path) {
      Z.gallerySignedUrls([t.image_path]).then(function (urls) {
        var ph = document.getElementById('threadPhoto');
        var u = urls[t.image_path];
        if (ph && u) ph.innerHTML = '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt=""></a>';
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
        box.innerHTML = rs.map(function (r) {
          var mine = me && (r.author_user === me.id || isAdmin);
          return '<div class="gcomment">' + chip(r.author_user) +
            '<p>' + esc(r.body).replace(/\n/g, '<br>') + '</p>' +
            '<small>' + when(r.created_at) + (mine ? ' · <a href="#" data-delr="' + r.id + '">delete</a>' : '') + '</small>' +
            reactBar(r) + '</div>';
        }).join('');
        box.querySelectorAll('[data-delr]').forEach(function (a) {
          a.onclick = function (e) {
            e.preventDefault();
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
        renderList();
      }).catch(function () {
        root.innerHTML = '<p class="page-empty">Could not load the board. Try refreshing.</p>';
      });
    });
  });
})();
