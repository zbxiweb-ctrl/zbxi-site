/* Private brothers-only gallery: Instagram-style grid + post modal with
   likes and comments. Everything is RLS-gated server-side; this script also
   gates the UI. Renders into #galleryRoot. */
(function () {
  'use strict';
  var root = document.getElementById('galleryRoot');
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

  function locked(msg, needSignin) {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>' + msg + '</b>' +
      '<span>' + (needSignin
        ? 'The gallery is private to verified brothers. Sign in (or create your profile) to get access.'
        : 'Your profile is awaiting verification by chapter leadership. The gallery unlocks once you\'re approved.') + '</span>' +
      (needSignin ? '<a class="btn btn--gold" href="index.html#brothers-portal">Brother sign in</a>' : '') +
      '</div>';
  }

  if (!Z || !Z.configured) { locked('Members only', true); return; }

  var me = null, dir = {}, posts = [], likes = [], urls = {}, isAdmin = false;

  function likeCount(pid) { return likes.filter(function (l) { return l.post_id === pid; }).length; }
  function iLike(pid) { return me && likes.some(function (l) { return l.post_id === pid && l.user_id === me.id; }); }
  function author(uid) { return dir[uid] || { full_name: 'A brother', photo_url: null }; }

  function chip(uid) {
    var a = author(uid);
    var av = a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="">' :
      '<span>' + esc(String(a.full_name || 'Ζ').trim()[0] || 'Ζ') + '</span>';
    return '<span class="author-chip"><i class="author-chip__av">' + av + '</i><b>' + esc(a.full_name) + '</b></span>';
  }

  /* ---------- grid ---------- */
  function renderGrid() {
    var uploader =
      '<div class="gupload">' +
        '<form id="guForm">' +
          '<label class="gupload__drop" id="guDrop">📷 <b>Share a photo with the brotherhood</b><span id="guName">Click to choose an image (max 5MB)</span>' +
            '<input type="file" id="guFile" accept="image/*" hidden></label>' +
          '<div class="gupload__row">' +
            '<input id="guCaption" placeholder="Write a caption…" maxlength="300">' +
            '<button class="btn btn--gold" type="submit" id="guBtn" disabled>Post</button>' +
          '</div>' +
          '<p class="form-status" id="guStatus" role="status"></p>' +
        '</form>' +
      '</div>';

    var grid;
    if (!posts.length) {
      grid = '<p class="page-empty">No posts yet — be the first to share a memory.</p>';
    } else {
      grid = '<div class="ggrid">' + posts.map(function (p) {
        var u = urls[p.image_path];
        var img = u ? '<img src="' + esc(u) + '" loading="lazy" alt="">' : '<span class="ggrid__ph">…</span>';
        return '<button class="ggrid__cell" data-post="' + p.id + '">' + img +
          '<span class="ggrid__hover">♥ ' + likeCount(p.id) + '</span></button>';
      }).join('') + '</div>';
    }

    root.innerHTML = uploader + grid;
    wireUpload();
    root.querySelectorAll('[data-post]').forEach(function (c) {
      c.addEventListener('click', function () {
        var p = posts.filter(function (x) { return x.id === c.dataset.post; })[0];
        if (p) openPost(p);
      });
    });
  }

  /* ---------- upload (canvas-downscale to ≤1600px JPEG) ---------- */
  function wireUpload() {
    var form = document.getElementById('guForm');
    var fileIn = document.getElementById('guFile');
    var drop = document.getElementById('guDrop');
    var nameEl = document.getElementById('guName');
    var btn = document.getElementById('guBtn');
    var st = document.getElementById('guStatus');
    if (!form) return;
    drop.addEventListener('click', function () { fileIn.click(); });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0];
      if (!f) { btn.disabled = true; return; }
      if (f.size > 5 * 1024 * 1024) { st.className = 'form-status err'; st.textContent = 'That image is over 5MB.'; btn.disabled = true; return; }
      st.textContent = ''; nameEl.textContent = f.name; btn.disabled = false;
    });
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = fileIn.files[0];
      if (!f) return;
      btn.disabled = true; btn.textContent = 'Posting…';
      Z.downscale(f, 1600).then(function (blob) {
        return Z.galleryUpload(me.id, blob, 'jpg');
      }).then(function (path) {
        return Z.galleryCreate({ author_user: me.id, image_path: path, caption: document.getElementById('guCaption').value.trim() || null });
      }).then(function (r) {
        if (r.error) throw r.error;
        btn.textContent = 'Post';
        return loadAll();
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Upload failed.';
        btn.disabled = false; btn.textContent = 'Post';
      });
    };
  }

  /* ---------- post modal ---------- */
  var modal = document.getElementById('postModal');
  function g(name) { return modal.querySelector('[data-g=' + name + ']'); }

  function openPost(p) {
    g('img').src = urls[p.image_path] || '';
    g('author').innerHTML = chip(p.author_user);
    g('caption').textContent = p.caption || '';
    g('date').textContent = when(p.created_at);
    var del = g('delete');
    del.style.display = (me && (p.author_user === me.id || isAdmin)) ? '' : 'none';
    del.onclick = function () {
      if (!confirm('Delete this post?')) return;
      Z.galleryDeletePost(p.id, p.author_user === me.id ? p.image_path : null).then(function () {
        closeModal(); loadAll();
      });
    };
    syncLike(p);
    g('like').onclick = function () {
      var liked = iLike(p.id);
      var op = liked ? Z.unlikePost(p.id, me.id) : Z.likePost(p.id, me.id);
      // optimistic
      if (liked) likes = likes.filter(function (l) { return !(l.post_id === p.id && l.user_id === me.id); });
      else likes.push({ post_id: p.id, user_id: me.id });
      syncLike(p);
      op.then(function (r) { if (r.error) { Z.galleryLikesAll().then(function (ls) { likes = ls; syncLike(p); }); } });
    };
    loadComments(p);
    var form = g('composeForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var input = g('composeInput');
      var body = input.value.trim();
      if (!body) return;
      input.value = '';
      Z.addComment(p.id, me.id, body).then(function () { loadComments(p); });
    };
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  }

  function syncLike(p) {
    g('like').innerHTML = (iLike(p.id) ? '♥' : '♡') + ' <span>' + likeCount(p.id) + '</span>';
    g('like').classList.toggle('on', iLike(p.id));
  }

  function loadComments(p) {
    var box = g('comments');
    box.innerHTML = '<p class="form-note">…</p>';
    Z.galleryComments(p.id).then(function (cs) {
      if (!cs.length) { box.innerHTML = '<p class="form-note">No comments yet.</p>'; return; }
      box.innerHTML = cs.map(function (c) {
        var mine = me && (c.author_user === me.id || isAdmin);
        return '<div class="gcomment">' + chip(c.author_user) +
          '<p>' + esc(c.body) + '</p>' +
          '<small>' + when(c.created_at) + (mine ? ' · <a href="#" data-delc="' + c.id + '">delete</a>' : '') + '</small></div>';
      }).join('');
      box.querySelectorAll('[data-delc]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          Z.deleteComment(a.dataset.delc).then(function () { loadComments(p); });
        };
      });
    });
  }

  function closeModal() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  modal.addEventListener('click', function (e) {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* ---------- data ---------- */
  function loadAll() {
    return Promise.all([Z.galleryList(), Z.galleryLikesAll(), Z.memberDirectory()]).then(function (res) {
      posts = res[0]; likes = res[1]; dir = res[2] || {};
      var paths = posts.map(function (p) { return p.image_path; });
      return Z.gallerySignedUrls(paths).then(function (map) {
        urls = map; renderGrid();
      });
    });
  }

  Z.getUser().then(function (u) {
    me = u;
    if (!u) { locked('Members only', true); return; }
    isAdmin = Z.adminEmail && (u.email || '').toLowerCase() === Z.adminEmail;
    Z.amApprovedBrother().then(function (ok) {
      if (!ok) { locked('Awaiting verification', false); return; }
      loadAll().catch(function () {
        root.innerHTML = '<p class="page-empty">Could not load the gallery. Try refreshing.</p>';
      });
    });
  });
})();
