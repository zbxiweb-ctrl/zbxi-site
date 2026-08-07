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

  // canPost = may create a post: EVERY approved brother, since upgrade41. canMod =
  // may edit or delete anyone else's post/comment: the admin, OR a President whose
  // seat has gallery.moderate switched on. The DB enforces both (the gallery
  // insert/update/delete policies); these flags only shape the UI.
  var me = null, dir = {}, posts = [], likes = [], urls = {}, isAdmin = false, canMod = false, canPost = false;
  // view: 'sections' = the cover-card front door, 'grid' = one section's photos.
  var albums = [], curAlbum = 'all', canAlbums = false, manageOpen = false, view = 'sections';
  // Standing inside ONE named section (not the sections page, not "All photos").
  function inSection() { return view === 'grid' && curAlbum !== 'all'; }

  // Posts with no album_id fall into Miscellaneous (the fallback bucket) so a
  // deleted-album's photos are never orphaned. albumName() reads the same map.
  function miscId() { var m = albums.filter(function (a) { return a.name === 'Miscellaneous'; })[0]; return m ? m.id : null; }
  function albumOf(p) { return p.album_id || miscId(); }
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
  // Shared by the composer (defaults to Miscellaneous) and the inline post editor
  // (defaults to the post's own section), so the two controls stay identical.
  function albumPicker(id, selId) {
    return '<select class="zselect gupload__album" id="' + id + '" aria-label="Album">' +
      albums.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === selId ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select>';
  }

  // Drawn, not typed: an emoji camera renders differently on every platform and
  // this mark is the first thing on the page.
  var CAM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1 1 0 0 1 8.7 4.7h6.6a1 1 0 0 1 .9.5L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>' +
    '<circle cx="12" cy="13" r="3.4"/></svg>';

  function uploaderHtml() {
    return '<div class="gupload">' +
        '<form id="guForm">' +
          '<label class="gupload__drop" id="guDrop">' +
            '<span class="gupload__empty" id="guEmpty">' +
              '<span class="gupload__mark">' + CAM_SVG + '</span>' +
              '<b>Share a photo with the brotherhood</b>' +
              '<span class="gupload__hint">JPG, PNG or HEIC · up to 25MB</span>' +
            '</span>' +
            // alt="" on purpose: the filename sits right below it, and an empty
            // alt means a src-less <img> can never paint alt text in a broken
            // frame again — which is what the old "Preview of the photo you
            // chose" box was.
            '<span class="gupload__chosen" id="guChosen" hidden>' +
              '<img id="guPrev" class="gupload__prev" alt="">' +
              '<span class="gupload__meta"><b id="guName"></b><span id="guSize"></span></span>' +
              '<span class="gupload__change">Choose a different photo</span>' +
            '</span>' +
            '<input type="file" id="guFile" accept="image/*" hidden></label>' +
          // Inside a section the destination is already decided, so the picker
          // asks a question you just answered. State it instead. On "All photos"
          // (and on the sections page) nothing is implied, so it still has to ask.
          (inSection()
            ? '<p class="gupload__dest">Posting to <b>' + esc(curSecName()) + '</b></p>'
            : '') +
          '<div class="gupload__row">' +
            (!inSection() && albums.length ? albumPicker('guAlbum', miscId()) : '') +
            '<input id="guCaption" aria-label="Photo caption" placeholder="Write a caption…" maxlength="300">' +
            '<button class="btn btn--gold" type="submit" id="guBtn" disabled>Post</button>' +
          '</div>' +
          '<p class="form-status" id="guStatus" role="status"></p>' +
        '</form>' +
      '</div>';
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

  /* ---------- sections view ----------
     The gallery's front door. Cover = the newest photo in that section, taken
     from data already in memory (posts / albums / urls) — no extra query. An
     empty section still shows, marked with the crest, exactly as the chips dim
     rather than hide. */
  function postsIn(albumId) {
    return albumId === 'all' ? posts : posts.filter(function (p) { return albumOf(p) === albumId; });
  }
  function coverHtml(rows) {
    var u;
    for (var i = 0; i < rows.length; i++) { u = urls[rows[i].image_path]; if (u) break; u = null; }
    return u
      ? '<img src="' + esc(u) + '" loading="lazy" alt="">'
      : '<img class="gsec__crest" src="assets/img/crest-float-gold.webp" alt="" loading="lazy">';
  }
  function secCard(id, name, extraClass) {
    var rows = postsIn(id);
    var n = rows.length;
    return '<button class="gsec' + (extraClass || '') + '" data-sec="' + esc(id) + '" ' +
        'aria-label="' + esc('Open ' + name) + '">' +
        '<span class="gsec__cover">' + coverHtml(rows) + '</span>' +
        '<span class="gsec__plate"><span class="gsec__name">' + esc(name) + '</span>' +
          '<span class="gsec__n">' + (n === 0 ? 'No photos yet' : n + (n === 1 ? ' photo' : ' photos')) + '</span>' +
        '</span></button>';
  }
  function sectionsHtml() {
    return '<div class="gsecs">' +
      secCard('all', 'All photos', ' gsec--all') +
      albums.map(function (a) { return secCard(a.id, a.name); }).join('') +
      '</div>';
  }

  // The name of the section you're standing in — what the chips used to tell you.
  function curSecName() {
    if (curAlbum === 'all') return 'All photos';
    var a = albums.filter(function (x) { return x.id === curAlbum; })[0];
    return a ? a.name : 'Photos';
  }
  function secHeadHtml() {
    var n = postsIn(curAlbum).length;
    return '<div class="gsechead"><h3>' + esc(curSecName()) + '</h3>' +
      '<span>' + (n === 0 ? 'No photos yet' : n + (n === 1 ? ' photo' : ' photos')) + '</span></div>';
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
      return '<button class="ggrid__cell" data-post="' + esc(p.id) + '" aria-label="' + esc('Open photo' + (p.caption ? ': ' + p.caption : '')) + '">' + img +
        '<span class="ggrid__hover">♥ ' + likeCount(p.id) + '</span></button>';
    }).join('') + '</div>';
  }

  // Only the chips+grid re-render on album switch, so a half-filled composer above
  // (chosen file, typed caption) survives the click.
  function renderBody() {
    var body = document.getElementById('galleryBody');
    if (!body) return;
    // No chips inside a section: you already picked it, and offering all six again
    // is clutter. The heading says where you are; the back pill is how you leave.
    body.innerHTML = view === 'sections'
      ? sectionsHtml() + sectionMgrHtml()
      : '<button class="back-pill" id="gsecBack">← All sections</button>' + secHeadHtml() + gridHtml();
    var back = body.querySelector('#gsecBack');
    if (back) back.addEventListener('click', function () { view = 'sections'; renderGrid(); });
    body.querySelectorAll('[data-sec]').forEach(function (c) {
      c.addEventListener('click', function () {
        curAlbum = c.dataset.sec; view = 'grid';
        // renderGrid, not renderBody: the composer changes with the section
        // (its picker disappears inside one), and only renderGrid rebuilds it.
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
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
          if (r && r.error) { ZBXIAsk.alert({ title: 'Section not created', body: r.error.message || 'Could not create that section (is the name already taken?).' }); return; }
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
        ZBXIAsk.confirm({ title: 'Delete section', body: 'Delete the section “' + a.getAttribute('data-alb-nm') + '”?\nIts photos are NOT deleted — they move to Miscellaneous.', ok: 'Delete', danger: true }, function () {
          if (curAlbum === id) curAlbum = 'all';
          Z.albumDelete(id).then(function () { loadAll(); });
        });
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
    var prev = document.getElementById('guPrev');
    var emptyEl = document.getElementById('guEmpty');
    var chosenEl = document.getElementById('guChosen');
    var sizeEl = document.getElementById('guSize');
    function fmtSize(b) {
      return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
    }
    // Object URLs must be released or every re-pick leaks the previous image.
    // The plate has two faces — invitation, or the photo you picked — and exactly
    // one is ever on screen.
    function showPreview(f) {
      if (prev.src) URL.revokeObjectURL(prev.src);
      if (!f) {
        prev.hidden = true; prev.removeAttribute('src');
        chosenEl.hidden = true; emptyEl.hidden = false;
        return;
      }
      prev.src = URL.createObjectURL(f);
      prev.hidden = false;
      nameEl.textContent = f.name;
      sizeEl.textContent = fmtSize(f.size);
      emptyEl.hidden = true; chosenEl.hidden = false;
    }
    /* No click handler here on purpose. #guDrop is a <label> that WRAPS the file
       input, so the browser already forwards a click on it to that input — and
       calling fileIn.click() as well opened the picker TWICE from one click.
       The second dialog appears right after you choose a file, so dismissing it
       lands you back on the page with nothing selected and no preview, which
       reads as "it just doesn't work". Whether the duplicate is suppressed
       depends on the browser's user-activation rules, which is why this hit some
       brothers and not others. Measured: 2 picker activations before, 1 after. */
    /* This limit is about MEMORY, not storage. Every photo is re-encoded to a
       ≤1600px JPEG before it leaves the browser, so a 20MB original and a 2MB one
       both upload at roughly 400KB — the old 5MB gate was turning away camera
       photos and panoramas that would have ended up tiny. What a big file really
       costs is the decode: downscale() paints the whole image into a canvas, and
       ~25MB (50-80 megapixels) is about where an older phone runs out of room and
       the tab dies. Hence 25, and hence the wording below. */
    var MAX_PICK = 25 * 1024 * 1024;
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0];
      if (!f) { showPreview(null); btn.disabled = true; return; }
      if (f.size > MAX_PICK) {
        showPreview(null); st.className = 'form-status err';
        st.textContent = 'That image is too big to process on a phone (max 25MB). Try a smaller version.';
        btn.disabled = true; return;
      }
      st.textContent = ''; st.className = 'form-status'; showPreview(f); btn.disabled = false;
    });
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = fileIn.files[0];
      if (!f) return;
      btn.disabled = true; btn.textContent = 'Posting…';
      // Inside a section there is no picker — the photo goes where you are.
      var albumSel = document.getElementById('guAlbum');
      var albumId = inSection() ? curAlbum
                  : (albumSel && albumSel.value ? albumSel.value : null);   // null -> Miscellaneous
      Z.downscale(f, 1600).then(function (blob) {
        return Z.galleryUpload(me.id, blob, 'jpg');
      }).then(function (path) {
        return Z.galleryCreate({ author_user: me.id, image_path: path, caption: document.getElementById('guCaption').value.trim() || null, album_id: albumId });
      }).then(function (r) {
        if (r.error) throw r.error;
        btn.textContent = 'Post';
        showPreview(null);   // loadAll() rebuilds the uploader; release the URL first
        // Land on the section it went into, so the photo you just posted is the
        // thing you see next — not the sections page you started from.
        curAlbum = albumId || miscId(); view = 'grid';
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

  /* Caption + section line. Its own function because the inline editor rebuilds
     it after a save, and openPost() paints it on the way in. */
  function paintCaption(p) {
    g('caption').textContent = p.caption || '';
    var an = albumName(p);
    g('date').textContent = (an ? an + ' · ' : '') + when(p.created_at);
    g('barsec').textContent = an;          // mobile bar; follows an inline section change
  }

  function closeEdit(p) {
    var box = g('editform');
    box.hidden = true; box.innerHTML = '';
    g('caption').hidden = false;
    paintCaption(p);
  }

  /* Inline edit — caption and section, nothing else. That limit is not a UI
     convention: upgrade41 revoked UPDATE on every other column of gallery_posts,
     so who posted a photo and which image it points at cannot be changed from the
     website at all, by anyone, including a moderator. */
  function openEdit(p) {
    var box = g('editform');
    g('caption').hidden = true;
    box.hidden = false;
    box.innerHTML =
      '<textarea id="geCap" rows="2" maxlength="300" aria-label="Caption" placeholder="Write a caption…"></textarea>' +
      '<div class="gedit-form__row">' +
        (albums.length ? albumPicker('geAlbum', albumOf(p)) : '') +
        '<button class="btn btn--gold" id="geSave" type="button">Save</button>' +
        '<button class="btn btn--ghost" id="geCancel" type="button">Cancel</button>' +
      '</div>' +
      '<p class="form-status" id="geStatus" role="status"></p>';

    // .value, not interpolated into the markup — a caption is user text and must
    // never be parsed as HTML on its way into the form.
    var cap = box.querySelector('#geCap');
    cap.value = p.caption || '';
    cap.focus();

    box.querySelector('#geCancel').onclick = function () { closeEdit(p); };
    box.querySelector('#geSave').onclick = function () {
      var btn = box.querySelector('#geSave');
      var st = box.querySelector('#geStatus');
      var sel = box.querySelector('#geAlbum');
      btn.disabled = true; btn.textContent = 'Saving…';
      st.className = 'form-status'; st.textContent = '';
      Z.galleryUpdate(p.id, cap.value.trim(), sel ? sel.value : null).then(function (r) {
        if (r.error) throw r.error;
        p.caption = r.data.caption; p.album_id = r.data.album_id;
        closeEdit(p);
        renderBody();   // section chips and their counts can both change
      })['catch'](function (err) {
        btn.disabled = false; btn.textContent = 'Save';
        st.className = 'form-status err';
        st.textContent = (err && err.message) || 'Could not save that change.';
      });
    };
  }

  /* The sheet starts closed on every open — the point of this screen is the
     photo. Tapping the grip (or the photo, while it's open) toggles it. */
  function setSheet(open) {
    modal.classList.toggle('gmodal--sheet', !!open);
    var grip = g('grip');
    if (grip) grip.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* iOS Safari refuses requestFullscreen() on anything that is not a <video>,
     and iOS is the device this was reported from — so the immersive class is a
     real fallback, not a nicety. */
  function toggleFull() {
    var pane = modal.querySelector('.gmodal__img');
    var immersive = function () { modal.classList.toggle('gmodal--immersive'); };
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (modal.classList.contains('gmodal--immersive')) { immersive(); return; }
    if (pane.requestFullscreen) {
      setSheet(false);
      var r = pane.requestFullscreen();
      if (r && r['catch']) r['catch'](immersive);
    } else { setSheet(false); immersive(); }
  }

  function openPost(p) {
    g('img').src = urls[p.image_path] || '';
    g('img').alt = p.caption || 'Gallery photo';
    g('author').innerHTML = chip(p.author_user);
    g('barauthor').innerHTML = chip(p.author_user);
    setSheet(false);
    modal.classList.remove('gmodal--immersive');
    g('grip').onclick = function () { setSheet(!modal.classList.contains('gmodal--sheet')); };
    g('full').onclick = toggleFull;
    g('img').onclick = function () { if (modal.classList.contains('gmodal--sheet')) setSheet(false); };
    closeEdit(p);   // paints the caption, and drops a form left open on the last post
    var ed = g('edit');
    ed.style.display = (me && (p.author_user === me.id || canMod)) ? '' : 'none';
    ed.onclick = function () { openEdit(p); };
    var del = g('delete');
    del.style.display = (me && (p.author_user === me.id || canMod)) ? '' : 'none';
    del.onclick = function () {
      ZBXIAsk.confirm({ title: 'Delete photo', body: 'Delete this post?', ok: 'Delete', danger: true }, function () {
        Z.galleryDeletePost(p.id, p.author_user === me.id ? p.image_path : null).then(function () {
          closeModal(); loadAll();
        });
      });
    };
    syncLike(p);
    function onLike() {
      var liked = iLike(p.id);
      var op = liked ? Z.unlikePost(p.id, me.id) : Z.likePost(p.id, me.id);
      // optimistic
      if (liked) likes = likes.filter(function (l) { return !(l.post_id === p.id && l.user_id === me.id); });
      else likes.push({ post_id: p.id, user_id: me.id });
      syncLike(p);
      op.then(function (r) { if (r.error) { Z.galleryLikesAll().then(function (ls) { likes = ls; syncLike(p); }); } });
    }
    g('like').onclick = onLike;
    g('barlike').onclick = onLike;
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
    var html = (iLike(p.id) ? '♥' : '♡') + ' <span>' + likeCount(p.id) + '</span>';
    ['like', 'barlike'].forEach(function (k) {          // side panel + mobile bar
      g(k).innerHTML = html;
      g(k).classList.toggle('on', iLike(p.id));
    });
  }

  function loadComments(p) {
    var box = g('comments');
    box.innerHTML = '<p class="form-note">…</p>';
    Z.galleryComments(p.id).then(function (cs) {
      // The closed sheet shows this line, so you know whether it's worth opening.
      g('ccount').textContent = cs.length
        ? cs.length + (cs.length === 1 ? ' comment' : ' comments')
        : 'No comments yet';
      // gcomments__empty: hidden on mobile, where the count line says this already.
      if (!cs.length) { box.innerHTML = '<p class="form-note gcomments__empty">No comments yet.</p>'; return; }
      box.innerHTML = cs.map(function (c) {
        var mine = me && (c.author_user === me.id || canMod);
        return '<div class="gcomment">' + chip(c.author_user) +
          '<p>' + esc(c.body) + '</p>' +
          '<small>' + when(c.created_at) + (mine ? ' · <a href="#" data-delc="' + esc(c.id) + '">delete</a>' : '') + '</small></div>';
      }).join('');
      box.querySelectorAll('[data-delc]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          Z.deleteComment(a.dataset.delc).then(function () { loadComments(p); });
        };
      });
    });
  }

  function closeModal() {
    // Leave no viewing mode behind, or the next photo opens fullscreen/immersive
    // with a sheet already up.
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    modal.classList.remove('gmodal--immersive');
    setSheet(false);
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
  }
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
      canPost = true;   // being an approved brother IS the permission (upgrade41)
      Promise.all([
        Z.officerCan ? Z.officerCan('gallery.moderate') : Promise.resolve(false),
        Z.officerCan ? Z.officerCan('gallery.albums') : Promise.resolve(false)
      ]).then(function (r) {
        canMod = isAdmin || r[0];
        canAlbums = isAdmin || r[1];
        if (!root.querySelector('.sk')) root.innerHTML = gallerySkeleton();  // unless already painted above
        loadAll().catch(function () {
          root.innerHTML = '<p class="page-empty">Could not load the gallery. Try refreshing.</p>';
        });
      });
    });
  });
})();
