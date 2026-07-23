/* Private brothers-only gallery: Instagram-style grid + post modal with
   likes and comments. Everything is RLS-gated server-side; this script also
   gates the UI. Renders into #galleryRoot. */
(function () {
  'use strict';
  var root = document.getElementById('galleryRoot');
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

  function locked(msg, needSignin) {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>' + msg + '</b>' +
      '<span>' + (needSignin
        ? 'The gallery is private to verified brothers. Sign in (or create your profile) to get access.'
        : 'Your profile is awaiting verification by chapter leadership. The gallery unlocks once you\'re approved.') + '</span>' +
      (needSignin ? '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a>' : '') +
      '</div>';
  }

  if (!Z || !Z.configured) { locked('Members only', true); return; }

  // canMod = may delete anyone's post/comment: the admin, OR a President whose
  // seat has gallery.moderate switched on. canPost = may create a post: the admin
  // OR a seat with gallery.post switched on. The DB enforces both (the gallery
  // insert/delete policies check officer_can); these flags only shape the UI.
  var me = null, dir = {}, posts = [], likes = [], urls = {}, isAdmin = false, canMod = false, canPost = false;
  var albums = [], curAlbum = 'all', canAlbums = false, manageOpen = false;

  // Posts with no album_id fall into Miscellaneous (the fallback bucket) so a
  // deleted-album's photos are never orphaned. albumName() reads the same map.
  function miscId() { var m = albums.filter(function (a) { return a.name === 'Miscellaneous'; })[0]; return m ? m.id : null; }
  function albumOf(p) { return p.album_id || miscId(); }
  function albumCount(id) { return posts.filter(function (p) { return albumOf(p) === id; }).length; }
  function albumName(p) { var a = albums.filter(function (x) { return x.id === albumOf(p); })[0]; return a ? a.name : ''; }

  // Paint the skeleton NOW for a likely-signed-in brother — the auth checks below
  // take ~200ms and used to be a blank screen. Signed-out visitors skip it and go
  // straight to the lock, never teased with tiles they can't open.
  if (Z.hasSessionHint && Z.hasSessionHint()) root.innerHTML = gallerySkeleton();

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
  function albumPicker() {
    var mid = miscId();
    return '<select class="zselect gupload__album" id="guAlbum" aria-label="Album">' +
      albums.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === mid ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select>';
  }

  function uploaderHtml() {
    return '<div class="gupload">' +
        '<form id="guForm">' +
          '<label class="gupload__drop" id="guDrop">📷 <b>Share a photo with the brotherhood</b><span id="guName">Click to choose an image (max 5MB)</span>' +
            '<input type="file" id="guFile" accept="image/*" hidden></label>' +
          '<div class="gupload__row">' +
            (albums.length ? albumPicker() : '') +
            '<input id="guCaption" placeholder="Write a caption…" maxlength="300">' +
            '<button class="btn btn--gold" type="submit" id="guBtn" disabled>Post</button>' +
          '</div>' +
          '<p class="form-status" id="guStatus" role="status"></p>' +
        '</form>' +
      '</div>';
  }

  // Album filter chips: 'All' + one per album with a count, dimmed when empty
  // (never hidden), matching the board. Names are user-visible -> esc().
  function chipsHtml() {
    if (!albums.length) return '';
    var chip = function (id, label, n) {
      return '<button class="gchip' + (curAlbum === id ? ' on' : '') + (n === 0 ? ' gchip--empty' : '') +
        '" data-album="' + esc(id) + '">' + esc(label) + '<span class="gchip__n">' + n + '</span></button>';
    };
    return '<div class="gchips">' + chip('all', 'All', posts.length) +
      albums.map(function (a) { return chip(a.id, a.name, albumCount(a.id)); }).join('') + '</div>';
  }

  // Section manager — shown only to the admin OR a granted alumni president
  // (canAlbums). The DB (officer_can on gallery_albums, upgrade31) is the real
  // gate; this UI just exposes the controls. Names are user-visible -> esc().
  function sectionMgrHtml() {
    if (!canAlbums) return '';
    var toggle = '<button class="galbum-mgr__toggle" id="mgToggle" aria-expanded="' + (manageOpen ? 'true' : 'false') + '">✎ Manage sections</button>';
    if (!manageOpen) return '<div class="galbum-mgr">' + toggle + '</div>';
    var rows = albums.map(function (a) {
      // Miscellaneous is the fixed fallback bucket — no rename/delete (the DB
      // enforces it too, upgrade31).
      var acts = a.name === 'Miscellaneous'
        ? '<span class="galbum-mgr__acts galbum-mgr__acts--fixed">default section</span>'
        : '<span class="galbum-mgr__acts"><a href="#" data-alb-rn="' + esc(a.id) + '" data-alb-nm="' + esc(a.name) + '">rename</a> · <a href="#" data-alb-del="' + esc(a.id) + '" data-alb-nm="' + esc(a.name) + '">delete</a></span>';
      return '<div class="galbum-mgr__row"><b>' + esc(a.name) + '</b>' + acts + '</div>';
    }).join('');
    return '<div class="galbum-mgr galbum-mgr--open">' + toggle +
      '<div class="galbum-mgr__list">' + rows +
        '<button class="btn btn--ghost galbum-mgr__add" id="mgAdd">＋ New section</button>' +
      '</div></div>';
  }

  function gridHtml() {
    var shown = curAlbum === 'all' ? posts : posts.filter(function (p) { return albumOf(p) === curAlbum; });
    if (!shown.length) {
      return '<p class="page-empty">' + (curAlbum === 'all'
        ? 'No posts yet — be the first to share a memory.'
        : 'No photos in this album yet.') + '</p>';
    }
    return '<div class="ggrid">' + shown.map(function (p) {
      var u = urls[p.image_path];
      var img = u ? '<img src="' + esc(u) + '" loading="lazy" alt="' + esc(p.caption || 'Gallery photo') + '">' : '<span class="ggrid__ph">…</span>';
      return '<button class="ggrid__cell" data-post="' + p.id + '" aria-label="' + esc('Open photo' + (p.caption ? ': ' + p.caption : '')) + '">' + img +
        '<span class="ggrid__hover">♥ ' + likeCount(p.id) + '</span></button>';
    }).join('') + '</div>';
  }

  // Only the chips+grid re-render on album switch, so a half-filled composer above
  // (chosen file, typed caption) survives the click.
  function renderBody() {
    var body = document.getElementById('galleryBody');
    if (!body) return;
    body.innerHTML = chipsHtml() + sectionMgrHtml() + gridHtml();
    body.querySelectorAll('[data-album]').forEach(function (c) {
      c.addEventListener('click', function () { curAlbum = c.dataset.album; renderBody(); });
    });
    body.querySelectorAll('[data-post]').forEach(function (c) {
      c.addEventListener('click', function () {
        var p = posts.filter(function (x) { return x.id === c.dataset.post; })[0];
        if (p) openPost(p);
      });
    });
    wireSectionMgr(body);
  }

  // Create/rename/delete sections via the existing album helpers. RLS rejects a
  // caller without the grant, so this is safe even if the UI ever showed by mistake.
  function wireSectionMgr(body) {
    var tog = body.querySelector('#mgToggle');
    if (tog) tog.addEventListener('click', function () { manageOpen = !manageOpen; renderBody(); });
    var add = body.querySelector('#mgAdd');
    if (add) add.addEventListener('click', function () {
      ZBXIAsk.text({ title: 'New section', placeholder: 'e.g. Formal 2026', ok: 'Create' }, function (name) {
        name = (name || '').trim(); if (!name) return;
        Z.albumCreate(name).then(function (r) {
          if (r && r.error) { alert(r.error.message || 'Could not create that section (is the name already taken?).'); return; }
          loadAll();
        });
      });
    });
    body.querySelectorAll('[data-alb-rn]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        ZBXIAsk.text({ title: 'Rename section', value: a.getAttribute('data-alb-nm'), ok: 'Save' }, function (name) {
          name = (name || '').trim(); if (!name) return;
          Z.albumRename(a.getAttribute('data-alb-rn'), name).then(function () { loadAll(); });
        });
      });
    });
    body.querySelectorAll('[data-alb-del]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var id = a.getAttribute('data-alb-del');
        if (!confirm('Delete the section “' + a.getAttribute('data-alb-nm') + '”?\nIts photos are NOT deleted — they move to Miscellaneous.')) return;
        if (curAlbum === id) curAlbum = 'all';
        Z.albumDelete(id).then(function () { loadAll(); });
      });
    });
  }

  function renderGrid() {
    root.innerHTML = (canPost ? uploaderHtml() : '') + '<div id="galleryBody"></div>';
    if (canPost) wireUpload();
    renderBody();
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
      var albumSel = document.getElementById('guAlbum');
      var albumId = albumSel && albumSel.value ? albumSel.value : null;   // null -> Miscellaneous
      Z.downscale(f, 1600).then(function (blob) {
        return Z.galleryUpload(me.id, blob, 'jpg');
      }).then(function (path) {
        return Z.galleryCreate({ author_user: me.id, image_path: path, caption: document.getElementById('guCaption').value.trim() || null, album_id: albumId });
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
    g('img').alt = p.caption || 'Gallery photo';
    g('author').innerHTML = chip(p.author_user);
    g('caption').textContent = p.caption || '';
    var an = albumName(p);
    g('date').textContent = (an ? an + ' · ' : '') + when(p.created_at);
    var del = g('delete');
    del.style.display = (me && (p.author_user === me.id || canMod)) ? '' : 'none';
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
        var mine = me && (c.author_user === me.id || canMod);
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
    return Promise.all([Z.galleryList(), Z.galleryLikesAll(), Z.memberDirectory(), Z.galleryAlbums()]).then(function (res) {
      posts = res[0]; likes = res[1]; dir = res[2] || {}; albums = res[3] || [];
      var paths = posts.map(function (p) { return p.image_path; });
      return Z.gallerySignedUrls(paths).then(function (map) {
        urls = map; renderGrid();
      });
    });
  }

  function gallerySkeleton() {
    var one = '<div class="ggrid__cell sk" aria-hidden="true"></div>';
    return '<div class="ggrid" aria-hidden="true">' + new Array(13).join(one) + '</div>';
  }

  Z.getUser().then(function (u) {
    me = u;
    if (!u) { locked('Members only', true); return; }
    isAdmin = Z.adminEmail && (u.email || '').toLowerCase() === Z.adminEmail;
    canMod = isAdmin;
    Z.amApprovedBrother().then(function (ok) {
      if (!ok) { locked('Awaiting verification', false); return; }
      Promise.all([
        Z.officerCan ? Z.officerCan('gallery.moderate') : Promise.resolve(false),
        Z.officerCan ? Z.officerCan('gallery.post') : Promise.resolve(false),
        Z.officerCan ? Z.officerCan('gallery.albums') : Promise.resolve(false)
      ]).then(function (r) {
        canMod = isAdmin || r[0];
        canPost = isAdmin || r[1];
        canAlbums = isAdmin || r[2];
        if (!root.querySelector('.sk')) root.innerHTML = gallerySkeleton();  // unless already painted above
        loadAll().catch(function () {
          root.innerHTML = '<p class="page-empty">Could not load the gallery. Try refreshing.</p>';
        });
      });
    });
  });
})();
