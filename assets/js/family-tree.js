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

  function render() {
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
      var av = r.photo_url ? '<img src="' + r.photo_url + '" alt="" />' : '<span>' + (initials || 'ΖΒΞ') + '</span>';
      var reg = (!PLACEHOLDER_MODE && r.registered) ? ' tree-node--reg' : '';
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
        '<span class="tree-node__meta"><b>' + r.full_name + '</b><small>' + sub + '</small></span>' +
        chev +
      '</button>';
    });

    canvas.innerHTML = svg + html;
    wireNodes(L);
  }

  /* ---------- pan + zoom ---------- */
  var tx = 0, ty = 0, scale = 1;
  function apply() { canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
  function fitToView(L) {
    var vw = viewport.clientWidth, vh = viewport.clientHeight;
    scale = Math.min(1, Math.min(vw / (L.width + 60), vh / (L.height + 40)) || 1);
    scale = Math.max(0.25, scale);
    tx = (vw - L.width * scale) / 2;
    ty = 24;
    apply();
  }

  var drag = null;
  viewport.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.tree-node')) return;
    drag = { x: e.clientX - tx, y: e.clientY - ty };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('grabbing');
  });
  viewport.addEventListener('pointermove', function (e) {
    if (!drag) return;
    tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply();
  });
  viewport.addEventListener('pointerup', function () { drag = null; viewport.classList.remove('grabbing'); });
  viewport.addEventListener('pointercancel', function () { drag = null; viewport.classList.remove('grabbing'); });
  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = viewport.getBoundingClientRect();
    var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    var ns = Math.max(0.25, Math.min(2.2, scale * factor));
    tx = cx - (cx - tx) * (ns / scale);
    ty = cy - (cy - ty) * (ns / scale);
    scale = ns; apply();
  }, { passive: false });

  function zoomBy(f) { scale = Math.max(0.25, Math.min(2.2, scale * f)); apply(); }
  var zi = document.getElementById('treeZoomIn'), zo = document.getElementById('treeZoomOut'), zr = document.getElementById('treeReset');
  var xa = document.getElementById('treeExpandAll'), ca = document.getElementById('treeCollapseAll');
  if (zi) zi.addEventListener('click', function () { zoomBy(1.15); });
  if (zo) zo.addEventListener('click', function () { zoomBy(1 / 1.15); });
  if (zr) zr.addEventListener('click', function () { if (currentLayout) fitToView(currentLayout); });
  if (xa) xa.addEventListener('click', function () {
    ALL.forEach(function (r) { if (r._kids.length) expanded[r.id] = true; });
    render(); fitToView(currentLayout);
  });
  if (ca) ca.addEventListener('click', function () {
    expanded = {}; branchRoot = null; syncFamilyChips();
    render(); fitToView(currentLayout);
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
    var bar = document.getElementById('treeFamilies');
    if (!bar) return;
    bar.querySelectorAll('.fam-chip').forEach(function (c) {
      c.classList.toggle('on', (c.dataset.root || null) === (branchRoot || null) ||
        (!branchRoot && !c.dataset.root));
    });
  }

  function renderFamilyBar() {
    var bar = document.getElementById('treeFamilies');
    if (!bar) return;
    var rs = roots().slice().sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
    if (PLACEHOLDER_MODE || rs.length < 2) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<button class="fam-chip on">All families</button>' +
      rs.map(function (r) {
        return '<button class="fam-chip" data-root="' + r.id + '" title="' + r.full_name + '">' +
          lineLabel(r) + ' <i>' + (1 + (descCount[r.id] || 0)) + '</i></button>';
      }).join('');
    bar.querySelectorAll('.fam-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        var id = c.dataset.root || null;
        branchRoot = id;
        expanded = {};
        if (id) expandSubtree(id); // one line, fully open
        syncFamilyChips();
        render(); fitToView(currentLayout);
      });
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
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function row(k, v) { return v ? '<div class="bm__row"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; }

  function openProfile(r) {
    if (!r || !window.BrotherCard) return;
    var big = r.big_id && byId[r.big_id] ? byId[r.big_id].full_name : '—';
    var littles = r._kids.map(function (k) { return k.full_name; }).join(', ') || '—';
    var lineage = row('Big', big) + row('Littles', littles);
    window.BrotherCard.open(r, {
      lineage: lineage,
      portal: '#brothers-portal',
      placeholderData: PLACEHOLDER_MODE ? r : null
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
    renderFamilyBar();
    render();
    fitToView(currentLayout);
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
  window.addEventListener('resize', function () { if (currentLayout) fitToView(currentLayout); });
})();
