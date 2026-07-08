/* Members-only discussion board: category tabs (Chapter Business / Advice /
   Social / Opportunities), thread list -> thread view with replies, new-thread
   composer. Opportunities threads carry an Offering/Seeking tag (job board).
   RLS-gated server-side. Renders into #boardRoot. */
(function () {
  'use strict';
  var root = document.getElementById('boardRoot');
  if (!root) return;
  var Z = window.ZBXI;

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function when(ts) {
    var d = new Date(ts), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.round(diff / 86400) + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  var CATS = [
    { id: 'chapter',       label: 'Chapter Business' },
    { id: 'advice',        label: 'Advice' },
    { id: 'social',        label: 'Social' },
    { id: 'opportunities', label: 'Opportunities 💼' }
  ];
  function catLabel(id) { var c = CATS.filter(function (x) { return x.id === id; })[0]; return c ? c.label : id; }

  function locked(msg, needSignin) {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>' + msg + '</b>' +
      '<span>' + (needSignin
        ? 'The board is private to verified brothers. Sign in (or create your profile) to join the conversation.'
        : 'Your profile is awaiting verification by chapter leadership. The board unlocks once you\'re approved.') + '</span>' +
      (needSignin ? '<a class="btn btn--gold" href="index.html#brothers-portal">Brother sign in</a>' : '') +
      '</div>';
  }

  if (!Z || !Z.configured) { locked('Members only', true); return; }

  var me = null, dir = {}, threads = [], counts = {}, isAdmin = false;
  var state = { cat: 'chapter', thread: null };

  function author(uid) { return dir[uid] || { full_name: 'A brother', photo_url: null }; }
  function chip(uid) {
    var a = author(uid);
    var av = a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="">' :
      '<span>' + esc(String(a.full_name || 'Ζ').trim()[0] || 'Ζ') + '</span>';
    return '<span class="author-chip"><i class="author-chip__av">' + av + '</i><b>' + esc(a.full_name) + '</b></span>';
  }

  /* ---------- thread list ---------- */
  function renderList() {
    state.thread = null;
    var mine = threads.filter(function (t) { return t.category === state.cat; });
    var tabs = '<div class="board-tabs">' + CATS.map(function (c) {
      var n = threads.filter(function (t) { return t.category === c.id; }).length;
      return '<button class="' + (state.cat === c.id ? 'on' : '') + '" data-cat="' + c.id + '">' + c.label + (n ? ' <i>' + n + '</i>' : '') + '</button>';
    }).join('') + '</div>';

    var newBtn = '<p style="margin:1rem 0"><button class="btn btn--gold" id="newThread">+ New ' +
      (state.cat === 'opportunities' ? 'opportunity' : 'thread') + '</button></p>';

    var list = mine.length ? '<div class="thread-list">' + mine.map(function (t) {
      var tag = t.tag ? '<span class="thr-tag thr-tag--' + t.tag + '">' + (t.tag === 'offering' ? 'Offering' : 'Seeking') + '</span>' : '';
      return '<button class="thread-row" data-thr="' + t.id + '">' +
        '<div class="thread-row__main"><b>' + tag + esc(t.title) + '</b>' +
          '<span>' + chip(t.author_user) + ' · ' + when(t.created_at) + '</span></div>' +
        '<div class="thread-row__count">' + (counts[t.id] || 0) + ' ↩</div></button>';
    }).join('') + '</div>'
      : '<p class="page-empty">No threads in ' + catLabel(state.cat) + ' yet — start the first one.</p>';

    root.innerHTML = tabs + newBtn + list;
    root.querySelectorAll('[data-cat]').forEach(function (b) {
      b.onclick = function () { state.cat = b.dataset.cat; renderList(); };
    });
    document.getElementById('newThread').onclick = renderCompose;
    root.querySelectorAll('[data-thr]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = threads.filter(function (x) { return x.id === b.dataset.thr; })[0];
        if (t) renderThread(t);
      });
    });
  }

  /* ---------- new thread ---------- */
  function renderCompose() {
    var isOpp = state.cat === 'opportunities';
    root.innerHTML =
      '<button class="portal-signout" id="backList" style="margin-bottom:1rem">← Back to ' + catLabel(state.cat) + '</button>' +
      '<div class="card-form" style="max-width:680px">' +
        '<h3 style="color:var(--navy);font-family:var(--display)">New ' + (isOpp ? 'opportunity' : 'thread') + ' · ' + catLabel(state.cat) + '</h3>' +
        '<form id="thrForm" novalidate>' +
          (isOpp
            ? '<div class="field"><label>Type</label><select name="tag">' +
                '<option value="offering">💼 Offering — I have a job/internship/referral</option>' +
                '<option value="seeking">🔎 Seeking — I\'m looking for opportunities</option></select></div>'
            : '') +
          '<div class="field"><label>Title *</label><input name="title" required maxlength="140"></div>' +
          '<div class="field"><label>Post *</label><textarea name="body" required></textarea></div>' +
          '<button class="btn btn--navy" type="submit" style="width:100%">Post thread</button>' +
          '<p class="form-status" id="thrStatus" role="status"></p>' +
        '</form></div>';
    document.getElementById('backList').onclick = renderList;
    document.getElementById('thrForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = document.getElementById('thrStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      f.querySelector('button').disabled = true;
      Z.threadCreate({
        author_user: me.id,
        category: state.cat,
        tag: isOpp ? f.tag.value : null,
        title: f.title.value.trim(),
        body: f.body.value.trim()
      }).then(function (r) {
        if (r.error) throw r.error;
        return loadAll().then(function () { renderThread(r.data); });
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not post.';
        f.querySelector('button').disabled = false;
      });
    };
  }

  /* ---------- thread view ---------- */
  function renderThread(t) {
    state.thread = t;
    var tag = t.tag ? '<span class="thr-tag thr-tag--' + t.tag + '">' + (t.tag === 'offering' ? 'Offering' : 'Seeking') + '</span>' : '';
    var canDel = me && (t.author_user === me.id || isAdmin);
    root.innerHTML =
      '<button class="portal-signout" id="backList" style="margin-bottom:1rem">← Back to ' + catLabel(t.category) + '</button>' +
      '<article class="thread-view">' +
        '<h2>' + tag + esc(t.title) + '</h2>' +
        '<div class="thread-view__meta">' + chip(t.author_user) + ' · ' + when(t.created_at) +
          (canDel ? ' · <a href="#" id="delThread">delete thread</a>' : '') + '</div>' +
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
    loadReplies(t);
    document.getElementById('replyForm').onsubmit = function (e) {
      e.preventDefault();
      var input = document.getElementById('replyInput');
      var body = input.value.trim();
      if (!body) return;
      input.value = '';
      Z.replyCreate({ thread_id: t.id, author_user: me.id, body: body }).then(function () {
        counts[t.id] = (counts[t.id] || 0) + 1;
        loadReplies(t);
      });
    };
  }

  function loadReplies(t) {
    var box = document.getElementById('replies');
    Z.threadReplies(t.id).then(function (rs) {
      if (!rs.length) { box.innerHTML = '<p class="form-note">No replies yet.</p>'; return; }
      box.innerHTML = rs.map(function (r) {
        var mine = me && (r.author_user === me.id || isAdmin);
        return '<div class="gcomment">' + chip(r.author_user) +
          '<p>' + esc(r.body).replace(/\n/g, '<br>') + '</p>' +
          '<small>' + when(r.created_at) + (mine ? ' · <a href="#" data-delr="' + r.id + '">delete</a>' : '') + '</small></div>';
      }).join('');
      box.querySelectorAll('[data-delr]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          Z.replyDelete(a.dataset.delr).then(function () { loadReplies(t); });
        };
      });
    });
  }

  /* ---------- data ---------- */
  function loadAll() {
    return Promise.all([Z.threadsList(), Z.replyCounts(), Z.memberDirectory()]).then(function (res) {
      threads = res[0]; counts = res[1]; dir = res[2] || {};
    });
  }

  Z.getUser().then(function (u) {
    me = u;
    if (!u) { locked('Members only', true); return; }
    isAdmin = Z.adminEmail && (u.email || '').toLowerCase() === Z.adminEmail;
    Z.amApprovedBrother().then(function (ok) {
      if (!ok) { locked('Awaiting verification', false); return; }
      loadAll().then(function () {
        // Deep link: board.html#thread=<id> (from notifications)
        var m = location.hash.match(/thread=([\w-]+)/);
        var t = m && threads.filter(function (x) { return x.id === m[1]; })[0];
        if (t) { state.cat = t.category; renderThread(t); } else renderList();
      }).catch(function () {
        root.innerHTML = '<p class="page-empty">Could not load the board. Try refreshing.</p>';
      });
    });
  });
})();
