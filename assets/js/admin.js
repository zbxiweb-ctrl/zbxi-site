/* Admin console. Sign in as ADMIN_EMAIL, then manage brothers across
   Pending / Approved / Rejected tabs: search, approve/reject, revoke/restore,
   edit, delete. All enforced by RLS — the UI checks are convenience only. */
(function () {
  'use strict';
  var Z = window.ZBXI;
  var root = document.getElementById('adminRoot');
  if (!root) return;

  if (!Z || !Z.configured) {
    root.innerHTML = '<div class="admin-msg"><h2>Not configured</h2><p>Add your Supabase keys to <code>assets/js/config.js</code> first.</p></div>';
    return;
  }

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function initials(name) { return String(name || '').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase() || 'ΖΒΞ'; }

  /* ---------------- auth gate ---------------- */
  function renderLogin(msg) {
    root.innerHTML = '<div class="admin-card"><h2>Admin sign-in</h2>' +
      '<form id="al" novalidate>' +
      '<div class="field"><label>Email</label><input name="email" type="email" required></div>' +
      '<div class="field"><label>Password</label><input name="password" type="password" required></div>' +
      '<button class="btn btn--navy" style="width:100%" type="submit">Log in</button>' +
      '<p class="form-status ' + (msg ? 'err' : '') + '">' + (msg || '') + '</p></form></div>';
    document.getElementById('al').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target;
      Z.signIn(f.email.value.trim(), f.password.value).then(function (r) {
        if (r.error) throw r.error; gate();
      }).catch(function (err) { renderLogin(err.message || 'Login failed'); });
    };
  }

  function gate() {
    Z.getUser().then(function (u) {
      if (!u) return renderLogin('');
      if ((u.email || '').toLowerCase() !== Z.adminEmail) {
        root.innerHTML = '<div class="admin-msg"><h2>Not authorized</h2><p>' + esc(u.email) +
          ' is not the admin account.</p><button class="btn btn--ghost" id="so">Sign out</button></div>';
        document.getElementById('so').onclick = function () { Z.signOut().then(function () { renderLogin(''); }); };
        return;
      }
      renderConsole();
    });
  }

  /* ---------------- console ---------------- */
  // "Approved" = verified AND has a linked account (user_id). "Unclaimed" =
  // verified roster names nobody has claimed yet. state.data.verified keeps
  // the combined set (feeds big-brother dropdowns + the tree editor).
  var state = { tab: 'pending', data: { pending: [], approved: [], unclaimed: [], verified: [], rejected: [] }, verifiedById: {}, q: '', events: [], treeLine: null };
  var BRO_TABS = ['pending', 'approved', 'unclaimed', 'rejected'];
  var TAB_GROUPS = [
    { label: 'Brothers', tabs: [
      { id: 'pending',   label: 'Pending'   },
      { id: 'approved',  label: 'Approved'  },
      { id: 'unclaimed', label: '📋 Unclaimed' },
      { id: 'rejected',  label: 'Rejected'  }
    ]},
    { label: 'Site', tabs: [
      { id: 'tree',       label: '🌳 Tree'  },
      { id: 'eboard',     label: '👑 E-Board' },
      { id: 'committees', label: '👥 Committees' },
      { id: 'events',     label: 'Events'   },
      { id: 'awards',     label: '🏅 Awards' },
      { id: 'suggest',    label: '💡 Suggestions <span class="tab-count" data-count="suggest" style="display:none"></span>' },
      { id: 'stats',      label: 'Stats'    },
      { id: 'guide',      label: '📖 Guide' }
    ]}
  ];

  // Active/Alumni logic — same rule the public pages use: grad year in the
  // future (or this academic year) = Active. Grad year comes from the profile
  // or is inferred from the pledge class year + 4.
  var _now = new Date();
  var CUTOFF = _now.getFullYear() + (_now.getMonth() >= 5 ? 1 : 0);
  function pledgeYear(cls) {
    if (!cls) return null;
    var m4 = cls.match(/(19|20)\d{2}/);
    if (m4) return parseInt(m4[0], 10);
    var m2 = cls.match(/'(\d{2})/);
    if (!m2) return null;
    var yy = parseInt(m2[1], 10);
    return yy >= 93 ? 1900 + yy : 2000 + yy;
  }
  function statusChip(b) {
    var grad = b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null);
    return (grad != null && grad >= CUTOFF)
      ? '<span class="schip schip--active">● Active</span>'
      : '<span class="schip">Alumni</span>';
  }

  function renderConsole() {
    root.innerHTML =
      '<div class="admin-head">' +
        '<div class="admin-head__id"><img class="crest-badge" src="assets/img/crest-sm.png" alt="" />' +
          '<div><h2>Brotherhood Admin</h2><span class="admin-head__sub">The webmaster console — everything is buttons, never code.</span></div></div>' +
        '<button class="btn btn--ghost" id="so">Sign out</button></div>' +
      '<div id="tabs">' +
        TAB_GROUPS.map(function (g) {
          return '<div class="admin-tabgroup"><span class="admin-tabgroup__label">' + g.label + '</span>' +
            '<div class="admin-tabs">' +
            g.tabs.map(function (t) {
              var count = BRO_TABS.indexOf(t.id) !== -1 ? ' <span class="tab-count" data-count="' + t.id + '">…</span>' : '';
              return '<button data-tab="' + t.id + '" class="' + (state.tab === t.id ? 'on' : '') + '">' + t.label + count + '</button>';
            }).join('') +
            '</div></div>';
        }).join('') +
      '</div>' +
      '<input class="admin-search" id="adminSearch" type="search" placeholder="Search by name, major, pledge class…" value="' + esc(state.q) + '">' +
      '<div id="q">Loading…</div>';

    document.getElementById('so').onclick = function () { Z.signOut().then(function () { renderLogin(''); }); };
    document.getElementById('tabs').querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { state.tab = b.dataset.tab; syncTabs(); renderList(); };
    });
    var srch = document.getElementById('adminSearch');
    srch.oninput = function () { state.q = srch.value.toLowerCase(); renderList(); };

    loadAll();
  }

  function syncTabs() {
    document.querySelectorAll('#tabs [data-tab]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === state.tab);
    });
  }

  function loadAll() {
    Promise.all([Z.listByStatus('pending'), Z.listByStatus('verified'), Z.listByStatus('rejected')])
      .then(function (res) {
        state.data.pending  = (res[0].data || []);
        state.data.verified = (res[1].data || []);
        state.data.rejected = (res[2].data || []);
        // Split the verified set: real approved accounts vs unclaimed roster names.
        state.data.approved  = state.data.verified.filter(function (b) { return b.user_id; });
        state.data.unclaimed = state.data.verified.filter(function (b) { return !b.user_id; });
        state.verifiedById = {};
        state.data.verified.forEach(function (b) { state.verifiedById[b.id] = b; });
        BRO_TABS.forEach(function (t) {
          var c = document.querySelector('.tab-count[data-count="' + t + '"]');
          if (c) c.textContent = state.data[t].length;
        });
        Z.suggestionsMine().then(function (rows) {
          setSuggestBadge(rows.filter(function (s) { return s.status === 'new'; }).length);
        }).catch(function () {});
        renderList();
      }).catch(function (e) {
        document.getElementById('q').innerHTML = '<p class="form-status err">' + esc(e.message || 'Load failed') + '</p>';
      });
  }

  function bigName(id) { var b = state.verifiedById[id]; return b ? b.full_name : null; }

  function renderList() {
    var q = document.getElementById('q');
    var srchEl = document.getElementById('adminSearch');
    if (srchEl) srchEl.style.display = BRO_TABS.indexOf(state.tab) !== -1 ? '' : 'none';
    if (state.tab === 'tree') return renderTreeTab(q);
    if (state.tab === 'eboard') return renderEboardTab(q);
    if (state.tab === 'committees') return renderCommitteesTab(q);
    if (state.tab === 'events') return renderEventsTab(q);
    if (state.tab === 'awards') return renderAwardsTab(q);
    if (state.tab === 'suggest') return renderSuggestTab(q);
    if (state.tab === 'stats') return renderStatsTab(q);
    if (state.tab === 'guide') return renderGuideTab(q);
    var rows = state.data[state.tab].slice();
    if (state.q) {
      rows = rows.filter(function (b) {
        return (b.full_name + ' ' + (b.major || '') + ' ' + (b.pledge_class || '')).toLowerCase().indexOf(state.q) !== -1;
      });
    }
    // Roster additions live on the Unclaimed tab (new rows are unclaimed names).
    var addBar = state.tab === 'unclaimed'
      ? '<div class="admin-addbar"><button class="btn btn--gold" id="addOne">+ Add brother</button>' +
        '<button class="btn btn--ghost" id="addClass">+ Add pledge class</button></div>'
      : '';
    var intro = '';
    if (state.tab === 'approved' && !state.q) intro = '<p class="admin-hint">Brothers with a linked email account, approved by you. Everyone else from the chapter records lives in <b>📋 Unclaimed</b>.</p>';
    if (state.tab === 'unclaimed' && !state.q) intro = '<p class="admin-hint">Roster names from the chapter records — in the tree and rosters, but no account linked yet. When a brother signs up and claims his name, he moves to <b>Pending</b> for your approval.</p>';

    if (!rows.length) {
      q.innerHTML = addBar + intro + '<p class="admin-empty">' + (state.q ? 'No matches.' : (state.tab === 'pending' ? '🎉 No pending profiles. All caught up.' : 'Nothing here yet.')) + '</p>';
      wireAddBar(q);
      return;
    }
    q.innerHTML = addBar + intro + rows.map(function (b) {
      var meta = [b.pledge_class, b.major, (b.grad_year ? "'" + String(b.grad_year).slice(-2) : null), (b.big_id && bigName(b.big_id) ? 'Big: ' + bigName(b.big_id) : null)].filter(Boolean).map(esc).join(' · ');
      return '<div class="admin-row" data-id="' + b.id + '">' +
        '<div class="admin-row__ph">' + (b.photo_url ? '<img src="' + esc(b.photo_url) + '" alt="">' : esc(initials(b.full_name))) + '</div>' +
        '<div class="admin-row__info"><b>' + esc(b.full_name) + ' ' + statusChip(b) + '</b><span>' + meta + '</span>' +
          (b.quote ? '<em>“' + esc(b.quote) + '”</em>' : '') + '</div>' +
        '<div class="admin-row__act">' + actionsFor(state.tab) + '</div></div>';
    }).join('');
    wireAddBar(q);

    q.querySelectorAll('.admin-row').forEach(function (el) {
      var id = el.dataset.id;
      var find = function (b) { return state.data[state.tab].filter(function (x) { return x.id === id; })[0]; };
      each(el, '[data-approve]', function () { setStatus(id, 'verified'); });
      each(el, '[data-reject]',  function () { if (confirm('Reject this profile?')) setStatus(id, 'rejected'); });
      each(el, '[data-revoke]',  function () { if (confirm('Move this brother back to Pending?')) setStatus(id, 'pending'); });
      each(el, '[data-restore]', function () { setStatus(id, 'pending'); });
      each(el, '[data-edit]',    function () { openEdit(find()); });
      each(el, '[data-delete]',  function () { if (confirm('Permanently delete ' + (find().full_name) + '? This cannot be undone.')) del(id); });
    });
  }
  function each(el, sel, fn) { var n = el.querySelector(sel); if (n) n.onclick = fn; }

  function actionsFor(tab) {
    if (tab === 'pending') return btn('approve', 'Approve', 'gold') + btn('reject', 'Reject', 'ghost') + btn('edit', 'Edit', 'ghost');
    if (tab === 'approved') return btn('revoke', 'Revoke', 'ghost') + btn('edit', 'Edit', 'ghost') + btn('delete', 'Delete', 'danger');
    if (tab === 'unclaimed') return btn('edit', 'Edit', 'ghost') + btn('delete', 'Delete', 'danger');
    return btn('restore', 'Restore', 'gold') + btn('delete', 'Delete', 'danger'); // rejected
  }
  function btn(action, label, kind) {
    var cls = kind === 'gold' ? 'btn btn--gold' : kind === 'danger' ? 'btn btn--danger' : 'btn btn--ghost';
    return '<button class="' + cls + '" data-' + action + '>' + label + '</button>';
  }

  function setStatus(id, status) { Z.setStatus(id, status).then(afterChange); }
  function del(id) { Z.deleteBrother(id).then(afterChange); }
  function afterChange(r) {
    if (r && r.error) { alert(r.error.message); return; }
    loadAll();
  }

  /* ---------------- edit modal ---------------- */
  function openEdit(b) {
    if (!b) return;
    var opts = ['<option value="">— none —</option>'].concat(
      state.data.verified.filter(function (v) { return v.id !== b.id; })
        .map(function (v) { return '<option value="' + v.id + '"' + (b.big_id === v.id ? ' selected' : '') + '>' + esc(v.full_name) + '</option>'; })
    ).join('');
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
      '<h3>Edit brother</h3>' +
      '<div class="form-row">' + fld('Full name', 'full_name', b.full_name) + fld('Pledge class', 'pledge_class', b.pledge_class) + '</div>' +
      '<div class="form-row">' + fld('Grad year', 'grad_year', b.grad_year, 'number') + fld('Major', 'major', b.major) + '</div>' +
      '<div class="form-row">' + fld('Hometown', 'hometown', b.hometown) + fld('Role (e-board)', 'role', b.role) + '</div>' +
      '<div class="form-row">' + fld('Role term', 'role_term', b.role_term) +
        '<div class="field"><label>Board (for the title)</label><select data-f="role_scope">' +
          ['', 'active', 'alumni', 'previous'].map(function (s) { return '<option value="' + s + '"' + ((b.role_scope || '') === s ? ' selected' : '') + '>' + (s || '— none —') + '</option>'; }).join('') +
        '</select></div></div>' +
      '<div class="form-row">' + fld('City', 'city', b.city) + fld('Occupation', 'occupation', b.occupation) + '</div>' +
      fld('Skills', 'skills', b.skills) +
      '<div class="field"><label>Big brother</label><select data-f="big_id">' + opts + '</select></div>' +
      '<div class="field"><label>Quote</label><input data-f="quote" value="' + esc(b.quote) + '"></div>' +
      '<div class="field"><label>Status</label><select data-f="status">' +
        ['pending', 'verified', 'rejected'].map(function (s) { return '<option' + (b.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
      '</select></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">Save changes</button>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = function () {
      var fields = {};
      wrap.querySelectorAll('[data-f]').forEach(function (i) {
        var k = i.dataset.f, v = i.value.trim();
        fields[k] = (k === 'grad_year') ? (v ? parseInt(v, 10) : null) : (v || null);
      });
      var st = wrap.querySelector('[data-status]');
      st.className = 'form-status'; st.textContent = 'Saving…';
      Z.updateBrother(b.id, fields).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); loadAll();
      });
    };
  }
  function fld(label, key, val, type) {
    return '<div class="field"><label>' + label + '</label><input data-f="' + key + '" type="' + (type || 'text') + '" value="' + esc(val) + '"></div>';
  }

  /* ---------------- events tab ---------------- */
  var EV_CATS = ['rush', 'philanthropy', 'reunion', 'meeting', 'social'];

  function renderEventsTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading events…</p>';
    Promise.all([Z.eventsList(), Z.getSetting('announcement')]).then(function (res) {
      var rows = res[0];
      var ann = res[1] || { text: '', link: '', active: false };
      state.events = rows;

      var annCard =
        '<div class="acct-block" style="margin-bottom:1.4rem"><h4>📣 Site announcement banner</h4>' +
        '<p class="form-note" style="margin-top:0">Shows as a gold strip at the top of every page — great for rush week, reunion tickets, or big news.</p>' +
        '<div class="form-row">' +
          '<div class="field"><label>Message</label><input id="annText" maxlength="140" value="' + esc(ann.text || '') + '" placeholder="e.g. 🎟️ Reunion Weekend tickets are live — Oct 12-14"></div>' +
          '<div class="field"><label>Link (optional)</label><input id="annLink" value="' + esc(ann.link || '') + '" placeholder="https://… or board.html"></div>' +
        '</div>' +
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap">' +
          '<button class="btn btn--gold" id="annShow">' + (ann.active ? 'Update banner' : 'Show banner') + '</button>' +
          (ann.active ? '<button class="btn btn--ghost" id="annHide">Hide banner</button>' : '') +
        '</div>' +
        '<p class="form-status" id="annStatus">' + (ann.active ? '● Banner is currently LIVE on the site.' : '') + '</p></div>';
      var list = rows.length ? rows.map(function (e) {
        var d = new Date(e.starts_at);
        var when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
          ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        var past = d.getTime() < Date.now();
        return '<div class="admin-row' + (past ? ' admin-row--past' : '') + '" data-ev="' + e.id + '">' +
          '<div class="admin-row__ph">📅</div>' +
          '<div class="admin-row__info"><b>' + esc(e.title) + (e.all_day ? ' <span class="tab-count">all-day</span>' : '') + '</b>' +
            '<span>' + esc(when) + (e.location ? ' · ' + esc(e.location) : '') + ' · ' + esc(e.category) + '</span></div>' +
          '<div class="admin-row__act">' + btn('evedit', 'Edit', 'ghost') + btn('evdel', 'Delete', 'danger') + '</div></div>';
      }).join('') : '<p class="admin-empty">No events yet — add the first one.</p>';

      q.innerHTML = annCard + '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="evNew">+ New event</button></p>' + list;
      document.getElementById('evNew').onclick = function () { openEventEdit(null); };

      function saveAnn(active) {
        var text = document.getElementById('annText').value.trim();
        var st = document.getElementById('annStatus');
        if (active && !text) { st.className = 'form-status err'; st.textContent = 'Write a message first.'; return; }
        Z.setSetting('announcement', { text: text, link: document.getElementById('annLink').value.trim(), active: active })
          .then(function (r) {
            if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
            renderList();
          });
      }
      document.getElementById('annShow').onclick = function () { saveAnn(true); };
      var annHide = document.getElementById('annHide');
      if (annHide) annHide.onclick = function () { saveAnn(false); };
      q.querySelectorAll('[data-ev]').forEach(function (el) {
        var ev = state.events.filter(function (x) { return x.id === el.dataset.ev; })[0];
        each(el, '[data-evedit]', function () { openEventEdit(ev); });
        each(el, '[data-evdel]', function () {
          if (confirm('Delete "' + ev.title + '"?')) Z.eventDelete(ev.id).then(function () { renderList(); });
        });
      });
    });
  }

  function toLocalInput(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openEventEdit(e) {
    e = e || {};
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
      '<h3>' + (e.id ? 'Edit event' : 'New event') + '</h3>' +
      '<div class="field"><label>Title *</label><input data-f="title" value="' + esc(e.title) + '"></div>' +
      '<div class="field"><label class="pref-box"><input type="checkbox" data-f="all_day"' + (e.all_day ? ' checked' : '') + '> All-day event (no start/end time)</label></div>' +
      '<div class="form-row">' +
        '<div class="field"><label>Starts *</label><input data-f="starts_at" type="datetime-local" value="' + toLocalInput(e.starts_at) + '"></div>' +
        '<div class="field"><label>Ends</label><input data-f="ends_at" type="datetime-local" value="' + toLocalInput(e.ends_at) + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="field"><label>Location</label><input data-f="location" value="' + esc(e.location) + '"></div>' +
        '<div class="field"><label>Category</label><select data-f="category">' +
          EV_CATS.map(function (c) { return '<option' + ((e.category || 'social') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>Description</label><textarea data-f="description">' + esc(e.description) + '</textarea></div>' +
      '<p class="form-note" style="margin:0 0 .8rem">🔒 The calendar is members-only — every event is visible to signed-in brothers.</p>' +
      '<button class="btn btn--navy" data-save style="width:100%">' + (e.id ? 'Save changes' : 'Create event') + '</button>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.addEventListener('click', function (ev2) { if (ev2.target === wrap || ev2.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      var get = function (k) { return wrap.querySelector('[data-f="' + k + '"]'); };
      var row = {
        title: get('title').value.trim(),
        all_day: get('all_day').checked,
        starts_at: get('starts_at').value ? new Date(get('starts_at').value).toISOString() : null,
        ends_at: get('ends_at').value ? new Date(get('ends_at').value).toISOString() : null,
        location: get('location').value.trim() || null,
        category: get('category').value,
        description: get('description').value.trim() || null
      };
      if (!row.title || !row.starts_at) { st.className = 'form-status err'; st.textContent = 'Title and start time are required.'; return; }
      st.className = 'form-status'; st.textContent = 'Saving…';
      (e.id ? Z.eventUpdate(e.id, row) : Z.eventCreate(row)).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); renderList();
      });
    };
  }

  /* ---------------- awards tab (Greek Excellence showcase) ---------------- */
  var PILLARS = [
    { id: 'community',      ic: '★', label: 'Community' },
    { id: 'service',        ic: '✚', label: 'Service' },
    { id: 'leadership',     ic: '♛', label: 'Leadership' },
    { id: 'responsibility', ic: '⚖', label: 'Responsibility' },
    { id: 'other',          ic: '◆', label: 'Other' }
  ];
  function pillarOf(id) { return PILLARS.filter(function (p) { return p.id === id; })[0] || PILLARS[4]; }

  function renderAwardsTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading awards…</p>';
    Z.awardsList().then(function (rows) {
      var years = [];
      rows.forEach(function (a) { if (years.indexOf(a.year_label) === -1) years.push(a.year_label); });
      var html = '<p class="admin-hint">These are the gold medallions in the <b>Recognized Excellence</b> section of the homepage. ' +
        'When SUNY Geneseo hands out next year\'s Greek awards, add them here — the homepage updates itself and older years become a little archive.</p>' +
        '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="awNew">+ Add award</button></p>';
      if (!rows.length) {
        html += '<p class="admin-empty">No awards saved yet — the homepage is showing its built-in 2024–25 badges. Add them here to take control.</p>';
      } else {
        years.forEach(function (y) {
          html += '<h4 class="aw-year">' + esc(y) + '</h4>' + rows.filter(function (a) { return a.year_label === y; }).map(function (a) {
            var p = pillarOf(a.pillar);
            return '<div class="admin-row" data-aw="' + a.id + '">' +
              '<div class="admin-row__ph">' + p.ic + '</div>' +
              '<div class="admin-row__info"><b>' + esc(a.title) + '</b><span>' + p.label + (a.note ? ' · ' + esc(a.note) : '') + '</span></div>' +
              '<div class="admin-row__act">' + btn('awedit', 'Edit', 'ghost') + btn('awdel', 'Delete', 'danger') + '</div></div>';
          }).join('');
        });
      }
      q.innerHTML = html;
      document.getElementById('awNew').onclick = function () { openAwardEdit(null, years[0] || ''); };
      q.querySelectorAll('[data-aw]').forEach(function (el) {
        var a = rows.filter(function (x) { return x.id === el.dataset.aw; })[0];
        each(el, '[data-awedit]', function () { openAwardEdit(a); });
        each(el, '[data-awdel]', function () {
          if (confirm('Delete "' + a.title + '" from the homepage?')) Z.awardDelete(a.id).then(function () { renderList(); });
        });
      });
    });
  }

  function openAwardEdit(a, presetYear) {
    a = a || {};
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
      '<h3>' + (a.id ? 'Edit award' : 'Add award') + '</h3>' +
      '<div class="form-row">' +
        '<div class="field"><label>Academic year *</label><input data-f="year_label" value="' + esc(a.year_label || presetYear || '') + '" placeholder="e.g. 2025–26"></div>' +
        '<div class="field"><label>Pillar</label><select data-f="pillar">' +
          PILLARS.map(function (p) { return '<option value="' + p.id + '"' + ((a.pillar || 'community') === p.id ? ' selected' : '') + '>' + p.ic + ' ' + p.label + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>Award title *</label><input data-f="title" value="' + esc(a.title) + '" placeholder="e.g. Greek Community Badge"></div>' +
      '<div class="field"><label>One-line note (optional)</label><input data-f="note" value="' + esc(a.note) + '" placeholder="e.g. Awarded for chapter-wide philanthropy hours"></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">' + (a.id ? 'Save changes' : 'Add to homepage') + '</button>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.addEventListener('click', function (ev2) { if (ev2.target === wrap || ev2.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = function () {
      var st = wrap.querySelector('[data-status]');
      var get = function (k) { return wrap.querySelector('[data-f="' + k + '"]'); };
      var row = {
        year_label: get('year_label').value.trim(),
        pillar: get('pillar').value,
        title: get('title').value.trim(),
        note: get('note').value.trim() || null
      };
      if (!row.year_label || !row.title) { st.className = 'form-status err'; st.textContent = 'Year and title are required.'; return; }
      st.className = 'form-status'; st.textContent = 'Saving…';
      (a.id ? Z.awardUpdate(a.id, row) : Z.awardCreate(row)).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); renderList();
      });
    };
  }

  /* ---------------- roster additions ---------------- */
  function wireAddBar(q) {
    var a = q.querySelector('#addOne'), c = q.querySelector('#addClass');
    if (a) a.onclick = openAddOne;
    if (c) c.onclick = openAddClass;
  }

  function bigOptions(selectedId) {
    return ['<option value="">— none / founder —</option>'].concat(
      state.data.verified.slice()
        .sort(function (x, y) { return x.full_name.localeCompare(y.full_name); })
        .map(function (v) {
          return '<option value="' + v.id + '"' + (selectedId === v.id ? ' selected' : '') + '>' +
            esc(v.full_name) + ' (' + esc(v.pledge_class || '') + ')</option>';
        })
    ).join('');
  }

  function openAddOne() {
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
      '<h3>Add a brother</h3>' +
      '<p class="form-note">Adds an unclaimed entry to the roster + family tree. If he later makes an account, he claims this name.</p>' +
      '<div class="form-row">' + fld('Full name *', 'full_name', '') + fld('Pledge class *', 'pledge_class', '') + '</div>' +
      '<div class="form-row">' + fld('Grad year (controls Active/Alumni)', 'grad_year', '', 'number') +
        '<div class="field"><label>Big brother</label><select data-f="big_id">' + bigOptions() + '</select></div></div>' +
      '<button class="btn btn--navy" data-save style="width:100%">Add to roster</button>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    wrap.querySelector('[data-save]').onclick = function () {
      var get = function (k) { return wrap.querySelector('[data-f="' + k + '"]'); };
      var st = wrap.querySelector('[data-status]');
      var name = get('full_name').value.trim(), cls = get('pledge_class').value.trim();
      if (!name || !cls) { st.className = 'form-status err'; st.textContent = 'Name and pledge class are required.'; return; }
      st.className = 'form-status'; st.textContent = 'Adding…';
      Z.addBrothers({
        full_name: name, pledge_class: cls,
        grad_year: get('grad_year').value ? parseInt(get('grad_year').value, 10) : null,
        big_id: get('big_id').value || null,
        roster_name: name, status: 'verified', user_id: null
      }).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); loadAll();
      });
    };
  }

  function openAddClass() {
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML =
      '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
      '<h3>Add a pledge class</h3>' +
      '<div data-step1>' +
        '<p class="form-note">Step 1 of 2 — name the class, then paste the new brothers (one name per line).</p>' +
        fld('Pledge class *', 'pledge_class', '') +
        '<div class="field"><label>New brothers (one per line) *</label><textarea data-f="names" rows="7" placeholder="First Last&#10;First Last&#10;…"></textarea></div>' +
        '<button class="btn btn--navy" data-next style="width:100%">Continue → assign bigs</button>' +
      '</div>' +
      '<div data-step2 style="display:none">' +
        '<p class="form-note">Step 2 of 2 — pick each brother\'s big.</p>' +
        '<div data-rows></div>' +
        '<button class="btn btn--navy" data-save style="width:100%">Add brothers</button>' +
      '</div>' +
      '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    var st = wrap.querySelector('[data-status]');
    var names = [], cls = '';

    wrap.querySelector('[data-next]').onclick = function () {
      cls = wrap.querySelector('[data-f="pledge_class"]').value.trim();
      names = wrap.querySelector('[data-f="names"]').value.split('\n')
        .map(function (s) { return s.trim(); }).filter(Boolean);
      if (!cls || !names.length) { st.className = 'form-status err'; st.textContent = 'Class name and at least one brother are required.'; return; }
      st.textContent = '';
      wrap.querySelector('[data-rows]').innerHTML = names.map(function (n, i) {
        return '<div class="form-row" style="align-items:center">' +
          '<div class="field"><label>' + (i === 0 ? 'Brother' : '&nbsp;') + '</label><input value="' + esc(n) + '" disabled></div>' +
          '<div class="field"><label>' + (i === 0 ? 'Big brother' : '&nbsp;') + '</label><select data-big="' + i + '">' + bigOptions() + '</select></div></div>';
      }).join('');
      wrap.querySelector('[data-step1]').style.display = 'none';
      wrap.querySelector('[data-step2]').style.display = '';
    };

    wrap.querySelector('[data-save]').onclick = function () {
      st.className = 'form-status'; st.textContent = 'Adding ' + names.length + ' brothers…';
      var rows = names.map(function (n, i) {
        var sel = wrap.querySelector('[data-big="' + i + '"]');
        return { full_name: n, pledge_class: cls, big_id: (sel && sel.value) || null,
                 roster_name: n, status: 'verified', user_id: null };
      });
      Z.addBrothers(rows).then(function (r) {
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        close(); loadAll();
      });
    };
  }

  /* ---------------- family tree editor tab ---------------- */
  function treeKids() {
    var kids = {};
    state.data.verified.forEach(function (b) {
      if (b.big_id) (kids[b.big_id] = kids[b.big_id] || []).push(b);
    });
    Object.keys(kids).forEach(function (k) {
      kids[k].sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
    });
    return kids;
  }
  function treeRoots() {
    var byId = state.verifiedById;
    var kids = treeKids();
    function descCount(b) {
      var n = 0;
      (kids[b.id] || []).forEach(function (k) { n += 1 + descCount(k); });
      return n;
    }
    return state.data.verified
      .filter(function (b) { return !b.big_id || !byId[b.big_id]; })
      .map(function (b) { b._desc = descCount(b); return b; })
      .sort(function (a, z) {
        var af = a._desc > 0 ? 0 : 1, zf = z._desc > 0 ? 0 : 1;
        return af - zf || a.full_name.localeCompare(z.full_name);
      });
  }

  function renderTreeTab(q) {
    var roots = treeRoots();
    var kids = treeKids();
    if (!roots.length) { q.innerHTML = '<p class="admin-empty">No brothers in the tree yet.</p>'; return; }
    if (!state.treeLine || !state.verifiedById[state.treeLine]) state.treeLine = roots[0].id;

    var chips = roots.map(function (r) {
      var last = r.full_name.trim().split(/\s+/).pop();
      return '<button class="fam-chip' + (state.treeLine === r.id ? ' on' : '') + '" data-line="' + r.id + '">' +
        esc(last) + ' line <i>' + (1 + r._desc) + '</i></button>';
    }).join('');

    var hint = localStorage.getItem('zbxi_treeed_hint') ? '' :
      '<div class="admin-hint admin-hint--tip" id="treeHint">👋 <b>First time here?</b> Pick a family line below, then use the buttons on each brother to fix names, move people, or add littles. Nothing here needs code — and every change shows on the public tree instantly. ' +
      '<a href="#" id="treeHintHelp">Full instructions</a> · <a href="#" id="treeHintX">Got it, hide this</a></div>';

    function rowHtml(b, depth) {
      var k = kids[b.id] || [];
      var html = '<div class="treeed-row" style="margin-left:' + (depth * 22) + 'px" data-id="' + b.id + '">' +
        '<span class="treeed-row__connector">' + (depth ? '└' : '🌳') + '</span>' +
        '<span class="treeed-row__name"><b>' + esc(b.full_name) + '</b><small>' + esc(b.pledge_class || '') +
          (k.length ? ' · ' + k.length + ' little' + (k.length > 1 ? 's' : '') : '') +
          (b.user_id ? ' · <i class="treeed-reg">● registered</i>' : '') + '</small></span>' +
        '<span class="treeed-row__act">' +
          '<button data-rn title="Fix this brother\'s name">Rename</button>' +
          '<button data-mv title="Move him under a different big">Change big</button>' +
          '<button data-al title="Add a new little under him">+ Little</button>' +
          '<button data-rm class="danger" title="Remove him from the tree">Remove</button>' +
        '</span></div>';
      k.forEach(function (c) { html += rowHtml(c, depth + 1); });
      return html;
    }

    var line = state.verifiedById[state.treeLine];
    q.innerHTML =
      '<div class="treeed-head"><p class="admin-hint" style="margin:0">Pick a family line, then edit any brother in place.</p>' +
      '<button class="btn btn--ghost" id="treeHelp">❓ How do I use this?</button></div>' +
      hint +
      '<div class="fam-bar" style="justify-content:flex-start;margin:0 0 1.2rem">' + chips + '</div>' +
      '<div class="treeed-list">' + rowHtml(line, 0) + '</div>';

    q.querySelectorAll('[data-line]').forEach(function (c) {
      c.onclick = function () { state.treeLine = c.dataset.line; renderTreeTab(q); };
    });
    document.getElementById('treeHelp').onclick = openTreeHelp;
    var hx = document.getElementById('treeHintX');
    if (hx) hx.onclick = function (e) { e.preventDefault(); localStorage.setItem('zbxi_treeed_hint', '1'); renderTreeTab(q); };
    var hh = document.getElementById('treeHintHelp');
    if (hh) hh.onclick = function (e) { e.preventDefault(); openTreeHelp(); };

    q.querySelectorAll('.treeed-row').forEach(function (el) {
      var b = state.verifiedById[el.dataset.id];
      each(el, '[data-rn]', function () { openTreeRename(b); });
      each(el, '[data-mv]', function () { openTreeMove(b); });
      each(el, '[data-al]', function () { openTreeAddLittle(b); });
      each(el, '[data-rm]', function () { openTreeRemove(b, (kids[b.id] || []).length); });
    });
  }

  function treeModal(title, bodyHtml) {
    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.innerHTML = '<div class="admin-modal__card"><button class="admin-modal__close" data-x>✕</button>' +
      '<h3>' + title + '</h3>' + bodyHtml + '<p class="form-status" data-status></p></div>';
    document.body.appendChild(wrap);
    wrap.close = function () { wrap.remove(); };
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-x]')) wrap.close(); });
    return wrap;
  }
  function treeDone(wrap) {
    return function (r) {
      var st = wrap.querySelector('[data-status]');
      if (r && r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
      wrap.close();
      loadAll(); // renderList() will re-render the tree tab
    };
  }

  function openTreeRename(b) {
    var wrap = treeModal('Rename ' + esc(b.full_name),
      '<p class="form-note">Fixes a typo or updates the name everywhere on the site (tree, rosters, profiles).</p>' +
      fld('Full name', 'full_name', b.full_name) +
      '<button class="btn btn--navy" data-save style="width:100%">Save name</button>');
    wrap.querySelector('[data-save]').onclick = function () {
      var name = wrap.querySelector('[data-f="full_name"]').value.trim();
      if (!name) return;
      var fields = { full_name: name };
      if (!b.user_id) fields.roster_name = name; // keep the claimable name in sync
      Z.updateBrother(b.id, fields).then(treeDone(wrap));
    };
  }

  function openTreeMove(b) {
    var wrap = treeModal('Who is ' + esc(b.full_name) + '\'s big?',
      '<p class="form-note">Type to search, pick the big, then save. He moves with all of his littles.</p>' +
      '<div class="field"><label>Search</label><input data-search placeholder="Start typing a name…"></div>' +
      '<div class="field"><label>New big</label><select data-f="big_id" size="6" style="height:auto">' + '</select></div>' +
      '<p class="form-note" data-preview></p>' +
      '<button class="btn btn--navy" data-save style="width:100%">Move him</button>');
    var sel = wrap.querySelector('[data-f="big_id"]');
    var preview = wrap.querySelector('[data-preview]');
    function fill(qstr) {
      var opts = state.data.verified
        .filter(function (v) { return v.id !== b.id && (!qstr || v.full_name.toLowerCase().indexOf(qstr) !== -1); })
        .sort(function (x, y) { return x.full_name.localeCompare(y.full_name); })
        .slice(0, 200);
      sel.innerHTML = '<option value="">— no big (top of a line) —</option>' + opts.map(function (v) {
        return '<option value="' + v.id + '"' + (b.big_id === v.id ? ' selected' : '') + '>' + esc(v.full_name) + ' (' + esc(v.pledge_class || '') + ')</option>';
      }).join('');
    }
    fill('');
    wrap.querySelector('[data-search]').oninput = function (e) { fill(e.target.value.trim().toLowerCase()); };
    sel.onchange = function () {
      var pick = state.verifiedById[sel.value];
      preview.textContent = pick ? esc(b.full_name) + ' will move under ' + pick.full_name + ' — his own littles come with him.' : '';
    };
    wrap.querySelector('[data-save]').onclick = function () {
      Z.updateBrother(b.id, { big_id: sel.value || null }).then(treeDone(wrap));
    };
  }

  function openTreeAddLittle(b) {
    var wrap = treeModal('Add a little under ' + esc(b.full_name),
      '<div class="form-row">' + fld('Full name *', 'full_name', '') + fld('Pledge class *', 'pledge_class', '') + '</div>' +
      fld('Grad year (controls Active/Alumni)', 'grad_year', '', 'number') +
      '<button class="btn btn--navy" data-save style="width:100%">Add little</button>');
    wrap.querySelector('[data-save]').onclick = function () {
      var get = function (k) { return wrap.querySelector('[data-f="' + k + '"]').value.trim(); };
      var st = wrap.querySelector('[data-status]');
      if (!get('full_name') || !get('pledge_class')) { st.className = 'form-status err'; st.textContent = 'Name and pledge class are required.'; return; }
      Z.addBrothers({
        full_name: get('full_name'), pledge_class: get('pledge_class'),
        grad_year: get('grad_year') ? parseInt(get('grad_year'), 10) : null,
        big_id: b.id, roster_name: get('full_name'), status: 'verified', user_id: null
      }).then(treeDone(wrap));
    };
  }

  function openTreeRemove(b, littleCount) {
    var wrap = treeModal('Remove ' + esc(b.full_name) + '?',
      '<p class="form-note">This takes him off the tree and rosters entirely.' +
      (littleCount ? ' He has <b>' + littleCount + ' little' + (littleCount > 1 ? 's' : '') + '</b>.' : '') + '</p>' +
      (littleCount ? '<div class="field"><label class="pref-box"><input type="checkbox" data-f="reassign" checked> Give his littles to his big (recommended — keeps the line connected)</label></div>' : '') +
      '<button class="btn btn--danger" data-save style="width:100%">Yes, remove him</button>');
    wrap.querySelector('[data-save]').onclick = function () {
      var reassignEl = wrap.querySelector('[data-f="reassign"]');
      var doDelete = function () { Z.deleteBrother(b.id).then(treeDone(wrap)); };
      if (reassignEl && reassignEl.checked) {
        var kids = treeKids()[b.id] || [];
        Promise.all(kids.map(function (k) { return Z.updateBrother(k.id, { big_id: b.big_id || null }); }))
          .then(doDelete);
      } else doDelete();
    };
  }

  function openTreeHelp() {
    treeModal('🌳 How to edit the family tree', '<div class="treeed-help">' +
      '<p><b>1 · Pick a family line.</b> The buttons at the top are the founding-father lines. Click one to see everyone in it, indented big → little.</p>' +
      '<p><b>2 · Fix a name.</b> Click <b>Rename</b> on the brother, type the correction, save. It updates everywhere on the site instantly.</p>' +
      '<p><b>3 · Move someone.</b> Click <b>Change big</b>, search for the correct big, save. He moves with all of his littles — nothing gets lost.</p>' +
      '<p><b>4 · Add a brother.</b> Find his big and click <b>+ Little</b>. (Adding a whole pledge class at once? Use the 📋 Unclaimed tab → “+ Add pledge class”.)</p>' +
      '<p><b>5 · Remove someone.</b> Click <b>Remove</b>. If he has littles, keep the box checked and they reconnect to his big automatically.</p>' +
      '<p style="color:var(--muted)">Every change is live on the public Family Tree the moment you save. You can\'t break anything that can\'t be fixed with the same buttons.</p></div>');
  }

  /* ---------------- e-board tab ---------------- */
  var SEAT_TITLES = ['President', 'Vice-President', 'Treasurer', 'Secretary'];

  function officersCommitteeId() {
    return Z.committeesList().then(function (cs) {
      var c = cs.filter(function (x) { return x.name === 'E-Board Officers'; })[0];
      return c ? c.id : null;
    });
  }
  function syncOfficer(brother, add) {
    if (!brother || !brother.user_id) return Promise.resolve();
    return officersCommitteeId().then(function (cid) {
      if (!cid) return;
      return add ? Z.committeeAdd(cid, brother.user_id) : Z.committeeRemove(cid, brother.user_id);
    });
  }

  function renderEboardTab(q) {
    function holder(scope, title) {
      return state.data.verified.filter(function (b) { return b.role === title && b.role_scope === scope; })[0];
    }
    function panel(scope, label) {
      return '<div class="acct-block"><h4>' + label + '</h4>' +
        SEAT_TITLES.map(function (t) {
          var h = holder(scope, t);
          return '<div class="seat-row">' +
            '<span class="seat-row__title">' + t + '</span>' +
            (h ? '<span class="seat-row__who"><b>' + esc(h.full_name) + '</b><small>' + esc(h.role_term || '') + '</small></span>'
               : '<span class="seat-row__who seat-row__who--empty">— open seat —</span>') +
            '<span class="seat-row__act">' +
              '<button class="btn btn--gold" data-assign="' + scope + '|' + t + '">' + (h ? 'Replace' : 'Assign') + '</button>' +
              (h ? '<button class="btn btn--ghost" data-retire="' + h.id + '">Retire</button>' : '') +
            '</span></div>';
        }).join('') + '</div>';
    }

    var prev = state.data.verified.filter(function (b) { return b.role && b.role_scope === 'previous'; })
      .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });

    q.innerHTML =
      '<p class="admin-hint">The Active and Alumni boards are separate. Assigning a seat moves the previous holder to “Previous officers” automatically, and current officers are kept in the private <b>E-Board Officers</b> committee on the Board.</p>' +
      panel('active', '🎓 Active Brothers Executive Board') +
      panel('alumni', '🌍 Alumni Brothers Executive Board') +
      '<div class="acct-block acct-block--danger"><h4>🔄 Semester rollover</h4>' +
        '<p class="form-note">Run once each semester: every current officer (both boards) moves to Previous officers and the Officers committee is emptied. Then assign the new boards above and add the new pledge class in 📋 Unclaimed.</p>' +
        '<button class="btn btn--ghost-danger" id="rolloverBtn">Run semester rollover</button>' +
        '<p class="form-status" id="rolloverStatus"></p></div>' +
      '<h3 class="stat-h">Previous officers (' + prev.length + ')</h3>' +
      (prev.length ? '<div class="stat-list">' + prev.map(function (b) {
        return '<div class="stat-list__row"><b>' + esc(b.full_name) + '</b><span>' + esc(b.role) + (b.role_term ? ' · ' + esc(b.role_term) : '') + '</span>' +
          '<em><a href="#" data-cleartitle="' + b.id + '">clear title</a></em></div>';
      }).join('') + '</div>' : '<p class="admin-empty">No previous officers recorded yet.</p>');

    q.querySelectorAll('[data-assign]').forEach(function (b) {
      b.onclick = function () {
        var parts = b.dataset.assign.split('|');
        openAssignSeat(parts[0], parts[1]);
      };
    });
    q.querySelectorAll('[data-retire]').forEach(function (b) {
      b.onclick = function () {
        var h = state.verifiedById[b.dataset.retire];
        if (!h || !confirm('Retire ' + h.full_name + ' to Previous officers?')) return;
        Z.updateBrother(h.id, { role_scope: 'previous' })
          .then(function () { return syncOfficer(h, false); })
          .then(loadAll);
      };
    });
    q.querySelectorAll('[data-cleartitle]').forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var h = state.verifiedById[a.dataset.cleartitle];
        if (!h || !confirm('Remove the title from ' + h.full_name + ' entirely?')) return;
        Z.updateBrother(h.id, { role: null, role_term: null, role_scope: null }).then(loadAll);
      };
    });
    var ro = document.getElementById('rolloverBtn');
    if (ro) ro.onclick = function () {
      if (!confirm('Semester rollover: move ALL current officers (both boards) to Previous officers and empty the Officers committee?')) return;
      var st = document.getElementById('rolloverStatus');
      st.className = 'form-status'; st.textContent = 'Rolling over…';
      var officers = state.data.verified.filter(function (b) { return b.role && (b.role_scope === 'active' || b.role_scope === 'alumni'); });
      Promise.all(officers.map(function (b) { return Z.updateBrother(b.id, { role_scope: 'previous' }); }))
        .then(function () { return officersCommitteeId(); })
        .then(function (cid) {
          if (!cid) return;
          return Promise.all(officers.filter(function (b) { return b.user_id; })
            .map(function (b) { return Z.committeeRemove(cid, b.user_id); }));
        })
        .then(loadAll);
    };
  }

  function openAssignSeat(scope, title) {
    var boardName = scope === 'active' ? 'Active' : 'Alumni';
    var wrap = treeModal('Assign ' + title + ' — ' + boardName + ' E-Board',
      '<div class="field"><label>Search brothers</label><input data-search placeholder="Start typing a name…"></div>' +
      '<div class="field"><label>Brother</label><select data-f="who" size="6" style="height:auto"></select></div>' +
      fld('Term', 'role_term', '') +
      '<p class="form-note" data-preview></p>' +
      '<button class="btn btn--navy" data-save style="width:100%">Assign seat</button>');
    var sel = wrap.querySelector('[data-f="who"]');
    function fill(qs) {
      var opts = state.data.verified
        .filter(function (v) { return !qs || v.full_name.toLowerCase().indexOf(qs) !== -1; })
        .sort(function (x, y) { return x.full_name.localeCompare(y.full_name); }).slice(0, 200);
      sel.innerHTML = opts.map(function (v) {
        return '<option value="' + v.id + '">' + esc(v.full_name) + ' (' + esc(v.pledge_class || '') + ')</option>';
      }).join('');
    }
    fill('');
    wrap.querySelector('[data-search]').oninput = function (e) { fill(e.target.value.trim().toLowerCase()); };
    wrap.querySelector('[data-save]').onclick = function () {
      var pick = state.verifiedById[sel.value];
      var st = wrap.querySelector('[data-status]');
      if (!pick) { st.className = 'form-status err'; st.textContent = 'Pick a brother first.'; return; }
      var term = wrap.querySelector('[data-f="role_term"]').value.trim() || null;
      var displaced = state.data.verified.filter(function (b) {
        return b.id !== pick.id && b.role === title && b.role_scope === scope;
      })[0];
      st.className = 'form-status'; st.textContent = 'Assigning…';
      var steps = Promise.resolve();
      if (displaced) {
        steps = steps.then(function () { return Z.updateBrother(displaced.id, { role_scope: 'previous' }); })
          .then(function () { return syncOfficer(displaced, false); });
      }
      steps.then(function () { return Z.updateBrother(pick.id, { role: title, role_term: term, role_scope: scope }); })
        .then(function () { return syncOfficer(pick, true); })
        .then(function () { wrap.close(); loadAll(); });
    };
  }

  /* ---------------- committees tab ---------------- */
  function renderCommitteesTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading committees…</p>';
    Z.committeesList().then(function (cs) {
      q.innerHTML =
        '<p class="admin-hint">Each committee gets a private space on the Board that only its members (and you) can see. Only brothers with accounts can be added.</p>' +
        '<div class="admin-addbar"><button class="btn btn--gold" id="commNew">+ New committee</button></div>' +
        (cs.length ? cs.map(function (c) {
          return '<div class="admin-row" data-comm="' + c.id + '">' +
            '<div class="admin-row__ph">👥</div>' +
            '<div class="admin-row__info"><b>' + esc(c.name) + '</b><span data-commcount>…</span></div>' +
            '<div class="admin-row__act">' +
              '<button class="btn btn--ghost" data-members>Members</button>' +
              '<button class="btn btn--danger" data-del>Delete</button>' +
            '</div></div>';
        }).join('') : '<p class="admin-empty">No committees yet.</p>');

      document.getElementById('commNew').onclick = function () {
        var name = prompt('Committee name (e.g. Rush Committee):');
        if (!name || !name.trim()) return;
        Z.committeeCreate(name.trim()).then(function () { renderList(); });
      };
      q.querySelectorAll('[data-comm]').forEach(function (el) {
        var c = cs.filter(function (x) { return x.id === el.dataset.comm; })[0];
        Z.committeeMembers(c.id).then(function (ids) {
          el.querySelector('[data-commcount]').textContent = ids.length + ' member' + (ids.length === 1 ? '' : 's');
        });
        each(el, '[data-members]', function () { openCommitteeMembers(c); });
        each(el, '[data-del]', function () {
          if (confirm('Delete "' + c.name + '"? Its private threads are deleted too.')) Z.committeeDelete(c.id).then(function () { renderList(); });
        });
      });
    });
  }

  function openCommitteeMembers(c) {
    var registered = state.data.verified.filter(function (b) { return b.user_id; });
    var wrap = treeModal('👥 ' + esc(c.name),
      '<div class="field"><label>Add a brother (accounts only)</label><select data-f="add">' +
        '<option value="">— pick a brother —</option>' +
        registered.sort(function (x, y) { return x.full_name.localeCompare(y.full_name); })
          .map(function (b) { return '<option value="' + b.user_id + '">' + esc(b.full_name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div data-list><p class="form-note">Loading members…</p></div>');
    function refreshList() {
      Z.committeeMembers(c.id).then(function (ids) {
        var box = wrap.querySelector('[data-list]');
        if (!ids.length) { box.innerHTML = '<p class="form-note">No members yet.</p>'; return; }
        box.innerHTML = ids.map(function (uid) {
          var b = registered.filter(function (x) { return x.user_id === uid; })[0];
          return '<div class="stat-list__row"><b>' + esc(b ? b.full_name : 'Unknown account') + '</b>' +
            '<em><a href="#" data-rm="' + uid + '">remove</a></em></div>';
        }).join('');
        box.querySelectorAll('[data-rm]').forEach(function (a) {
          a.onclick = function (e) {
            e.preventDefault();
            Z.committeeRemove(c.id, a.dataset.rm).then(refreshList);
          };
        });
      });
    }
    refreshList();
    wrap.querySelector('[data-f="add"]').onchange = function (e) {
      if (!e.target.value) return;
      Z.committeeAdd(c.id, e.target.value).then(function () { e.target.value = ''; refreshList(); });
    };
  }

  /* ---------------- suggestions tab ---------------- */
  function renderSuggestTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading suggestions…</p>';
    Z.suggestionsMine().then(function (rows) { // RLS: admin sees all
      var groups = { new: [], responded: [], archived: [] };
      rows.forEach(function (s) { (groups[s.status] || groups.new).push(s); });
      setSuggestBadge(groups.new.length);

      function block(title, list, showActions) {
        if (!list.length) return '';
        return '<h3 class="stat-h">' + title + ' (' + list.length + ')</h3>' + list.map(function (s) {
          var d = new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return '<div class="sug-card" data-sug="' + s.id + '">' +
            '<p class="sug-card__body">' + esc(s.body) + '</p>' +
            '<small>' + d + '</small>' +
            (s.response ? '<p class="sug-card__resp">↩ ' + esc(s.response) + '</p>' : '') +
            (showActions
              ? '<div class="sug-card__act">' +
                  '<textarea data-resp placeholder="Write a response — the brother gets a 🔔"></textarea>' +
                  '<div><button class="btn btn--gold" data-send>Respond</button>' +
                  '<button class="btn btn--ghost" data-arch>Archive</button></div></div>'
              : '<div class="sug-card__act"><button class="btn btn--ghost" data-arch>Archive</button></div>') +
          '</div>';
        }).join('');
      }

      q.innerHTML = (rows.length
        ? block('🆕 New', groups.new, true) + block('✅ Responded', groups.responded, false) + block('📦 Archived', groups.archived, false)
        : '<p class="admin-empty">No suggestions yet — brothers submit them from the Board page.</p>');

      q.querySelectorAll('[data-sug]').forEach(function (el) {
        var id = el.dataset.sug;
        var send = el.querySelector('[data-send]');
        if (send) send.onclick = function () {
          var resp = el.querySelector('[data-resp]').value.trim();
          if (!resp) return;
          Z.suggestionUpdate(id, { response: resp, status: 'responded', responded_at: new Date().toISOString() })
            .then(function () { renderList(); });
        };
        var arch = el.querySelector('[data-arch]');
        if (arch) arch.onclick = function () {
          Z.suggestionUpdate(id, { status: 'archived' }).then(function () { renderList(); });
        };
      });
    });
  }

  function setSuggestBadge(n) {
    var b = document.querySelector('.tab-count[data-count="suggest"]');
    if (!b) return;
    b.style.display = n ? '' : 'none';
    b.textContent = n;
  }

  /* ---------------- guide tab ---------------- */
  function renderGuideTab(q) {
    function sec(title, body) {
      return '<details class="guide-sec"><summary>' + title + '</summary><div>' + body + '</div></details>';
    }
    q.innerHTML =
      '<div class="guide-intro"><h3>Webmaster guide</h3><p>Everything you need to run this site lives in this console — no coding, ever. Click a task:</p></div>' +
      sec('✅ A new brother made an account — approve him', '<ol>' +
        '<li>Open the <b>Pending</b> tab (the number shows how many are waiting — the 🔔 bell also alerts you).</li>' +
        '<li>Check the name/pledge class look right (edit if needed).</li>' +
        '<li>Click <b>Approve</b>. He\'s instantly live on the roster, family tree, gallery and board.</li></ol>' +
        '<p>Not a real brother? Click <b>Reject</b> — they never appear publicly.</p>') +
      sec('🔒 Who can see what (site privacy)', '<ul>' +
        '<li><b>The public</b> sees the homepage, events, and a demo family tree with fake names — no real brother names anywhere.</li>' +
        '<li><b>Anyone with an account</b> (even before you approve them) can see names and the real tree — they need that to claim their own name.</li>' +
        '<li><b>Approved brothers</b> see everything: full profiles, photos, gallery, board, directory.</li></ul>') +
      sec('🗂️ What the tabs mean', '<ul>' +
        '<li><b>Pending</b> — brothers who signed up (or claimed a name) and are waiting for your approval.</li>' +
        '<li><b>Approved</b> — brothers with a real account, approved by you. These are your active members.</li>' +
        '<li><b>📋 Unclaimed</b> — every roster name from the chapter records that nobody has claimed yet. They show on the public tree/rosters, just without an account behind them.</li>' +
        '<li><b>Rejected</b> — declined signups; restorable anytime.</li></ul>') +
      sec('➕ Add one brother to the roster / family tree', '<ol>' +
        '<li>Go to the <b>📋 Unclaimed</b> tab → click <b>+ Add brother</b>. (Or use the <b>🌳 Tree</b> tab → “+ Little” on his big.)</li>' +
        '<li>Enter his name, pledge class, grad year, and pick his big.</li>' +
        '<li>He appears in the tree immediately as “unclaimed” — if he later signs up, he claims his own name.</li></ol>') +
      sec('🎓 Add a whole new pledge class (each semester)', '<ol>' +
        '<li><b>📋 Unclaimed</b> tab → <b>+ Add pledge class</b>.</li>' +
        '<li>Type the class name (e.g. “Gamma Sigma · Fall \'26”), paste the names one per line.</li>' +
        '<li>On step 2, pick each new brother\'s big → <b>Add brothers</b>. Done — tree and rosters update instantly.</li></ol>') +
      sec('🔁 Someone shows on the wrong page (Active vs Alumni)', '<p>The site decides automatically from the <b>grad year</b>: future grad year = Active page, past = Alumni page. The green/gray chip next to each name here shows the current result.</p>' +
        '<ol><li>Find the brother (search box) → <b>Edit</b>.</li><li>Fix the <b>Grad year</b> → Save. The chip and the public pages flip immediately.</li></ol>') +
      sec('🌳 Fix the family tree (wrong big, typo, add/remove someone)', '<p>Use the dedicated <b>🌳 Tree</b> tab — it shows each family line as an indented list with plain buttons on every brother: <b>Rename</b>, <b>Change big</b>, <b>+ Little</b>, <b>Remove</b>. There\'s a “❓ How do I use this?” button inside with step-by-step instructions. Every save is live on the public tree instantly.</p>') +
      sec('👑 Run the executive boards', '<p>Use the <b>👑 E-Board</b> tab. The Active and Alumni boards are separate — each has four seats. Click <b>Assign</b> on a seat, pick the brother and term; the previous holder automatically moves to “Previous officers” (shown on the Alumni page with title filters). Each semester, hit <b>🔄 Semester rollover</b> once, then assign the new boards.</p>') +
      sec('👥 Committees & private spaces', '<p><b>👥 Committees</b> tab: create a committee (e.g. Rush Committee), add brothers with accounts. Each committee gets a private space on the Board that only its members and you can see. Current officers are auto-kept in the “E-Board Officers” committee.</p>') +
      sec('🗳️ Post a poll', '<p>On the <b>Board</b> page (signed in as admin) → 🗳️ Polls tab → “+ New poll”. Brothers get one vote each and can change it until the poll closes.</p>') +
      sec('💡 Answer suggestions', '<p>Brothers drop ideas in the Suggestion box on the Board page. They land in your <b>💡 Suggestions</b> tab (badge = new ones). Write a response — the brother gets a 🔔 — or archive it.</p>') +
      sec('🤝 Networking & Connect (runs itself)', '<p>Brothers fill in industry, company, and LinkedIn on their profiles, and can raise "I\'m open to…" badges (🎓 mentoring · 💼 hiring · 🤝 connecting). On any brother\'s card, the <b>Connect</b> button drops the requester\'s name + email into the other brother\'s 🔔 so he can reply directly by email.</p><ul>' +
        '<li><b>Nothing for you to moderate</b> — there\'s no inbox or chat, just intro requests.</li>' +
        '<li>Built-in anti-spam: one request per brother per recipient per week.</li>' +
        '<li>All of it is members-only; the public never sees contact details.</li>' +
        '<li>Members have their own “❓ How networking works” guide on the Alumni page.</li></ul>' +
        '<p><b>🎓 Request a mentor:</b> an active picks a field on the Alumni page and up to <b>five</b> alumni who volunteered to mentor in it get a 🔔 with his name and email. Capped and rate-limited (one request per brother per week) so nobody gets spammed. If nobody has raised the mentoring flag in that field yet, he\'s told to reach out directly instead.</p>' +
        '<p><b>🧭 Discover rails:</b> on the Active/Alumni pages, brothers automatically see others who share their industry or city. Nothing to configure — it fills in as brothers complete their profiles.</p>') +
      sec('📅 Run the chapter calendar', '<p>The calendar is <b>members-only</b> — the public sees a sign-in card instead. Two ways to add events:</p><ul>' +
        '<li><b>Right on the calendar</b> (easiest): sign in on the homepage, click any day, press <b>＋ Add event on this day</b>. Use ✎ Edit / 🗑 Delete on an event to change it in place.</li>' +
        '<li><b>Here in the console</b>: <b>Events</b> tab → <b>+ New event</b> (same fields, plus the announcement banner editor).</li></ul>' +
        '<p>Tick <b>All-day</b> for things without a start time. If you type a location, it becomes a map link automatically. Brothers RSVP with one tap so you know who\'s coming.</p>') +
      sec('🏅 Update the Greek Excellence awards', '<p>The gold medallions on the homepage come from the <b>🏅 Awards</b> tab. When Geneseo announces next year\'s Greek awards: <b>+ Add award</b> → type the year (e.g. “2025–26”), pick the pillar, give it its title. The homepage switches to the newest year automatically and keeps older years as an archive you can flip through.</p>') +
      sec('🌳 The tree explorer (what brothers see)', '<p>On the homepage, brothers can drag the tree with a finger or mouse, <b>pinch or scroll to zoom</b>, use the toolbar at the bottom of the tree, and press <b>⛶</b> for a fullscreen view. The dropdown above the tree picks a family line. None of that needs your attention — it just works.</p>') +
      sec('🛡️ Moderate the gallery & board', '<p>Sign in on the main site as admin — you can delete <b>any</b> gallery post, comment, board thread, or reply (delete links appear for you on each item). Brothers can attach photos to threads and react 👍 ❤️ 😂 to replies; deleting a thread or reply removes its photo and reactions with it.</p>') +
      sec('📊 Check engagement', '<p><b>Stats</b> tab: registrations, pending queue, 30-day activity, recent sign-ins, and a full activity log.</p>') +
      sec('🔑 Account & handoff basics', '<ul>' +
        '<li>This console only works for the admin email (currently zbxi.web@gmail.com). Handing off = handing over that Google account (see OWNERSHIP.md in the project).</li>' +
        '<li>Brothers who forget passwords use “Forgot your password?” on the site — you never manage their passwords.</li>' +
        '<li>The site itself (hosting, domain) runs itself — nothing to renew except the domain (~$12/yr at Namecheap).</li></ul>');
  }

  /* ---------------- stats tab ---------------- */
  var ACT_LABEL = {
    profile_created: 'created a profile', profile_updated: 'updated a profile',
    gallery_post: 'posted to the gallery', gallery_comment: 'commented on a photo',
    thread_created: 'started a discussion', reply_posted: 'replied to a discussion'
  };

  function renderStatsTab(q) {
    q.innerHTML = '<p class="admin-empty">Crunching the numbers…</p>';
    Promise.all([Z.adminStats(), Z.activityList(50)]).then(function (res) {
      var s = res[0] || {}, acts = res[1] || [];
      if (s.error) { q.innerHTML = '<p class="form-status err">' + esc(s.error) + '</p>'; return; }
      function statCard(n, label) {
        return '<div class="stat-card"><b>' + (n == null ? '—' : n) + '</b><span>' + label + '</span></div>';
      }
      var engagement30 = (s.posts_30d || 0) + (s.comments_30d || 0) + (s.likes_30d || 0) + (s.threads_30d || 0) + (s.replies_30d || 0);
      var html =
        '<div class="stat-grid">' +
          statCard(s.total, 'brothers in the tree') +
          statCard(s.registered, 'registered accounts') +
          statCard(s.pending, 'awaiting review') +
          statCard(s.verified, 'verified') +
          statCard(engagement30, 'actions in 30 days') +
          statCard(s.posts_30d, 'gallery posts / 30d') +
          statCard((s.threads_30d || 0) + (s.replies_30d || 0), 'board activity / 30d') +
          statCard(s.accounts, 'total logins created') +
        '</div>';

      var signins = (s.recent_signins || []);
      if (signins.length) {
        html += '<h3 class="stat-h">Recent sign-ins</h3><div class="stat-list">' + signins.map(function (u) {
          var d = u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
          return '<div class="stat-list__row"><b>' + esc(u.name || u.email) + '</b><span>' + esc(u.email) + '</span><em>' + d + '</em></div>';
        }).join('') + '</div>';
      }

      /* ---- monthly engagement digest ---- */
      var monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      var nameOf = function (uid) {
        var all = state.data.pending.concat(state.data.verified, state.data.rejected);
        var b = all.filter(function (x) { return x.user_id === uid; })[0];
        return b ? b.full_name : null;
      };
      var monthActs = acts.filter(function (a) { return new Date(a.created_at).getTime() >= monthStart; });
      var byActor = {};
      monthActs.forEach(function (a) { if (a.user_id) byActor[a.user_id] = (byActor[a.user_id] || 0) + 1; });
      var top = Object.keys(byActor).map(function (uid) { return { name: nameOf(uid) || 'A brother', n: byActor[uid] }; })
        .sort(function (a, z) { return z.n - a.n; }).slice(0, 5);
      var newRegs = monthActs.filter(function (a) { return a.action === 'profile_created'; }).length;
      var nudge = state.data.verified.filter(function (b) { return b.user_id && (!b.photo_url || !b.bio); });

      html += '<h3 class="stat-h">📬 This month</h3><div class="stat-list">' +
        '<div class="stat-list__row"><b>New profiles</b><span>' + newRegs + ' created this month</span><em></em></div>' +
        '<div class="stat-list__row"><b>Top contributors</b><span>' +
          (top.length ? top.map(function (t) { return esc(t.name) + ' (' + t.n + ')'; }).join(' · ') : 'no member activity yet') +
        '</span><em></em></div>' +
        '<div class="stat-list__row"><b>Worth a nudge</b><span>' +
          (nudge.length ? nudge.length + ' registered brothers missing a photo or bio: ' +
            esc(nudge.slice(0, 4).map(function (b) { return b.full_name; }).join(', ')) + (nudge.length > 4 ? '…' : '')
          : 'every registered profile is complete 🎉') +
        '</span><em></em></div></div>';

      html += '<p style="margin:1.4rem 0 0"><button class="btn btn--ghost" id="exportCsv">⬇ Export roster (CSV)</button> ' +
        '<span style="color:#cdd6e6;font-size:.82rem">Backup of every brother — opens in Excel/Sheets.</span></p>';

      html += '<h3 class="stat-h">Activity log</h3>';
      html += acts.length ? '<div class="stat-list">' + acts.map(function (a) {
        var d = new Date(a.created_at);
        var when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return '<div class="stat-list__row"><b>' + esc(ACT_LABEL[a.action] || a.action) + '</b><span>' + esc(a.detail || '') + '</span><em>' + when + '</em></div>';
      }).join('') + '</div>' : '<p class="admin-empty">No activity recorded yet.</p>';

      q.innerHTML = html;

      var exp = document.getElementById('exportCsv');
      if (exp) exp.onclick = function () {
        var all = state.data.pending.concat(state.data.verified, state.data.rejected);
        var cols = ['full_name', 'pledge_class', 'grad_year', 'big', 'status', 'registered', 'role', 'role_term', 'major', 'city', 'occupation', 'hometown', 'email', 'phone', 'skills'];
        var csvEsc = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var lines = [cols.join(',')].concat(all.map(function (b) {
          return cols.map(function (c) {
            if (c === 'big') return csvEsc(b.big_id && bigName(b.big_id) || '');
            if (c === 'registered') return b.user_id ? 'yes' : 'no';
            return csvEsc(b[c]);
          }).join(',');
        }));
        var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'zbxi-roster-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      };
    }).catch(function (e2) {
      q.innerHTML = '<p class="form-status err">' + esc(e2.message || 'Could not load stats — run supabase/upgrade3.sql first.') + '</p>';
    });
  }

  gate();
})();
