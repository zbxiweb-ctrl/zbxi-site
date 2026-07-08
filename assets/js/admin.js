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
      { id: 'tree',   label: '🌳 Tree'  },
      { id: 'events', label: 'Events'   },
      { id: 'stats',  label: 'Stats'    },
      { id: 'guide',  label: '📖 Guide' }
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
      '<div class="admin-head"><h2>Brotherhood Admin</h2><button class="btn btn--ghost" id="so">Sign out</button></div>' +
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
    if (state.tab === 'events') return renderEventsTab(q);
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
      '<div class="form-row">' + fld('Role term', 'role_term', b.role_term) + fld('City', 'city', b.city) + '</div>' +
      '<div class="form-row">' + fld('Occupation', 'occupation', b.occupation) + fld('Skills', 'skills', b.skills) + '</div>' +
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
    Z.eventsList().then(function (rows) {
      state.events = rows;
      var list = rows.length ? rows.map(function (e) {
        var d = new Date(e.starts_at);
        var when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
          ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        var past = d.getTime() < Date.now();
        return '<div class="admin-row' + (past ? ' admin-row--past' : '') + '" data-ev="' + e.id + '">' +
          '<div class="admin-row__ph">📅</div>' +
          '<div class="admin-row__info"><b>' + esc(e.title) + (e.is_public ? '' : ' <span class="tab-count">members only</span>') + '</b>' +
            '<span>' + esc(when) + (e.location ? ' · ' + esc(e.location) : '') + ' · ' + esc(e.category) + '</span></div>' +
          '<div class="admin-row__act">' + btn('evedit', 'Edit', 'ghost') + btn('evdel', 'Delete', 'danger') + '</div></div>';
      }).join('') : '<p class="admin-empty">No events yet — add the first one.</p>';

      q.innerHTML = '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="evNew">+ New event</button></p>' + list;
      document.getElementById('evNew').onclick = function () { openEventEdit(null); };
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
      '<div class="field"><label class="pref-box"><input type="checkbox" data-f="is_public"' + (e.is_public === false ? '' : ' checked') + '> Visible to the public (uncheck = members only)</label></div>' +
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
        starts_at: get('starts_at').value ? new Date(get('starts_at').value).toISOString() : null,
        ends_at: get('ends_at').value ? new Date(get('ends_at').value).toISOString() : null,
        location: get('location').value.trim() || null,
        category: get('category').value,
        description: get('description').value.trim() || null,
        is_public: get('is_public').checked
      };
      if (!row.title || !row.starts_at) { st.className = 'form-status err'; st.textContent = 'Title and start time are required.'; return; }
      st.className = 'form-status'; st.textContent = 'Saving…';
      (e.id ? Z.eventUpdate(e.id, row) : Z.eventCreate(row)).then(function (r) {
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
      sec('👑 Assign e-board titles', '<p>Edit the brother → set <b>Role</b> (President, Vice-President, Treasurer or Secretary — spelled exactly) and <b>Role term</b> (e.g. “Fall 2026”). He appears in the E-Board section of the Active or Alumni page.</p>') +
      sec('📅 Post events', '<p><b>Events</b> tab → <b>+ New event</b>. Public events show to everyone on the homepage; uncheck “visible to the public” for brothers-only events.</p>') +
      sec('🛡️ Moderate the gallery & board', '<p>Sign in on the main site as admin — you can delete <b>any</b> gallery post, comment, or board thread (delete links appear for you on each item).</p>') +
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

      html += '<h3 class="stat-h">Activity log</h3>';
      html += acts.length ? '<div class="stat-list">' + acts.map(function (a) {
        var d = new Date(a.created_at);
        var when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return '<div class="stat-list__row"><b>' + esc(ACT_LABEL[a.action] || a.action) + '</b><span>' + esc(a.detail || '') + '</span><em>' + when + '</em></div>';
      }).join('') + '</div>' : '<p class="admin-empty">No activity recorded yet.</p>';

      q.innerHTML = html;
    }).catch(function (e2) {
      q.innerHTML = '<p class="form-status err">' + esc(e2.message || 'Could not load stats — run supabase/upgrade3.sql first.') + '</p>';
    });
  }

  gate();
})();
