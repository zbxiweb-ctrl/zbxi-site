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
    // The pill already says the section, so the date line stops repeating it.
    g('date').textContent = when(p.created_at);
    // Both pills are painted; CSS shows exactly one (bars are mobile, side is
    // desktop). hidden when a post has no section, so an empty pill never draws.
    ['barsec', 'sidesec'].forEach(function (k) {
      var el = g(k);
      if (!el) return;
      el.textContent = an;
      el.hidden = !an;
    });
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

  /* ---------- the comment sheet: one number, three snaps, one gesture ----------
     This used to be a class toggle, which is why there was no way to drag it and no
     position between "shut" and "wide open". Now a single number — the sheet's
     offset in px — is written to --gy, and everything else (the photo's lift, the
     ♥ bar's position, which classes are on) is derived from it in the same frame.

     Mobile only: above 900px the panel is a static column beside the photo and none
     of this binds, matching the media query that creates the sheet at all. */
  var MOBILE = window.matchMedia('(max-width: 900px)');
  var sheetY = null;                 // px offset; 0 = full, snaps().peek = resting
  var dragging = null;
  var peekPx = null;                 // measured once per open, while at rest

  function sideEl() { return modal.querySelector('.gmodal__side'); }

  // MEASURED ONCE, at rest, and cached. The header is shorter once the sheet is up
  // (the peek preview is hidden then, because the real list is showing), so
  // measuring it live made the snap points MOVE while you were dragging toward
  // them — a release near the bottom snapped to a resting position 30px from where
  // it started. Caught by asserting the settled offsets, not by looking at it.
  // How far the composer may rise before it would start covering the header. Past
  // this the sheet simply isn't tall enough to show both, and the composer must
  // wait below the header rather than climb over the grab handle.
  var compMax = 0;
  var gsafePx = 12;                  // mirrors --gsafe; re-read per open, not per frame

  function measurePeek() {
    var head = g('head'), pk = g('peek'), side = sideEl();
    gsafePx = parseFloat(getComputedStyle(modal).getPropertyValue('--gsafe')) || 12;
    peekPx = (head ? head.offsetHeight : 84) + 14;
    // Header height once OPEN — the peek preview is display:none then.
    var headOpen = (head ? head.offsetHeight : 84) - (pk ? pk.offsetHeight : 30);
    var comp = modal.querySelector('.gcompose');
    var padBottom = side ? parseFloat(getComputedStyle(side).paddingBottom) || 0 : 0;
    compMax = Math.max(0, (side ? side.offsetHeight : 0) - padBottom -
                          (comp ? comp.offsetHeight : 55) - headOpen);
    return peekPx;
  }

  function snaps() {
    var el = sideEl();
    var H = el ? el.offsetHeight : 0;
    var pk = peekPx || measurePeek();
    return { H: H, full: 0, half: Math.round(H * 0.46), peek: Math.max(0, H - pk) };
  }

  /* The photo lifts and shrinks so the comments end up BENEATH it, never under it.
     transform only — animating height would relayout the image every frame. */
  function liftPhoto(visible, barOp) {
    var img = g('img'), pane = img && img.parentNode;
    if (!img || !pane || !img.naturalWidth) return;
    var paneH = pane.clientHeight, paneW = pane.clientWidth;
    if (!paneH) return;
    // object-fit: contain means the ELEMENT box is not the PAINTED box. Using the
    // element box here would shrink the photo far more than the sheet needs.
    var painted = Math.min(paneH, paneW * img.naturalHeight / img.naturalWidth);
    // The usable band is between the author bar and the top of the sheet — NOT the
    // whole pane. Centring in the pane pushed the photo up under the author's name
    // once the sheet was tall.
    var bar = modal.querySelector('.gbar--top');
    var topInset = (bar && bar.offsetHeight ? bar.offsetHeight : 42) + 6;
    // The FLOOR is not the top of the sheet — the ♥ / section bar rides at exactly
    // that line and is ~40px tall, so treating the sheet edge as the floor ran the
    // photo straight underneath it.
    // Weighted by the bar's OWN opacity: near full height the bar has already faded
    // to nothing, and reserving space for an invisible bar squeezed the band so hard
    // that the 80px floor kicked in and pushed the photo up into the author's name
    // instead. Reserve it only while it is actually there to be covered.
    var bbar = modal.querySelector('.gbar--bot');
    var op = barOp == null ? 1 : barOp;
    // The bar's height PLUS the gap it keeps from the sheet PLUS a little air. The
    // gap is read from CSS so the two can't drift apart, and it is what guarantees
    // this holds for a 9:16 portrait as surely as for a panorama — the reserve is
    // computed from the controls, never assumed from the picture.
    var botInset = ((bbar && bbar.offsetHeight ? bbar.offsetHeight : 40) + gsafePx + 8) * op;
    var sheetTop = paneH - visible;
    var floor = sheetTop - botInset;
    // NO minimum on the room and NO floor on the scale. Both used to exist to stop a
    // tall portrait becoming a stamp — but a minimum room is a promise the band
    // cannot keep, and it forced a 9:16 photo 61px up into the author bar and 65px
    // down behind the sheet at full height. The band is whatever is actually left;
    // the photo fits inside it or it is not drawn. That is what makes this hold for
    // EVERY aspect ratio rather than the ones that happened to be tested.
    var room = Math.max(0, floor - topInset - 12);
    // Never above 1 either way: scaling a photo up is just blur.
    var scale = Math.min(1, painted > 0 ? room / painted : 1);
    img.style.setProperty('--gph-s', scale.toFixed(4));
    img.style.setProperty('--gph-y', Math.round((topInset + floor) / 2 - paneH / 2) + 'px');
  }

  function paintSheet(y) {
    var s = snaps();
    if (!s.H) return;
    y = Math.max(0, Math.min(y, s.peek));
    sheetY = y;
    var visible = s.H - y;
    modal.style.setProperty('--gy', y + 'px');
    modal.style.setProperty('--gvis', visible + 'px');
    var open = y < s.peek - 2;
    modal.classList.toggle('gmodal--sheet', open);
    // The ♥/section bar rides the sheet up and only fades over the last stretch,
    // where it would otherwise be buried behind it.
    var op = y >= s.half ? 1 : Math.max(0, y / Math.max(1, s.half));
    modal.style.setProperty('--gbar-op', op.toFixed(3));
    modal.classList.toggle('gmodal--covered', op < 0.06);
    // Dock the composer, but never far enough to climb over the header.
    modal.style.setProperty('--gcy', Math.min(y, compMax) + 'px');
    liftPhoto(visible, op);
    var grip = g('grip');
    if (grip) grip.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function settle(y) {
    modal.classList.remove('gmodal--dragging');
    paintSheet(y);
  }

  // A flick beats position: a short fast pull upward should fling open rather than
  // fall back because the finger didn't travel far enough.
  function targetFor(y, vy, s) {
    var pts = [s.full, s.half, s.peek];
    if (Math.abs(vy) > 0.5) {
      var up = vy < 0;
      var ahead = pts.filter(function (p) { return up ? p < y - 1 : p > y + 1; });
      if (ahead.length) return up ? Math.max.apply(null, ahead) : Math.min.apply(null, ahead);
    }
    return pts.reduce(function (a, b) { return Math.abs(b - y) < Math.abs(a - y) ? b : a; });
  }

  function setSheet(open) {
    if (!MOBILE.matches) return;
    var s = snaps();
    settle(open ? s.half : s.peek);
  }

  // Tap cycles forward: resting -> half -> full -> resting. One rule for the grip,
  // the count and the peek preview, so a tap is never a dead end and the sheet is
  // fully reachable without a gesture (keyboard included).
  function cycleSheet() {
    var s = snaps();
    var y = sheetY == null ? s.peek : sheetY;
    settle(y > s.half + 2 ? s.half : (y > s.full + 2 ? s.full : s.peek));
  }

  function beginDrag(e, fromList) {
    if (!MOBILE.matches) return;
    // Fullscreen and immersive both drive this same transform; the drag must stand
    // down while they own it.
    if (modal.classList.contains('gmodal--immersive') || document.fullscreenElement) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var s = snaps();
    if (!s.H) return;
    dragging = {
      id: e.pointerId, y0: e.clientY, start: sheetY == null ? s.peek : sheetY,
      lastY: e.clientY, lastT: e.timeStamp, vy: 0, live: false, fromList: !!fromList, s: s
    };
  }

  function moveDrag(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    var dy = e.clientY - dragging.y0;
    if (!dragging.live) {
      if (Math.abs(dy) < 4) return;                       // not a drag yet
      // Started inside the comment list: it only becomes a sheet drag when the list
      // is already at its top AND the pull is downward. Otherwise it is a scroll and
      // we get out of the way entirely.
      if (dragging.fromList) {
        var list = g('comments');
        if (dy < 0 || (list && list.scrollTop > 0)) { dragging = null; return; }
      }
      dragging.live = true;
      modal.classList.add('gmodal--dragging');
      try { e.target.setPointerCapture(dragging.id); } catch (err) {}
    }
    var dt = e.timeStamp - dragging.lastT;
    if (dt > 0) dragging.vy = (e.clientY - dragging.lastY) / dt;   // px per ms, last sample
    dragging.lastY = e.clientY; dragging.lastT = e.timeStamp;

    var y = dragging.start + dy;
    // Rubber band past fully-open, so hitting the top feels like a limit rather
    // than a wall the sheet is stuck against.
    if (y < 0) y = y / 3;
    paintSheet(y);
    if (e.cancelable) e.preventDefault();
  }

  // A real drag is followed by a click on whatever the finger started on. The grip,
  // the count and the peek preview are all tap targets AND drag surfaces, so that
  // click ran cycleSheet() and yanked the sheet to a different snap right after it
  // had settled — which is what made dragging from anywhere but the bar feel
  // erratic. Swallow the tap for a moment after a drag ends.
  var dragEndedAt = 0;
  function tapCycle() {
    if (Date.now() - dragEndedAt < 350) return;
    cycleSheet();
  }

  function endDrag(e) {
    if (!dragging || (e && e.pointerId !== dragging.id)) return;
    var d = dragging; dragging = null;
    if (!d.live) return;                                   // it was a tap; let click run
    dragEndedAt = Date.now();
    settle(targetFor(sheetY, d.vy, snaps()));
  }

  /* THE WHOLE SHEET IS THE HANDLE. It used to be bound to the header only, so in
     practice you were aiming at a 42px bar every time — inconsistent and annoying,
     exactly as reported. One listener on the panel catches the grip, the count, the
     preview, the caption, the actions row and all the padding between them.
     Two exceptions, both deliberate:
       .gcompose  — tapping there means "I want to type", never "drag the sheet".
       .gcomments — a drag there is a scroll, unless the list is already at its top
                    and you are pulling DOWN (handled in moveDrag). */
  function wireSheetDrag() {
    var side = sideEl();
    if (!side || side._dragBound) return;
    side._dragBound = true;
    side.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.gcompose')) return;
      beginDrag(e, !!(e.target.closest && e.target.closest('.gcomments')));
    });
  }
  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  // The sheet's height is a percentage of the viewport, so every snap moves when the
  // viewport does. Re-measure rather than leave the sheet at a stale offset.
  window.addEventListener('resize', function () {
    if (!modal.classList.contains('open') || sheetY == null) return;
    var was = snaps();
    // Which snap were we resting on? Decide BEFORE re-measuring, then re-measure and
    // land on the same one at its new position.
    var at = sheetY < was.half / 2 ? 'full' : (sheetY < was.peek - 2 ? 'half' : 'peek');
    peekPx = null;
    var s = snaps();
    paintSheet(s[at]);
  });

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
    modal.classList.remove('gmodal--immersive');
    g('grip').onclick = tapCycle;
    g('full').onclick = toggleFull;
    g('img').onclick = function () { if (modal.classList.contains('gmodal--sheet')) setSheet(false); };
    // The photo can't be positioned against the sheet until its intrinsic size is
    // known — object-fit: contain makes the painted box depend on naturalWidth.
    g('img').onload = function () { if (sheetY != null) paintSheet(sheetY); };
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
    // The count line is the one-tap way in on a phone: it opens the sheet, which
    // now arrives with the comment list and the composer both already in view.
    // It deliberately does NOT focus the input — landing with the keyboard up is
    // the complaint that drove the previous redesign.
    g('ccount').onclick = tapCycle;
    g('peek').onclick = tapCycle;
    var form = g('composeForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var input = g('composeInput');
      var body = input.value.trim();
      if (!body) { input.focus(); return; }
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      // His text is NOT cleared until the row is actually in the database. It used
      // to be cleared first, with no error branch at all, so a refused or dropped
      // comment took his words with it and said nothing.
      Z.addComment(p.id, me.id, body).then(function (r) {
        if (r && r.error) throw r.error;
        if (!r || !r.data || !r.data.length) throw new Error('The server would not accept that comment.');
        input.value = '';
        btn.disabled = false;
        loadComments(p);
      })['catch'](function (err) {
        btn.disabled = false;
        ZBXIAsk.alert({ title: 'Comment not posted', body: (err && err.message) || 'Try again.' });
      });
    };
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    // Freeze the page underneath. Without this, scrolling past the end of the
    // comments drags the gallery grid behind the photo, and closing the viewer
    // drops you somewhere other than where you tapped. profile-card.js has done
    // this since it shipped; the viewer never did.
    lockPage();
    // Only now does the sheet have a height to measure — before .open it is display:none.
    wireSheetDrag();
    resetSheet();
  }

  /* Freeze the page behind the viewer. overflow:hidden alone leaves iOS Safari free
     to keep scrolling the document, which is exactly what was fighting the sheet
     drag. position:fixed stops it dead; `top` holds the place so releasing it does
     not jump the gallery back to the top. */
  var pageScrollY = 0;
  function lockPage() {
    pageScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    document.body.style.top = (-pageScrollY) + 'px';
    document.body.classList.add('modal-open', 'modal-locked');
  }
  function unlockPage() {
    if (!document.body.classList.contains('modal-locked')) return;
    document.body.classList.remove('modal-open', 'modal-locked');
    document.body.style.top = '';
    // Restore instantly: html{scroll-behavior:smooth} would otherwise animate the
    // page back, which looks like the site lurching after you close a photo.
    var h = document.documentElement, prev = h.style.scrollBehavior;
    h.style.scrollBehavior = 'auto';
    void getComputedStyle(h).scrollBehavior;
    window.scrollTo(0, pageScrollY);
    h.style.scrollBehavior = prev;
  }

  function resetSheet() {
    if (!MOBILE.matches) return;
    sheetY = null; peekPx = null;
    modal.classList.remove('gmodal--sheet', 'gmodal--covered', 'gmodal--dragging');
    // Measure the peek in the resting state — sheet closed, preview visible — then
    // hold that number for the life of this photo.
    requestAnimationFrame(function () { measurePeek(); paintSheet(snaps().peek); });
  }

  function syncLike(p) {
    var html = (iLike(p.id) ? '♥' : '♡') + ' <span>' + likeCount(p.id) + '</span>';
    ['like', 'barlike'].forEach(function (k) {          // side panel + mobile bar
      g(k).innerHTML = html;
      g(k).classList.toggle('on', iLike(p.id));
    });
  }

  /* ---------- comments ----------
     cgen guards every paint. Opening photo B while A's request is still in flight
     must not let A's comments — or A's count — land on B. The count was the worse
     half: it was written in exactly one place, inside the success callback, and
     nothing ever reset it, so a photo with no comments displayed the previous
     photo's "3 comments" for the whole round trip. On a phone that line is the
     ONLY comment signal while the sheet is closed. */
  var cgen = 0;

  function shortWhen(ts) { return when(ts).replace(' ago', ''); }

  function avatarOf(uid) {
    var a = author(uid);
    return a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="">' :
      '<span>' + esc(String(a.full_name || 'Ζ').trim()[0] || 'Ζ') + '</span>';
  }

  function countLabel(n) {
    return n === 0 ? 'No comments yet' : n + (n === 1 ? ' comment' : ' comments');
  }

  function commentRow(c) {
    var mine = me && (c.author_user === me.id || canMod);
    return '<li class="gcomment">' +
        '<i class="gcomment__av">' + avatarOf(c.author_user) + '</i>' +
        '<div class="gcomment__main">' +
          '<div class="gcomment__head">' +
            '<b class="gcomment__who">' + esc(author(c.author_user).full_name) + '</b>' +
            '<time class="gcomment__when">' + esc(shortWhen(c.created_at)) + '</time>' +
            (mine ? '<button type="button" class="gcomment__x" data-delc="' + esc(c.id) +
                    '" aria-label="Delete your comment" title="Delete this comment">✕</button>' : '') +
          '</div>' +
          // Newlines survive, matching board replies. A multi-line comment used to
          // collapse into one run-on line. After esc(), never before.
          '<p class="gcomment__text">' + esc(c.body).replace(/\n/g, '<br>') + '</p>' +
        '</div>' +
      '</li>';
  }

  /* What the closed sheet shows: the newest comment, one line. The resting peek
     used to be a grip and the bare words "1 comment" in an empty block — nothing
     to read, and no hint there was anything behind it. */
  function renderPeek(cs) {
    var box = g('peek');
    if (!box) return;
    if (!cs || !cs.length) {
      box.className = 'gpeek gpeek--empty';
      box.textContent = 'Be the first to say something.';
      return;
    }
    var c = cs[cs.length - 1];            // newest; the list arrives oldest first
    var name = String(author(c.author_user).full_name || 'A brother').trim().split(' ')[0];
    box.className = 'gpeek';
    box.innerHTML = '<i class="gpeek__av">' + avatarOf(c.author_user) + '</i>' +
      '<b class="gpeek__who">' + esc(name) + '</b>' +
      '<span class="gpeek__text">' + esc(String(c.body).replace(/\s+/g, ' ')) + '</span>';
  }

  function loadComments(p) {
    var box = g('comments'), gen = ++cgen;
    box.innerHTML = '<p class="gcomments__note">Loading…</p>';
    g('ccount').textContent = '…';        // never let the previous photo's count stand
    renderPeek(null);
    Z.galleryComments(p.id).then(function (cs) {
      if (gen !== cgen) return;           // a newer photo won the race
      g('ccount').textContent = countLabel(cs.length);
      renderPeek(cs);
      if (!cs.length) {
        box.innerHTML = '<p class="gcomments__empty">Nothing said yet — be the first.</p>';
        return;
      }
      box.innerHTML = '<ul class="gcomment-list">' + cs.map(commentRow).join('') + '</ul>';
      box.querySelectorAll('[data-delc]').forEach(function (b) {
        b.onclick = function () { removeComment(p, b.dataset.delc, b); };
      });
    })['catch'](function () {
      if (gen !== cgen) return;
      // A failure must NEVER read as "No comments yet" — that states as fact that
      // nobody wrote anything. galleryComments now throws instead of returning [].
      g('ccount').textContent = 'Comments unavailable';
      var pk = g('peek');
      if (pk) { pk.className = 'gpeek gpeek--empty'; pk.textContent = 'Couldn’t load comments.'; }
      box.innerHTML = '<p class="gcomments__err">Couldn’t load the comments. ' +
        '<button type="button" class="gcomments__retry">Retry</button></p>';
      box.querySelector('.gcomments__retry').onclick = function () { loadComments(p); };
    });
  }

  function removeComment(p, id, btn) {
    btn.disabled = true;
    Z.deleteComment(id).then(function (r) {
      if (r && r.error) throw r.error;
      // Zero rows back = RLS declined without raising. Silently doing nothing is
      // how a control earns a bug report.
      if (!r || !r.data || !r.data.length) throw new Error('You can only delete your own comments.');
      loadComments(p);
    })['catch'](function (err) {
      btn.disabled = false;
      ZBXIAsk.alert({ title: 'Could not delete', body: (err && err.message) || 'Try again.' });
    });
  }

  function closeModal() {
    // Leave no viewing mode behind, or the next photo opens fullscreen/immersive
    // with a sheet already up.
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    modal.classList.remove('gmodal--immersive');
    setSheet(false);
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
    unlockPage();                                   // give the page its scroll back
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
