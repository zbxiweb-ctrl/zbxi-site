/* Interactive family tree (big -> little lineage) with pan + zoom and
   click-to-open profile cards. Reads verified brothers from Supabase when
   configured; otherwise renders bundled PLACEHOLDER lineage below.
   Node shape matches the `brothers` table so swapping to live data is seamless. */
(function () {
  'use strict';

  /* ---------- PLACEHOLDER lineage (swap for real data / live DB) ---------- */
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

  var NODE_W = 150, NODE_H = 92, GAP_X = 28, GAP_Y = 74;

  var viewport = document.getElementById('treeViewport');
  var canvas   = document.getElementById('treeCanvas');
  if (!viewport || !canvas) return;

  function buildLayout(rows) {
    var byId = {}, roots = [];
    rows.forEach(function (r) { r._kids = []; byId[r.id] = r; });
    rows.forEach(function (r) {
      if (r.big_id && byId[r.big_id]) byId[r.big_id]._kids.push(r);
      else roots.push(r);
    });

    var leaf = 0, maxDepth = 0;
    function place(node, depth) {
      maxDepth = Math.max(maxDepth, depth);
      node._y = depth * (NODE_H + GAP_Y);
      if (!node._kids.length) {
        node._x = leaf * (NODE_W + GAP_X); leaf++;
      } else {
        node._kids.forEach(function (k) { place(k, depth + 1); });
        node._x = (node._kids[0]._x + node._kids[node._kids.length - 1]._x) / 2;
      }
    }
    // virtual root so multiple founders lay out side by side
    roots.forEach(function (r) { place(r, 0); });

    var width = leaf * (NODE_W + GAP_X);
    var height = (maxDepth + 1) * (NODE_H + GAP_Y);
    return { byId: byId, roots: roots, rows: rows, width: width, height: height };
  }

  function render(rows) {
    var L = buildLayout(rows);
    canvas.style.width = L.width + 'px';
    canvas.style.height = L.height + 'px';

    // connectors
    var svg = '<svg class="tree-links" width="' + L.width + '" height="' + L.height + '">';
    rows.forEach(function (r) {
      if (r.big_id && L.byId[r.big_id]) {
        var p = L.byId[r.big_id];
        var x1 = p._x + NODE_W / 2, y1 = p._y + NODE_H;
        var x2 = r._x + NODE_W / 2, y2 = r._y;
        var my = (y1 + y2) / 2;
        svg += '<path d="M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2 + '" />';
      }
    });
    svg += '</svg>';

    // nodes
    var html = '';
    rows.forEach(function (r) {
      var initials = r.full_name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase();
      var av = r.photo_url
        ? '<img src="' + r.photo_url + '" alt="" />'
        : '<span>' + (initials || 'ΖΒΞ') + '</span>';
      html += '<button class="tree-node" data-id="' + r.id + '" style="left:' + r._x + 'px;top:' + r._y + 'px;width:' + NODE_W + 'px;height:' + NODE_H + 'px">' +
        '<span class="tree-node__av">' + av + '</span>' +
        '<span class="tree-node__meta"><b>' + r.full_name + '</b><small>' + (r.pledge_class || '') + '</small></span>' +
      '</button>';
    });

    canvas.innerHTML = svg + html;
    fitToView(L);
    wireNodes(L);
  }

  /* ---------- pan + zoom ---------- */
  var tx = 0, ty = 0, scale = 1;
  function apply() { canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
  function fitToView(L) {
    var vw = viewport.clientWidth, vh = viewport.clientHeight;
    scale = Math.min(1, Math.min(vw / (L.width + 60), vh / (L.height + 40)) || 1);
    scale = Math.max(0.3, scale);
    tx = (vw - L.width * scale) / 2;
    ty = 24;
    apply();
  }

  var drag = null;
  viewport.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.tree-node')) return; // let clicks through
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
    var ns = Math.max(0.3, Math.min(2.2, scale * factor));
    // zoom toward cursor
    tx = cx - (cx - tx) * (ns / scale);
    ty = cy - (cy - ty) * (ns / scale);
    scale = ns; apply();
  }, { passive: false });

  function zoomBy(f) { scale = Math.max(0.3, Math.min(2.2, scale * f)); apply(); }
  var zi = document.getElementById('treeZoomIn'), zo = document.getElementById('treeZoomOut'), zr = document.getElementById('treeReset');
  if (zi) zi.addEventListener('click', function () { zoomBy(1.15); });
  if (zo) zo.addEventListener('click', function () { zoomBy(1 / 1.15); });

  /* ---------- profile modal ---------- */
  function wireNodes(L) {
    canvas.querySelectorAll('.tree-node').forEach(function (btn) {
      btn.addEventListener('click', function () { openProfile(L.byId[btn.dataset.id], L); });
    });
    if (zr) zr.onclick = function () { fitToView(L); };
  }

  function openProfile(r, L) {
    if (!r) return;
    var big = r.big_id && L.byId[r.big_id] ? L.byId[r.big_id].full_name : '—';
    var littles = r._kids.map(function (k) { return k.full_name; }).join(', ') || '—';
    var m = document.getElementById('brotherModal');
    m.querySelector('[data-f=name]').textContent = r.full_name;
    m.querySelector('[data-f=sub]').textContent = [r.pledge_class, r.role].filter(Boolean).join(' · ');
    m.querySelector('[data-f=body]').innerHTML =
      row('Major', r.major) + row('Class of', r.grad_year) + row('Hometown', r.hometown) +
      row('Big', big) + row('Littles', littles) +
      (r.quote ? '<p class="bm__quote">“' + r.quote + '”</p>' : '');
    var av = m.querySelector('[data-f=avatar]');
    if (r.photo_url) { av.innerHTML = '<img src="' + r.photo_url + '" alt="">'; }
    else { av.textContent = r.full_name.replace(/[^A-Za-z ]/g,'').split(' ').filter(Boolean).slice(-2).map(function(s){return s[0];}).join('').toUpperCase(); }
    m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
  }
  function row(k, v) { return v ? '<div class="bm__row"><span>' + k + '</span><b>' + v + '</b></div>' : ''; }

  var modal = document.getElementById('brotherModal');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-close]')) {
        modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
    });
  }

  /* ---------- data source ---------- */
  function load() {
    if (window.ZBXI && window.ZBXI.configured) {
      window.ZBXI.listVerified().then(function (rows) {
        render(rows && rows.length ? rows : PLACEHOLDER);
      }).catch(function () { render(PLACEHOLDER); });
    } else {
      render(PLACEHOLDER);
    }
  }
  load();
  window.addEventListener('resize', function () {
    // re-fit on resize without full re-render
    var L = { width: canvas.offsetWidth, height: canvas.offsetHeight };
    fitToView(L);
  });
})();
