/* Interactive family tree (big -> little lineage): pan + zoom, collapsible
   branches (default: founders only — keeps 322 nodes from rendering at once),
   registered-vs-unregistered color coding, and click-to-open gated profile
   cards. Reads verified brothers from the family_public view when configured;
   otherwise renders bundled PLACEHOLDER lineage. */
(function () {
  'use strict';

  /* ---------- PLACEHOLDER lineage (used only when Supabase is unconfigured) ---------- */
  var PLACEHOLDER = [
    { id: 'f1', full_name: 'Founding Father — A. Reyes', pledge_class: 'Fall 1993', grad_year: 1996, major: 'History',        big_id: null, role: 'Founder', quote: 'We chose our own path.', hometown: 'Buffalo, NY' },
    { id: 'f2', full_name: 'Founding Father — M. Cohen',  pledge_class: 'Fall 1993', grad_year: 1997, major: 'Economics',      big_id: null, role: 'Founder', quote: 'Brotherhood before all.', hometown: 'Albany, NY' },
    { id: 'a1', full_name: 'James Whitfield', pledge_class: 'Spring 1996', grad_year: 1999, major: 'Biology',      big_id: 'f1' },
    { id: 'a2', full_name: 'Daniel Ortiz',    pledge_class: 'Fall 1997',   grad_year: 2000, major: 'Chemistry',    big_id: 'f1' },
    { id: 'a3', full_name: 'Robert Klein',    pledge_class: 'Fall 1996',   grad_year: 1999, major: 'Finance',      big_id: 'f2' },
    { id: 'b1', full_name: 'Kevin Nakamura',  pledge_class: 'Fall 2001',   grad_year: 2004, major: 'Engineering', big_id: 'a1' },
    { id: 'b2', full_name: 'Andre Wallace',   pledge_class: 'Spring 2002', grad_year: 2005, major: 'Marketing',   big_id: 'a1' },
    { id: 'b3', full_name: 'Paul Genovese',   pledge_class: 'Fall 2003',   grad_year: 2006, major: 'Political Sci', big_id: 'a3' },
    { id: 'c1', full_name: 'Marcus Cole',     pledge_class: 'Fall 2019',   grad_year: 2023, major: 'Biology',     big_id: 'b1', quote: 'Proud to carry the line forward.' },
    { id: 'c2', full_name: 'Devin Park',      pledge_class: 'Spring 2020', grad_year: 2024, major: 'Computer Sci', big_id: 'b1' },
    { id: 'c3', full_name: 'Tyler Brooks',    pledge_class: 'Fall 2021',   grad_year: 2025, major: 'History',     big_id: 'b2' },
    { id: 'c4', full_name: 'Noah Fitzgerald', pledge_class: 'Fall 2022',   grad_year: 2026, major: 'Psychology',  big_id: 'b3' },
    { id: 'c5', full_name: 'Ethan Ramos',     pledge_class: 'Spring 2023', grad_year: 2026, major: 'Physics',     big_id: 'b3' }
  ];

  var NODE_W = 168, NODE_H = 92, GAP_X = 28, GAP_Y = 74;

  var viewport = document.getElementById('treeViewport');
  var canvas   = document.getElementById('treeCanvas');
  if (!viewport || !canvas) return;

  /* ---------- data + expansion state ---------- */
  var ALL = [];               // full dataset
  var byId = {};              // id -> row (with _kids on full dataset)
  var descCount = {};         // id -> total descendants
  var expanded = {};          // id -> true when branch is open
  var PLACEHOLDER_MODE = true;
  var currentLayout = null;
  var branchRoot = null;      // focus mode: show ONE founder line, fully open
  var HYDRATED = false;       // approved viewers get photos + extra detail

  function indexData(rows) {
    ALL = rows; byId = {}; descCount = {};
    rows.forEach(function (r) { r._kids = []; byId[r.id] = r; });
    rows.forEach(function (r) { if (r.big_id && byId[r.big_id]) byId[r.big_id]._kids.push(r); });
    function count(n) {
      var c = 0;
      n._kids.forEach(function (k) { c += 1 + count(k); });
      descCount[n.id] = c; return c;
    }
    rows.filter(function (r) { return !r.big_id || !byId[r.big_id]; }).forEach(count);
  }

  function roots() {
    return ALL.filter(function (r) { return !r.big_id || !byId[r.big_id]; });
  }

  // Family lines with descendants first (alphabetical), childless roots
  // (e.g. standalone admin/self-created profiles) sink to the end.
  function sortedRoots() {
    return roots().slice().sort(function (a, z) {
      var af = (descCount[a.id] || 0) > 0 ? 0 : 1;
      var zf = (descCount[z.id] || 0) > 0 ? 0 : 1;
      return af - zf || a.full_name.localeCompare(z.full_name);
    });
  }

  function visibleRows() {
    var out = [];
    function walk(n, show) {
      if (!show) return;
      out.push(n);
      if (expanded[n.id]) n._kids.forEach(function (k) { walk(k, true); });
    }
    var rs = roots();
    if (branchRoot) rs = rs.filter(function (r) { return r.id === branchRoot; });
    rs.forEach(function (root) { walk(root, true); });
    return out;
  }

  /* ---------- layout (runs on the VISIBLE subset only) ---------- */
  function buildLayout(rows) {
    var vById = {}, roots = [];
    rows.forEach(function (r) { r._vkids = []; vById[r.id] = r; });
    rows.forEach(function (r) {
      if (r.big_id && vById[r.big_id]) vById[r.big_id]._vkids.push(r);
      else roots.push(r);
    });
    var leaf = 0, maxDepth = 0;
    function place(node, depth) {
      maxDepth = Math.max(maxDepth, depth);
      node._y = depth * (NODE_H + GAP_Y);
      var kids = (expanded[node.id] ? node._vkids : []);
      if (!kids.length) { node._x = leaf * (NODE_W + GAP_X); leaf++; }
      else {
        kids.forEach(function (k) { place(k, depth + 1); });
        node._x = (kids[0]._x + kids[kids.length - 1]._x) / 2;
      }
    }
    roots.forEach(function (r) { place(r, 0); });
    return { byId: vById, roots: roots, rows: rows, width: Math.max(leaf * (NODE_W + GAP_X), NODE_W), height: (maxDepth + 1) * (NODE_H + GAP_Y) };
  }

  // "All families" with nothing expanded: a grid of family-line cards instead of
  // the full tree. Founding lines lay out two-across; childless roots (e.g. the
  // admin's standalone profile) sit centered on their own row underneath.
  // Collapses to a single column when the viewport is too narrow for two.
  var FAM_W = 250;              // family-line card width; shrunk on phones so 2 columns always fit
  var TOP_PAD = 58;             // clears the top-right toolbar
  var BOTTOM_PAD = 46;          // clears the bottom-left hint chip
  function famCard(r, left, top) {
    var initials = r.full_name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase();
    var av = r.photo_url ? '<img src="' + esc(r.photo_url) + '" alt="" />' : '<span>' + (initials || 'ΖΒΞ') + '</span>';
    var reg = (!PLACEHOLDER_MODE && r.registered) ? ' tree-node--reg' : '';
    var n = descCount[r.id] || 0;
    return '<button class="tree-node tree-node--family' + reg + '" data-id="' + r.id +
      '" style="left:' + left + 'px;top:' + top + 'px;width:' + FAM_W + 'px;height:' + NODE_H + 'px">' +
      '<span class="tree-node__av">' + av + '</span>' +
      '<span class="tree-node__meta"><b>' + esc(r.full_name) + '</b><small>' + esc(r.pledge_class || '') + '</small></span>' +
      (n ? '<span class="tree-toggle" data-line="' + r.id + '" title="Open this family line">▸ ' + n + '</span>' : '') +
    '</button>';
  }

  function renderFamilyMenu() {
    var rs = sortedRoots();
    var lines = rs.filter(function (r) { return (descCount[r.id] || 0) > 0; });
    var solo  = rs.filter(function (r) { return (descCount[r.id] || 0) === 0; });
    var GAP = 16;
    var vw = viewport.clientWidth, vh = viewport.clientHeight;   // vh is used by the fit math below

    // ALWAYS two columns (a 2×5 matrix for ten lines) — on a phone we shrink the
    // card instead of collapsing to a single tall column.
    var cols = 2;
    FAM_W = Math.max(132, Math.min(250, Math.floor((vw - GAP - 28) / cols)));

    var rows = Math.ceil(lines.length / cols);
    var gridW = cols * FAM_W + (cols - 1) * GAP;
    var rowH = NODE_H + GAP;

    var html = '';
    lines.forEach(function (r, i) {
      html += famCard(r, (i % cols) * (FAM_W + GAP), Math.floor(i / cols) * rowH);
    });
    // childless roots: centered under the grid, evenly spaced
    solo.forEach(function (r, i) {
      html += famCard(r, (gridW - FAM_W) / 2, (rows + i) * rowH);
    });

    // extra room at the bottom so the last row never hides under the hint chip
    var height = (rows + solo.length) * rowH - GAP + BOTTOM_PAD;
    canvas.style.width = gridW + 'px';
    canvas.style.height = height + 'px';
    canvas.innerHTML = html;
    currentLayout = { width: gridW, height: height, rows: rs, byId: byId };

    // wire: chevron opens the line; card body opens the profile
    canvas.querySelectorAll('.tree-toggle').forEach(function (t) {
      t.addEventListener('click', function (e) {
        e.stopPropagation();
        selectBranch(t.dataset.line);
      });
    });
    canvas.querySelectorAll('.tree-node').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (e.target.closest('.tree-toggle')) return;
        openProfile(byId[btn.dataset.id]);
      });
    });

    // shrink-to-fit so all ten lines are visible without panning
    scale = Math.max(0.4, Math.min(1, (vh - TOP_PAD - 16) / height, (vw - 24) / gridW));
    tx = (vw - gridW * scale) / 2;
    ty = Math.max(TOP_PAD, (vh - height * scale) / 2);   // never tuck the top row under the toolbar
    apply();
  }

  function selectBranch(id) {
    branchRoot = id || null;
    expanded = {};
    if (id) expandSubtree(id);
    syncFamilyChips();
    render();
    if (branchRoot) fitToView(currentLayout);
  }

  function render() {
    if (!PLACEHOLDER_MODE && !branchRoot && !Object.keys(expanded).length && roots().length > 1) {
      renderFamilyMenu();
      return;
    }
    var rows = visibleRows();
    var L = buildLayout(rows);
    currentLayout = L;
    canvas.style.width = L.width + 'px';
    canvas.style.height = L.height + 'px';

    var svg = '<svg class="tree-links" width="' + L.width + '" height="' + L.height + '">';
    rows.forEach(function (r) {
      if (r.big_id && L.byId[r.big_id] && expanded[r.big_id]) {
        var p = L.byId[r.big_id];
        var x1 = p._x + NODE_W / 2, y1 = p._y + NODE_H;
        var x2 = r._x + NODE_W / 2, y2 = r._y;
        var my = (y1 + y2) / 2;
        svg += '<path d="M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2 + '" />';
      }
    });
    svg += '</svg>';

    var html = '';
    rows.forEach(function (r) {
      var initials = r.full_name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase();
      var av = r.photo_url ? '<img src="' + esc(r.photo_url) + '" alt="" />' : '<span>' + (initials || 'ΖΒΞ') + '</span>';
      var reg = (!PLACEHOLDER_MODE && r.registered) ? ' tree-node--reg' : '';
      if (branchRoot && r.id === branchRoot) reg += ' tree-node--rootsel';
      var kidsN = descCount[r.id] || 0;
      var chev = '';
      if (r._kids.length) {
        chev = expanded[r.id]
          ? '<span class="tree-toggle" data-t="' + r.id + '" title="Collapse branch">▾</span>'
          : '<span class="tree-toggle" data-t="' + r.id + '" title="Expand branch">▸ ' + kidsN + '</span>';
      }
      var sub = r.pledge_class || '';
      if (HYDRATED && r.grad_year) sub += (sub ? ' · ' : '') + "'" + String(r.grad_year).slice(-2);
      html += '<button class="tree-node' + reg + '" data-id="' + r.id + '" style="left:' + r._x + 'px;top:' + r._y + 'px;width:' + NODE_W + 'px;height:' + NODE_H + 'px">' +
        '<span class="tree-node__av">' + av + '</span>' +
        '<span class="tree-node__meta"><b>' + esc(r.full_name) + '</b><small>' + esc(sub) + '</small></span>' +
        chev +
      '</button>';
    });

    canvas.innerHTML = svg + html;
    wireNodes(L);
  }

  /* ---------- pan + zoom (single-finger drag, two-finger pinch, wheel) ---------- */
  var tx = 0, ty = 0, scale = 1;
  var MIN_S = 0.25, MAX_S = 2.2;
  function apply() { canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
  function applySmooth() {
    canvas.style.transition = 'transform .28s ease';
    apply();
    setTimeout(function () { canvas.style.transition = ''; }, 300);
  }
  function fitToView(L) {
    var vw = viewport.clientWidth, vh = viewport.clientHeight;
    // reserve the toolbar strip so the fitted content never lands under it
    scale = Math.min(1, Math.min(vw / (L.width + 60), (vh - TOP_PAD) / (L.height + 24)) || 1);
    scale = Math.max(MIN_S, scale);
    tx = (vw - L.width * scale) / 2;
    ty = TOP_PAD;
    applySmooth();
  }

  var pointers = {};      // pointerId -> {x,y}
  var nPointers = 0;
  var drag = null;        // {x,y} pan offset base, or {pend:true,...} awaiting drag threshold on a node
  var pinch = null;       // start snapshot for two-finger gesture
  var moved = false;      // true once a gesture actually moved -> suppress the trailing click
  function pList() { return Object.keys(pointers).map(function (k) { return pointers[k]; }); }
  function hideHint() {
    var h = document.getElementById('treeHintChip');
    if (h) h.classList.add('gone');
  }
  // The toolbar/close button live INSIDE the viewport. Without this, pressing a
  // button starts a pan, and the tiniest mouse jitter sets `moved`, which the
  // click guard below then uses to cancel the click — the buttons looked dead
  // on desktop (a mouse always drifts a pixel; a finger usually doesn't).
  function onChrome(e) {
    return !!(e.target.closest && e.target.closest('.tree-controls, .tree-fullclose, .tree-hintchip'));
  }

  function isFull() { return !!(shell && shell.classList.contains('tree-shell--full')); }

  viewport.addEventListener('pointerdown', function (e) {
    if (onChrome(e)) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    nPointers++;
    moved = false;
    hideHint();
    if (nPointers === 2) {
      // second finger down -> pinch takes over; both pointers are ours now
      var pts = pList();
      try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
      pinch = {
        dist: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        scale: scale, tx: tx, ty: ty
      };
      drag = null;
      moved = true;
      viewport.classList.add('grabbing');
    } else if (nPointers === 1) {
      if (e.target.closest('.tree-node')) {
        // starting on a card: wait for a 6px move before treating it as a pan,
        // so a plain tap still opens the profile instantly
        drag = { pend: true, sx: e.clientX, sy: e.clientY, x: e.clientX - tx, y: e.clientY - ty };
      } else {
        drag = { x: e.clientX - tx, y: e.clientY - ty };
        try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
        viewport.classList.add('grabbing');
      }
    }
  });

  viewport.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch && nPointers >= 2) {
      var pts = pList();
      var dist = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      var rect = viewport.getBoundingClientRect();
      var ns = Math.max(MIN_S, Math.min(MAX_S, pinch.scale * (dist / pinch.dist)));
      // keep the world point that was under the start-midpoint pinned under the current midpoint
      var wx = (pinch.mid.x - rect.left - pinch.tx) / pinch.scale;
      var wy = (pinch.mid.y - rect.top - pinch.ty) / pinch.scale;
      tx = (mid.x - rect.left) - wx * ns;
      ty = (mid.y - rect.top) - wy * ns;
      scale = ns;
      apply();
      return;
    }
    if (!drag) return;
    if (drag.pend) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag = { x: drag.x, y: drag.y };
      try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
      viewport.classList.add('grabbing');
    }
    moved = true;
    tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply();
  });

  function endPointer(e) {
    if (pointers[e.pointerId]) { delete pointers[e.pointerId]; nPointers = Math.max(0, nPointers - 1); }
    if (nPointers < 2) pinch = null;
    if (nPointers === 1) {
      // one finger left after a pinch: continue as a pan from its position
      var p = pList()[0];
      drag = { x: p.x - tx, y: p.y - ty };
    } else if (nPointers === 0) {
      drag = null;
      viewport.classList.remove('grabbing');
    }
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  // a drag/pinch must never fire the card underneath it — but never swallow
  // clicks on the toolbar sitting on top of the viewport
  viewport.addEventListener('click', function (e) {
    if (moved && !onChrome(e)) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  viewport.addEventListener('wheel', function (e) {
    if (onChrome(e)) return;   // let the toolbar be, don't hijack the wheel
    /* Do NOT steal the page's scroll. The tree sits in the middle of the homepage,
       and swallowing the wheel meant the page froze the moment the cursor drifted
       over it. Zoom is opt-in: Ctrl/⌘ + wheel (the standard embedded-map contract).
       Fullscreen is a dedicated surface, so there the wheel zooms freely. */
    if (!isFull() && !e.ctrlKey && !e.metaKey) return;   // no preventDefault -> page scrolls
    e.preventDefault();
    hideHint();
    var rect = viewport.getBoundingClientRect();
    var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    var ns = Math.max(MIN_S, Math.min(MAX_S, scale * factor));
    tx = cx - (cx - tx) * (ns / scale);
    ty = cy - (cy - ty) * (ns / scale);
    scale = ns; apply();
  }, { passive: false });

  function zoomBy(f) {
    var vw = viewport.clientWidth / 2, vh = viewport.clientHeight / 2;
    var ns = Math.max(MIN_S, Math.min(MAX_S, scale * f));
    tx = vw - (vw - tx) * (ns / scale);
    ty = vh - (vh - ty) * (ns / scale);
    scale = ns; applySmooth();
  }
  var zi = document.getElementById('treeZoomIn'), zo = document.getElementById('treeZoomOut'), zr = document.getElementById('treeReset');
  var xa = document.getElementById('treeExpandAll'), ca = document.getElementById('treeCollapseAll');
  if (zi) zi.addEventListener('click', function () { zoomBy(1.18); });
  if (zo) zo.addEventListener('click', function () { zoomBy(1 / 1.18); });
  if (zr) zr.addEventListener('click', function () { if (currentLayout) fitToView(currentLayout); });
  if (xa) xa.addEventListener('click', function () {
    ALL.forEach(function (r) { if (r._kids.length) expanded[r.id] = true; });
    render(); fitToView(currentLayout);
  });
  if (ca) ca.addEventListener('click', function () { selectBranch(null); });

  /* ---------- fullscreen explorer ---------- */
  var shell = viewport.closest('.tree-shell');
  var fullBtn = document.getElementById('treeFull');
  var fullClose = document.getElementById('treeFullClose');
  function setFull(on) {
    if (!shell) return;
    shell.classList.toggle('tree-shell--full', on);
    document.body.classList.toggle('tree-lock', on);
    if (fullBtn) { fullBtn.textContent = on ? '⛶' : '⛶'; fullBtn.title = on ? 'Exit fullscreen' : 'Fullscreen'; }
    if (currentLayout) fitToView(currentLayout);
  }
  if (fullBtn) fullBtn.addEventListener('click', function () {
    setFull(!shell.classList.contains('tree-shell--full'));
  });
  if (fullClose) fullClose.addEventListener('click', function () { setFull(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && shell && shell.classList.contains('tree-shell--full')) setFull(false);
  });

  /* ---------- family (branch) selector: one line at a time ---------- */
  function expandSubtree(id) {
    var n = byId[id];
    if (!n) return;
    if (n._kids.length) expanded[id] = true;
    n._kids.forEach(function (k) { expandSubtree(k.id); });
  }

  function lineLabel(r) {
    var last = r.full_name.trim().split(/\s+/).pop();
    return last + ' line';
  }

  function syncFamilyChips() {
    var sel = document.getElementById('famSelect');
    if (sel) sel.value = branchRoot || '';
  }

  // One family selector for every screen size: a styled dropdown (the chip bar
  // used to overflow on phones, and desktop now matches mobile for consistency).
  function renderFamilyBar() {
    var bar = document.getElementById('treeFamilies');
    if (!bar) return;
    bar.style.display = 'none';
    var old = document.getElementById('famSelect');
    if (old) old.remove();
    var rs = sortedRoots();
    if (PLACEHOLDER_MODE || rs.length < 2) return;
    var sel = document.createElement('select');
    sel.id = 'famSelect';
    sel.className = 'fam-select';
    sel.innerHTML = '<option value="">🌳 All families</option>' + rs.map(function (r) {
      return '<option value="' + r.id + '">' + esc(lineLabel(r)) + ' (' + (1 + (descCount[r.id] || 0)) + ')</option>';
    }).join('');
    sel.onchange = function () { selectBranch(sel.value || null); };
    bar.parentNode.insertBefore(sel, bar);
  }

  /* ---------- find a brother: search box + jump-to-node ---------- */
  function rootOf(id) {
    var n = byId[id], guard = 0;
    while (n && n.big_id && byId[n.big_id] && guard++ < 100) n = byId[n.big_id];
    return n;
  }

  function focusBrother(id) {
    var b = byId[id];
    if (!b) return;
    var root = rootOf(id);
    selectBranch(root ? root.id : null);
    // center + pulse the node (after render/fit)
    var el = canvas.querySelector('.tree-node[data-id="' + id + '"]');
    if (el && currentLayout && currentLayout.byId[id]) {
      var n = currentLayout.byId[id];
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      tx = vw / 2 - (n._x + NODE_W / 2) * scale;
      ty = Math.min(24, vh / 2 - (n._y + NODE_H / 2) * scale);
      apply();
    }
    highlightPath(id);
    if (el) {
      el.classList.add('tree-node--pulse');
      setTimeout(function () { el.classList.remove('tree-node--pulse'); }, 2400);
    }
  }

  function highlightPath(id) {
    canvas.querySelectorAll('.tree-node--path').forEach(function (n) { n.classList.remove('tree-node--path'); });
    var n = byId[id], guard = 0;
    while (n && guard++ < 100) {
      var el = canvas.querySelector('.tree-node[data-id="' + n.id + '"]');
      if (el) el.classList.add('tree-node--path');
      n = n.big_id ? byId[n.big_id] : null;
    }
  }

  function wireSearch() {
    var input = document.getElementById('treeSearchInput');
    var results = document.getElementById('treeSearchResults');
    if (!input || !results) return;
    if (PLACEHOLDER_MODE) { input.parentElement.style.display = 'none'; return; }
    input.parentElement.style.display = '';
    input.oninput = function () {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }
      var hits = ALL.filter(function (b) { return b.full_name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
      if (!hits.length) { results.innerHTML = '<span class="tree-search__none">No brother found</span>'; results.style.display = 'block'; return; }
      results.innerHTML = hits.map(function (b) {
        return '<button data-jumpto="' + b.id + '"><b>' + esc(b.full_name) + '</b><span>' + esc(b.pledge_class || '') + '</span></button>';
      }).join('');
      results.style.display = 'block';
      results.querySelectorAll('[data-jumpto]').forEach(function (r) {
        r.onclick = function () {
          results.style.display = 'none';
          input.value = '';
          focusBrother(r.dataset.jumpto);
        };
      });
    };
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.tree-search')) results.style.display = 'none';
    });
  }

  /* ---------- member hydration: photos + grad year for approved viewers ---------- */
  function hydrate() {
    if (PLACEHOLDER_MODE || !window.ZBXI || !window.ZBXI.configured) return;
    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (!ok) return;
      window.ZBXI.listVerifiedDetail().then(function (rows) {
        (rows || []).forEach(function (d) {
          var n = byId[d.id];
          if (!n) return;
          n.photo_url = d.photo_url || n.photo_url;
          n.grad_year = d.grad_year || n.grad_year;
          n.role_term = d.role_term || n.role_term;
        });
        HYDRATED = true;
        render();
      });
    });
  }

  /* ---------- node wiring ---------- */
  function wireNodes(L) {
    canvas.querySelectorAll('.tree-toggle').forEach(function (t) {
      t.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = t.dataset.t;
        expanded[id] = !expanded[id];
        render();
        fitToView(currentLayout);
      });
    });
    canvas.querySelectorAll('.tree-node').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (e.target.closest('.tree-toggle')) return;
        openProfile(byId[btn.dataset.id]);
      });
    });
  }

  /* ---------- profile modal (shared renderer; details gated to approved) ---------- */
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function row(k, v) { return v ? '<div class="bm__row"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; }

  function jumpLink(b) {
    return '<a href="#" class="bm-jump" data-jump="' + b.id + '">' + esc(b.full_name) + '</a>';
  }

  function openProfile(r) {
    if (!r || !window.BrotherCard) return;
    var big = r.big_id && byId[r.big_id] ? jumpLink(byId[r.big_id]) : '—';
    var littles = r._kids.map(jumpLink).join(', ') || '—';
    var lineage = '<div class="bm__row"><span>Big</span><b>' + big + '</b></div>' +
                  '<div class="bm__row"><span>Littles</span><b>' + littles + '</b></div>';
    highlightPath(r.id);
    window.BrotherCard.open(r, {
      lineage: lineage,
      portal: '#brothers-portal',
      placeholderData: PLACEHOLDER_MODE ? r : null
    });
  }

  // Lineage names inside the modal navigate the tree to that brother.
  var _bm = document.getElementById('brotherModal');
  if (_bm) {
    _bm.addEventListener('click', function (e) {
      var a = e.target.closest('[data-jump]');
      if (!a) return;
      e.preventDefault();
      _bm.classList.remove('open'); _bm.setAttribute('aria-hidden', 'true');
      focusBrother(a.dataset.jump);
      var next = byId[a.dataset.jump];
      if (next) setTimeout(function () { openProfile(next); }, 350);
    });
  }

  /* ---------- data source ---------- */
  function start(rows, placeholder) {
    PLACEHOLDER_MODE = placeholder;
    indexData(rows);
    expanded = {}; branchRoot = null;
    if (placeholder) { // demo data is small: show everything
      rows.forEach(function (r) { if (r._kids.length) expanded[r.id] = true; });
    }
    var legend = document.getElementById('treeLegend');
    if (legend) legend.style.display = placeholder ? 'none' : 'flex';
    // Demo mode on the live site = viewer isn't signed in (names are members-only).
    var lockNote = document.getElementById('treeLockNote');
    if (lockNote) lockNote.style.display =
      (placeholder && window.ZBXI && window.ZBXI.configured) ? '' : 'none';
    renderFamilyBar();
    wireSearch();
    render();
    if (placeholder) fitToView(currentLayout); // live mode starts on the family menu (self-positions)
    hydrate();
  }

  function load() {
    if (window.ZBXI && window.ZBXI.configured) {
      window.ZBXI.listFamilyPublic().then(function (rows) {
        if (rows && rows.length) start(rows, false);
        else start(PLACEHOLDER, true);
      }).catch(function () { start(PLACEHOLDER, true); });
    } else {
      start(PLACEHOLDER, true);
    }
  }
  load();
  window.addEventListener('resize', function () {
    if (!currentLayout) return;
    // family-menu mode positions itself; classic layouts re-fit
    if (!PLACEHOLDER_MODE && !branchRoot && !Object.keys(expanded).length) render();
    else fitToView(currentLayout);
  });
})();
