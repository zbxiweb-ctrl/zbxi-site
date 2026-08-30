/* Private brothers-only gallery: Instagram-style grid + post modal with
   likes and comments. Everything is RLS-gated server-side; this script also
   gates the UI. Renders into #galleryRoot. */
(function () {
  'use strict';
  var root = document.getElementById('galleryRoot');
  if (!root) return;
  var Z = window.ZBXI;

  var esc = ZBXIUtil.esc;
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
      (needSignin ? '<a class="btn btn--gold" href="' + ZBXIUtil.signInHref() + '">Log In / Sign Up</a>' : '') +
      '</div>';
  }

  if (!Z || !Z.configured) { locked('Members only', true); return; }

  // canPost = may create a post: EVERY approved brother, since upgrade41. canMod =
  // may edit or delete anyone else's post/comment: the admin, OR a President whose
  // seat has gallery.moderate switched on. The DB enforces both (the gallery
  // insert/update/delete policies); these flags only shape the UI.
  var me = null, dir = {}, posts = [], likes = [], urls = {}, isAdmin = false, canMod = false, canPost = false;
  // view: 'sections' = the cover-card front door, 'grid' = one section's photos,
  // 'tagged' = every photo one brother appears in (?tagged=<brother id>).
  var albums = [], curAlbum = 'all', canAlbums = false, manageOpen = false, view = 'sections';
  // upgrade60: who is in which photo, the roster to tag against (all 359 verified
  // brothers, not just the 113 with accounts), and my own roster id — which is what
  // decides whether I may take MY OWN name off a photo.
  var tags = [], roster = [], myBrotherId = null, taggedId = null, decade = 'all';
  // ?class=<pledge class> — every photo anyone from that class is tagged in.
  var taggedClass = null;
  // Not a technical limit: 30 is about how long a brother will watch a progress line
  // before deciding the site has hung. The per-file 25MB memory guard is the real one.
  var MAX_BATCH = 30;
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

  /* ---------- when was it taken (upgrade60) ----------
     A YEAR, not a date. Nobody knows the day a 1997 formal was shot, and "3d ago"
     already answers it for anything recent. The list starts blank and runs newest
     first, because most photos posted are recent ones. */
  var YEAR_MIN = ZBXIUtil.foundingYear();   // the chapter's founding
  function yearPicker(id, sel) {
    var now = new Date().getFullYear(), out = '';
    for (var y = now; y >= YEAR_MIN; y--) {
      out += '<option value="' + y + '"' + (Number(sel) === y ? ' selected' : '') + '>' + y + '</option>';
    }
    return '<select class="zselect gupload__year" id="' + id + '" aria-label="Year the photo was taken">' +
      '<option value="">Year taken…</option>' + out + '</select>';
  }
  function decadeOf(p) { return p.taken_year ? Math.floor(p.taken_year / 10) * 10 : null; }

  /* ---------- who is in the photo (upgrade60) ---------- */
  function tagsFor(pid) { return tags.filter(function (t) { return t.post_id === pid; }); }
  function rosterName(bid) {
    var b = roster.filter(function (x) { return x.id === bid; })[0];
    return b ? b.full_name : 'A brother';
  }
  // Mirrors the gtags_remove policy. The database is the real gate — this only
  // decides whether to OFFER the ✕, so a brother is never shown a control that
  // would be refused.
  function canUntag(t, p) {
    if (!me) return false;
    return t.tagged_by === me.id || canMod || (p && p.author_user === me.id) ||
           (myBrotherId && t.brother_id === myBrotherId);
  }

  /* ---------- grid ---------- */
  // Shared by the composer (defaults to Miscellaneous) and the inline post editor
  // (defaults to the post's own section), so the two controls stay identical.
  function albumPicker(id, selId) {
    return '<select class="zselect gupload__album" id="' + id + '" aria-label="Section">' +
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
              '<b>Share photos with the brotherhood</b>' +
              '<span class="gupload__hint">JPG, PNG or HEIC · up to 25MB each · pick as many as ' + MAX_BATCH + ' at once</span>' +
            '</span>' +
            // alt="" on purpose: the filename sits right below it, and an empty
            // alt means a src-less <img> can never paint alt text in a broken
            // frame again — which is what the old "Preview of the photo you
            // chose" box was.
            '<span class="gupload__chosen" id="guChosen" hidden>' +
              '<img id="guPrev" class="gupload__prev" alt="">' +
              '<span class="gupload__meta"><b id="guName"></b><span id="guSize"></span></span>' +
              '<span class="gupload__change">Choose different photos</span>' +
            '</span>' +
            // A strip of thumbnails for a batch — one preview cannot represent twelve
            // photos, and "12 files" with no picture is a number you have to trust.
            '<span class="gupload__strip" id="guStrip" hidden></span>' +
            '<input type="file" id="guFile" accept="image/*" multiple hidden></label>' +
          // Inside a section the destination is already decided, so the picker
          // asks a question you just answered. State it instead. On "All photos"
          // (and on the sections page) nothing is implied, so it still has to ask.
          (inSection()
            ? '<p class="gupload__dest">Posting to <b>' + esc(curSecName()) + '</b></p>'
            : '') +
          '<div class="gupload__row">' +
            (!inSection() && albums.length ? albumPicker('guAlbum', miscId()) : '') +
            yearPicker('guYear', '') +
            '<input id="guCaption" aria-label="Photo caption" placeholder="Write a caption…" maxlength="300">' +
            // One caption for the whole batch, and it says so once several are picked.
            // Forty individual captions is a form, not a composer, and nobody fills it in.
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
    // The tagged view names the brother instead of the section — it is a different
    // question ("where does he appear?"), and the section he happens to be filed
    // under is not the answer.
    if (view === 'tagged') {
      var n2 = basePosts().length;
      var who = taggedClass ? taggedClass : rosterName(taggedId);
      return '<div class="gsechead"><h2>Photos of ' + esc(who) + '</h2>' +
        '<span>' + (n2 === 0 ? 'None yet' : n2 + (n2 === 1 ? ' photo' : ' photos')) + '</span></div>';
    }
    var n = postsIn(curAlbum).length;
    return '<div class="gsechead"><h2>' + esc(curSecName()) + '</h2>' +
      '<span>' + (n === 0 ? 'No photos yet' : n + (n === 1 ? ' photo' : ' photos')) + '</span></div>';
  }

  /* The photos this view is about, BEFORE the decade filter. One function so the
     chips count the same set the grid draws. */
  // Everyone the current 'tagged' view is about: one brother, or a whole pledge class.
  // The class is resolved from the roster already in memory — no query, and a short URL
  // instead of twenty ids.
  function taggedIds() {
    if (taggedClass) {
      return roster.filter(function (b) { return (b.pledge_class || '') === taggedClass; })
                   .map(function (b) { return b.id; });
    }
    return taggedId ? [taggedId] : [];
  }
  function basePosts() {
    if (view === 'tagged') {
      var who = taggedIds();
      var mine = tags.filter(function (t) { return who.indexOf(t.brother_id) !== -1; })
                     .map(function (t) { return t.post_id; });
      return posts.filter(function (p) { return mine.indexOf(p.id) !== -1; });
    }
    return curAlbum === 'all' ? posts : posts.filter(function (p) { return albumOf(p) === curAlbum; });
  }

  /* Decade chips. They appear ONLY when they would do something — a section whose
     photos are all from one decade gets no row, because a filter with one option is
     furniture. "Undated" is offered as its own chip rather than hidden: on a wall of
     dated photos, the ones nobody has dated yet are exactly what you want to find. */
  function decadeChipsHtml(base) {
    var ds = [], undated = false;
    base.forEach(function (p) {
      var d = decadeOf(p);
      if (d == null) { undated = true; return; }
      if (ds.indexOf(d) === -1) ds.push(d);
    });
    if (!ds.length || ds.length + (undated ? 1 : 0) < 2) return '';
    ds.sort(function (a, b) { return b - a; });
    var chip = function (val, label, n) {
      return '<button class="gdec' + (decade === val ? ' on' : '') + '" data-dec="' + val + '"' +
        ' aria-pressed="' + (decade === val) + '">' +
        label + ' <i>' + n + '</i></button>';
    };
    var html = chip('all', 'All', base.length);
    ds.forEach(function (d) {
      html += chip(String(d), d + 's', base.filter(function (p) { return decadeOf(p) === d; }).length);
    });
    if (undated) html += chip('none', 'Undated', base.filter(function (p) { return decadeOf(p) == null; }).length);
    return '<div class="gdecs" role="group" aria-label="Filter by decade">' + html + '</div>';
  }

  function applyDecade(base) {
    if (decade === 'all') return base;
    if (decade === 'none') return base.filter(function (p) { return decadeOf(p) == null; });
    return base.filter(function (p) { return decadeOf(p) === Number(decade); });
  }

  function gridHtml() {
    var base = basePosts();
    var shown = applyDecade(base);
    if (!shown.length) {
      // The empty state carries the feature. Tagging is days old, so "Photos of my
      // pledge class" will legitimately be empty for a while — it has to read as an
      // invitation to tag rather than as a broken page.
      return decadeChipsHtml(base) + '<p class="page-empty">' + (
        decade !== 'all' ? 'No photos from that decade in here yet.'
        : view === 'tagged' && taggedClass
          ? esc('No photos of ' + taggedClass + ' tagged yet.') +
            ' Open a photo, press <b>＋ Tag someone</b>, and everyone you name shows up here.'
        : view === 'tagged' ? 'No photos of him yet — tag him in one and it lands here.'
        : curAlbum === 'all' ? 'No posts yet — be the first to share a memory.'
        : 'No photos in this section yet.') + '</p>';
    }
    return decadeChipsHtml(base) + '<div class="ggrid">' + shown.map(function (p) {
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
    if (back) back.addEventListener('click', function () {
      // Leaving a view clears its filter. Carrying a decade (or one brother) back
      // to the sections page would silently hide photos on the next section opened.
      view = 'sections'; decade = 'all'; taggedId = null; taggedClass = null;
      if (location.search) history.replaceState(null, '', location.pathname);
      renderGrid();
    });
    body.querySelectorAll('[data-dec]').forEach(function (b) {
      b.addEventListener('click', function () { decade = b.dataset.dec; renderBody(); });
    });
    body.querySelectorAll('[data-sec]').forEach(function (c) {
      c.addEventListener('click', function () {
        curAlbum = c.dataset.sec; view = 'grid'; decade = 'all';
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

  /* The batch's closing summary, carried ACROSS the reload.
     Found by running a real batch on the live site: finishing calls loadAll(), which
     rebuilds the whole composer — including the status line — so "2 posted · 1 could
     not be" was written and then destroyed a moment later. A brother would have been
     told nothing at all about the photo that failed. Stashed here, painted by
     wireUpload() when the fresh composer appears, then cleared. */
  var afterUploadMsg = null;

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
    var stripEl = document.getElementById('guStrip');
    // Paint anything the previous batch had to say, now that a fresh status line exists.
    if (afterUploadMsg) {
      st.className = 'form-status' + (afterUploadMsg.bad ? ' err' : ' ok');
      st.textContent = afterUploadMsg.text;
      afterUploadMsg = null;
    }
    // Every object URL made here has to be released, or picking a new batch leaks the
    // last one. `made` is the whole list, including the strip's, so one call clears
    // all of them rather than just the single preview the old code tracked.
    var made = [];
    function releaseUrls() {
      made.forEach(function (u) { URL.revokeObjectURL(u); });
      made = [];
    }
    function objUrl(f) { var u = URL.createObjectURL(f); made.push(u); return u; }

    // The plate has three faces now — invitation, one photo, or a batch — and exactly
    // one is ever on screen.
    function showPreview(list) {
      releaseUrls();
      prev.removeAttribute('src');
      stripEl.innerHTML = '';
      if (!list || !list.length) {
        prev.hidden = true; chosenEl.hidden = true; stripEl.hidden = true; emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;
      if (list.length === 1) {
        stripEl.hidden = true;
        prev.src = objUrl(list[0]);
        prev.hidden = false;
        nameEl.textContent = list[0].name;
        sizeEl.textContent = fmtSize(list[0].size);
        chosenEl.hidden = false;
        return;
      }
      // A batch: a contact sheet, not a filename. Twelve thumbnails say what
      // "12 files selected" cannot.
      chosenEl.hidden = true;
      stripEl.hidden = false;
      var total = list.reduce(function (n, f) { return n + f.size; }, 0);
      stripEl.innerHTML =
        '<span class="gupload__stripn"><b>' + list.length + ' photos ready</b>' +
        '<span>' + fmtSize(total) + ' · one caption, one section and one year for all of them</span>' +
        '<span class="gupload__change">Choose different photos</span></span>' +
        '<span class="gupload__thumbs">' +
          list.slice(0, 12).map(function (f) {
            return '<img src="' + esc(objUrl(f)) + '" alt="">';
          }).join('') +
          (list.length > 12 ? '<span class="gupload__more">+' + (list.length - 12) + '</span>' : '') +
        '</span>';
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
    // The files that will actually be posted, after the too-big ones are dropped.
    var picked = [];
    fileIn.addEventListener('change', function () {
      var all = Array.prototype.slice.call(fileIn.files || []);
      st.textContent = ''; st.className = 'form-status';
      if (!all.length) { picked = []; showPreview(null); btn.disabled = true; return; }

      // Drop the oversized ones HERE rather than mid-batch, so the count on screen is
      // the count that will be posted and nobody watches "12" become 10 at the end.
      var tooBig = all.filter(function (f) { return f.size > MAX_PICK; });
      picked = all.filter(function (f) { return f.size <= MAX_PICK; });

      var over = 0;
      if (picked.length > MAX_BATCH) { over = picked.length - MAX_BATCH; picked = picked.slice(0, MAX_BATCH); }

      var notes = [];
      if (tooBig.length) {
        notes.push(tooBig.length === 1
          ? '1 photo is too big to process on a phone (max 25MB) and was left out'
          : tooBig.length + ' photos are too big to process on a phone (max 25MB) and were left out');
      }
      if (over) notes.push('only the first ' + MAX_BATCH + ' are taken — post the rest in a second batch');
      if (notes.length) { st.className = 'form-status err'; st.textContent = notes.join(' · ') + '.'; }

      showPreview(picked);
      btn.disabled = !picked.length;
      btn.textContent = picked.length > 1 ? 'Post ' + picked.length + ' photos' : 'Post';
    });
    form.onsubmit = function (e) {
      e.preventDefault();
      if (!picked.length) return;
      btn.disabled = true;
      // Inside a section there is no picker — the photos go where you are.
      var albumSel = document.getElementById('guAlbum');
      var albumId = inSection() ? curAlbum
                  : (albumSel && albumSel.value ? albumSel.value : null);   // null -> Miscellaneous
      var yearSel = document.getElementById('guYear');
      var takenYear = yearSel && yearSel.value ? parseInt(yearSel.value, 10) : null;
      var caption = document.getElementById('guCaption').value.trim() || null;
      var batch = picked.slice();
      var done = 0, failed = [];

      /* ONE AT A TIME, on purpose. Each photo is signed for upload individually, and
         forty parallel round-trips would be a worse citizen for no gain — the browser
         would queue them anyway. Sequential also means the counter below is honest. */
      function step(i) {
        if (i >= batch.length) return finish();
        var f = batch[i];
        btn.textContent = batch.length > 1 ? 'Posting ' + (i + 1) + ' of ' + batch.length + '…' : 'Posting…';
        return Z.downscale(f, 1600)
          .then(function (blob) { return Z.galleryUpload(me.id, blob, 'jpg'); })
          .then(function (path) {
            return Z.galleryCreate({ author_user: me.id, image_path: path, caption: caption,
                                     album_id: albumId, taken_year: takenYear });
          })
          .then(function (r) {
            if (r.error) throw r.error;
            done++;
          })
          ['catch'](function (err) {
            // ONE BAD PHOTO MUST NOT SINK THE BATCH. A brother who picked forty
            // scans is not going to work out which one failed and start again — so
            // the rest go up and the names of the failures are reported at the end.
            failed.push(f.name + (err && err.message ? ' (' + err.message + ')' : ''));
          })
          .then(function () { return step(i + 1); });
      }

      function finish() {
        btn.textContent = 'Post';
        if (!done) {
          st.className = 'form-status err';
          st.textContent = failed.length === 1
            ? 'That photo could not be posted: ' + failed[0]
            : 'None of those photos could be posted. ' + failed[0];
          btn.disabled = false;
          return;
        }
        // Stashed rather than written: loadAll() below rebuilds this very element, so
        // anything set here is destroyed a moment later. wireUpload() paints it onto the
        // fresh composer instead.
        if (failed.length) {
          afterUploadMsg = { bad: true,
            text: '✓ ' + done + ' posted · ' + failed.length + ' could not be: ' + failed.join('; ') };
        } else if (batch.length > 1) {
          afterUploadMsg = { bad: false, text: '✓ All ' + done + ' photos posted.' };
        }
        picked = [];
        showPreview(null);   // loadAll() rebuilds the uploader; release the URLs first
        // Land on the section they went into, so what you just posted is what you see
        // next — not the sections page you started from.
        curAlbum = albumId || miscId(); view = 'grid';
        return loadAll();
      }

      step(0);
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
    // When the photo carries a year, that comes FIRST: on a 1997 photo "posted 3d
    // ago" is the least interesting fact about it, and reading it first is exactly
    // the confusion this feature exists to remove.
    g('date').textContent = (p.taken_year ? '📅 ' + p.taken_year + ' · posted ' : '') + when(p.created_at);
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

  /* ---------- "In this photo" ----------------------------------------------------
     Names, not faces: no boxes to drag, nothing to line up on a phone. A chip opens
     that brother's profile card — including for the 246 men with no account, whose
     card says "in the family tree, hasn't created an account yet". That is the point
     of tagging against the roster rather than against accounts. */
  function paintTags(p) {
    var box = g('tags');
    if (!box) return;
    var mine = tagsFor(p.id);
    // Nothing to show and nothing to do -> draw nothing at all.
    if (!mine.length && !me) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var chips = mine.map(function (t) {
      return '<span class="gtag"><button type="button" class="gtag__name" data-tagopen="' + esc(t.brother_id) + '">' +
        esc(rosterName(t.brother_id)) + '</button>' +
        (canUntag(t, p) ? '<button type="button" class="gtag__x" data-taguntag="' + esc(t.brother_id) +
          '" aria-label="' + esc('Remove ' + rosterName(t.brother_id) + ' from this photo') + '">✕</button>' : '') +
        '</span>';
    }).join('');
    box.innerHTML =
      '<div class="gtags__row">' +
        '<span class="gtags__lbl">' + (mine.length ? '👥 In this photo' : '👥 Nobody tagged yet') + '</span>' +
        chips +
        (me ? '<button type="button" class="gtag gtag--add" data-tagadd>＋ Tag someone</button>' : '') +
      '</div>' +
      '<div class="gtagpick" data-tagpick hidden></div>' +
      '<p class="form-status" data-tagstatus role="status"></p>';

    box.querySelectorAll('[data-tagopen]').forEach(function (b) {
      b.onclick = function () { openBrother(b.dataset.tagopen); };
    });
    box.querySelectorAll('[data-taguntag]').forEach(function (b) {
      b.onclick = function () { removeTag(p, b.dataset.taguntag, box); };
    });
    var add = box.querySelector('[data-tagadd]');
    if (add) add.onclick = function () { openTagPicker(p, box); };
  }

  /* The picker. Types over the whole verified roster — 359 names, already in memory
     from the family tree — and shows the ten best matches, because a 359-row list on
     a phone is not a picker. Already-tagged men are filtered out rather than shown
     and refused. */
  function openTagPicker(p, box) {
    var pick = box.querySelector('[data-tagpick]');
    if (!pick) return;
    if (!pick.hidden) { pick.hidden = true; pick.innerHTML = ''; return; }
    pick.hidden = false;
    pick.innerHTML = '<input class="gtagpick__in" type="search" placeholder="Type a brother\'s name…" ' +
      'aria-label="Search brothers to tag" autocomplete="off"><div class="gtagpick__list"></div>';
    var input = pick.querySelector('.gtagpick__in');
    var list = pick.querySelector('.gtagpick__list');
    function draw() {
      var q = input.value.trim().toLowerCase();
      var taken = tagsFor(p.id).map(function (t) { return t.brother_id; });
      var hits = roster.filter(function (b) {
        return taken.indexOf(b.id) === -1 && (!q || b.full_name.toLowerCase().indexOf(q) !== -1);
      }).slice(0, 10);
      list.innerHTML = hits.length
        ? hits.map(function (b) {
            return '<button type="button" class="gtagpick__hit" data-pickid="' + esc(b.id) + '">' +
              esc(b.full_name) + (b.pledge_class ? '<i>' + esc(b.pledge_class) + '</i>' : '') + '</button>';
          }).join('')
        : '<p class="gtagpick__none">No brother by that name on the roster.</p>';
      list.querySelectorAll('[data-pickid]').forEach(function (h) {
        h.onclick = function () { addTag(p, h.dataset.pickid, box); };
      });
    }
    input.addEventListener('input', draw);
    draw();
    input.focus();
  }

  function tagSay(box, msg, bad) {
    var st = box.querySelector('[data-tagstatus]');
    if (!st) return;
    st.className = 'form-status' + (bad ? ' err' : '');
    st.textContent = msg || '';
  }

  function addTag(p, brotherId, box) {
    tagSay(box, '');
    Z.galleryTagAdd(p.id, brotherId, me.id).then(function (r) {
      if (r.error) throw r.error;
      tags.push({ post_id: p.id, brother_id: brotherId, tagged_by: me.id });
      paintTags(p);
    })['catch'](function (err) {
      tagSay(box, (err && err.message) || 'Could not add that tag.', true);
    });
  }

  function removeTag(p, brotherId, box) {
    tagSay(box, '');
    Z.galleryTagRemove(p.id, brotherId).then(function (r) {
      if (r.error) throw r.error;
      // Zero rows back means RLS declined without raising — the same silent refusal
      // that removeComment() already guards against. Say so rather than appearing
      // to work and reverting on the next reload.
      if (!r.data || !r.data.length) throw new Error('You can only remove a tag you added, or your own name.');
      tags = tags.filter(function (t) { return !(t.post_id === p.id && t.brother_id === brotherId); });
      paintTags(p);
    })['catch'](function (err) {
      tagSay(box, (err && err.message) || 'Could not remove that tag.', true);
    });
  }

  /* Open the shared brother card over the photo viewer. The viewer stays open and
     stays scroll-locked underneath: profile-card.js adds `modal-open`, while the
     viewer's own lock is `modal-locked` + a fixed body, so closing the card cannot
     release the page out from under the photo. */
  function openBrother(brotherId) {
    var b = roster.filter(function (x) { return x.id === brotherId; })[0];
    if (!b || !window.BrotherCard) return;
    window.BrotherCard.open(b, { portal: ZBXIUtil.signInHref() });
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
        yearPicker('geYear', p.taken_year) +
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
      var yr = box.querySelector('#geYear');
      btn.disabled = true; btn.textContent = 'Saving…';
      st.className = 'form-status'; st.textContent = '';
      Z.galleryUpdate(p.id, cap.value.trim(), sel ? sel.value : null,
                      yr && yr.value ? parseInt(yr.value, 10) : null).then(function (r) {
        if (r.error) throw r.error;
        p.caption = r.data.caption; p.album_id = r.data.album_id; p.taken_year = r.data.taken_year;
        closeEdit(p);
        renderBody();   // section counts and the decade chips can both change
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

  var curPost = null;

  /* The viewer used to be a dead end: one photo, then close and hunt for the
     next one in the grid. Step through the set the grid is actually showing
     (same album, same decade filter, same order). */
  function shownPosts() { return applyDecade(basePosts()); }
  function paintNav() {
    var list = shownPosts();
    var i = curPost ? list.map(function (x) { return x.id; }).indexOf(curPost.id) : -1;
    var prev = modal.querySelector('[data-gprev]'), next = modal.querySelector('[data-gnext]');
    if (!prev || !next) return;
    prev.hidden = !(i > 0);
    next.hidden = !(i > -1 && i < list.length - 1);
  }
  function step(delta) {
    var list = shownPosts();
    var i = curPost ? list.map(function (x) { return x.id; }).indexOf(curPost.id) : -1;
    if (i < 0) return;
    var t = list[i + delta];
    if (t) openPost(t);
  }

  function openPost(p) {
    curPost = p;
    paintNav();
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
    paintTags(p);
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
    curPost = null;
    unlockPage();                                   // give the page its scroll back
  }
  modal.addEventListener('click', function (e) {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); return; }
    if (!modal.classList.contains('open')) return;
    // Never steal the arrows from someone typing a caption or a comment.
    var t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  (function wireNav() {
    var prev = modal.querySelector('[data-gprev]'), next = modal.querySelector('[data-gnext]');
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); step(1); });
  })();

  /* ---------- data ---------- */
  function loadAll() {
    return Promise.all([Z.galleryList(), Z.galleryLikesAll(), Z.memberDirectory(), Z.galleryAlbums(),
                        Z.galleryTags(), Z.listFamilyPublic()]).then(function (res) {
      posts = res[0]; likes = res[1]; dir = res[2] || {}; albums = res[3] || [];
      // The tag table and the roster. listFamilyPublic() is the SAME cached read the
      // family tree uses, so this costs nothing on a page the brother has visited.
      tags = res[4] || [];
      roster = (res[5] || []).slice().sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
      var paths = posts.map(function (p) { return p.image_path; });
      return Z.gallerySignedUrls(paths).then(function (map) {
        urls = map; renderGrid();
      });
    });
  }

  /* A notification ("you were tagged") links to gallery.html#p=<post id>, and a
     profile card links to gallery.html?tagged=<brother id>. Both have to survive the
     load, so they are read once here and applied after the first render. */
  function openDeepLink() {
    var m = /[#&]p=([0-9a-f-]{36})/i.exec(location.hash || '');
    if (!m) return;
    var p = posts.filter(function (x) { return x.id.toLowerCase() === m[1].toLowerCase(); })[0];
    // The photo is gone — deleted by its owner, or the section was cleared.
    // Following a bell link and landing on the front door with no explanation
    // reads as a broken site, so say what happened.
    if (!p) {
      if (window.ZBXIAsk) ZBXIAsk.alert({ title: 'Photo not found', body: 'That photo has been removed.' });
      return;
    }
    // Land in the section the photo lives in, so closing the viewer leaves the
    // brother somewhere that makes sense rather than on the front door.
    if (view !== 'tagged') { curAlbum = albumOf(p) || 'all'; view = 'grid'; renderGrid(); }
    openPost(p);
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
    Z.approvalState().then(function (state) {
      if (state === 'error') { ZBXIUtil.loadError(root, 'the gallery'); return; }
      if (state !== 'approved') { locked('Awaiting verification', false); return; }
      canPost = true;   // being an approved brother IS the permission (upgrade41)
      Promise.all([
        Z.officerCan ? Z.officerCan('gallery.moderate') : Promise.resolve(false),
        Z.officerCan ? Z.officerCan('gallery.albums') : Promise.resolve(false),
        // My own ROSTER id. Not the same thing as my account id, and it is what
        // decides whether the ✕ appears on a tag of me (upgrade60).
        Z.myProfile ? Z.myProfile(u.id) : Promise.resolve(null)
      ]).then(function (r) {
        canMod = isAdmin || r[0];
        canAlbums = isAdmin || r[1];
        myBrotherId = (r[2] && r[2].id) || null;
        // ?tagged=<brother id> — "show me every photo he is in", from his profile card.
        // ?class=<pledge class> — the same question asked of a whole pledge class,
        // linked from class.html. Read with URLSearchParams so a class containing a
        // space, an apostrophe or a "·" survives the round trip.
        var t = /[?&]tagged=([0-9a-f-]{36})/i.exec(location.search || '');
        if (t) { taggedId = t[1]; view = 'tagged'; }
        try {
          var cls = new URLSearchParams(location.search).get('class');
          if (cls && cls.trim()) { taggedClass = cls.trim(); taggedId = null; view = 'tagged'; }
        } catch (e) {}
        if (!root.querySelector('.sk')) root.innerHTML = gallerySkeleton();  // unless already painted above
        loadAll().then(openDeepLink).catch(function () {
          root.innerHTML = '<p class="page-empty">Could not load the gallery. Try refreshing.</p>';
        });
      });
    });
  });
})();
