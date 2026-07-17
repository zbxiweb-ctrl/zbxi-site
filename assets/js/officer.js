/* Officer Console — day-to-day chapter tools for the two Presidents.
   Shows ONLY the tools the Admin has switched on for this President's seat
   (officer_grants). This is UI gating; the DATABASE is the real gate —
   officer_can() is baked into the safe-table RLS policies (see upgrade17.sql),
   so a President who somehow reached a hidden tool is still refused server-side.

   By design this keeps its OWN copies of the editors it borrows from the Admin
   Console (events / committees / awards / suggestions) so the working Admin
   Console is never touched. The announcement-banner editor from the admin Events
   tab is deliberately omitted: that is the (still-admin-only) announcements power,
   not events.manage. */
(function () {
  'use strict';
  var Z = window.ZBXI;
  var root = document.getElementById('officerRoot');
  if (!root) return;
  if (!Z || !Z.configured) { root.innerHTML = '<div class="admin-msg"><h2>Not configured</h2><p>The site backend isn’t reachable right now.</p></div>'; return; }

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  // "Jul 3, 2026 · 2:14 PM" — compact date + time for console rows.
  function stamp(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function btn(action, label, kind) {
    var cls = kind === 'gold' ? 'btn btn--gold' : kind === 'danger' ? 'btn btn--danger' : 'btn btn--ghost';
    return '<button class="' + cls + '" data-' + action + '>' + label + '</button>';
  }
  function each(el, sel, fn) { var n = el.querySelector(sel); if (n) n.onclick = fn; }
  function msg(title, body) { return '<div class="admin-msg"><h2>' + esc(title) + '</h2><p>' + body + '</p></div>'; }

  // The five Core tools, in the order they appear in the rail. `perm` is the
  // grant key; `render` is this console's own copy of the editor.
  var TOOLS = [
    { perm: 'events.manage',       id: 'events',     ic: '📅', label: 'Events',      render: renderEventsTab },
    { perm: 'committees.manage',   id: 'committees', ic: '👥', label: 'Committees',  render: renderCommitteesTab },
    { perm: 'awards.manage',       id: 'awards',     ic: '🏅', label: 'Awards',      render: renderAwardsTab },
    { perm: 'suggestions.respond', id: 'suggest',    ic: '💡', label: 'Suggestions', render: renderSuggestTab },
    { perm: 'gallery.moderate',    id: 'gallery',    ic: '🖼', label: 'Gallery',     render: renderGalleryTab }
  ];

  var state = { seat: null, seatLabel: '', grants: {}, tools: [], tab: null, events: [], verified: [] };

  /* ---------------- boot ---------------- */
  Z.getUser().then(function (u) {
    if (!u) { root.innerHTML = msg('Please sign in', 'This console is for chapter Presidents. <a href="index.html">Return to the site</a> and sign in first.'); return; }
    return Promise.all([Z.myOfficerSeat(), Z.officerGrantsList(), Z.memberDirectory()]).then(function (res) {
      state.seat = res[0];
      var grants = res[1] || [];
      var dir = res[2] || {};
      state.verified = Object.keys(dir).map(function (k) { return dir[k]; });
      state.myName = (dir[u.id] && dir[u.id].full_name) || (u.email || '').split('@')[0];
      state.seatLabel = state.seat === 'active_president' ? 'Active President'
        : state.seat === 'alumni_president' ? 'Alumni President' : '';
      grants.forEach(function (g) { if (g.seat === state.seat && g.enabled) state.grants[g.permission] = true; });
      state.tools = TOOLS.filter(function (t) { return state.grants[t.perm]; });
      renderConsole();
    });
  }).catch(function (e) { root.innerHTML = msg('Something went wrong', esc((e && e.message) || 'Please try again.')); });

  /* ---------------- console shell ---------------- */
  function renderConsole() {
    if (!state.seat) {
      root.innerHTML = msg('For chapter Presidents',
        'This console is available to the <b>Active</b> and <b>Alumni Presidents</b>. If that’s you and you’re seeing this, ask the webmaster to confirm your title is set. <a href="index.html">Back to the site</a>.');
      return;
    }

    var nav = state.tools.length
      ? state.tools.map(function (t) {
          return '<button data-tab="' + t.id + '" class="admin-navbtn ' + (state.tab === t.id ? 'on' : '') + '">' +
            '<i>' + t.ic + '</i><span>' + esc(t.label) + '</span></button>';
        }).join('')
      : '';

    root.innerHTML =
      // ---- chapter-registry masthead (full on landing; collapses on tab change) ----
      '<div class="console-masthead" id="masthead">' +
        '<img class="console-masthead__crest" src="assets/img/crest-hero.png" alt="" />' +
        '<span class="console-masthead__eyebrow">Zeta Beta Xi · Chapter Registry · Est. 1993</span>' +
        '<h1 class="console-masthead__title">Officer Console</h1>' +
        '<div class="console-masthead__rule"><i>✦</i></div>' +
        '<p class="console-masthead__seat">Held by <b>' + esc(state.myName) + '</b> — ' + esc(state.seatLabel) + '</p>' +
      '</div>' +
      '<div class="admin-shell">' +
        '<aside class="admin-side">' +
          '<div class="admin-side__id">' +
            '<img class="crest-badge" src="assets/img/crest-sm.png" alt="" />' +
            '<div><b>ΖΒΞ</b><span>Officer Console</span></div>' +
          '</div>' +
          (state.tools.length ? '<button class="admin-side__burger" id="sideBurger" aria-label="Show tools">☰ Tools</button>' : '') +
          '<nav id="tabs" class="admin-side__nav">' +
            (nav ? '<div class="admin-navgroup"><span class="admin-navgroup__label">Chapter Tools</span>' + nav + '</div>' : '') +
          '</nav>' +
          '<button class="btn btn--ghost admin-side__out" id="so">Sign out</button>' +
        '</aside>' +
        '<div class="admin-main">' +
          '<div class="admin-head">' +
            '<div><h2 id="officerTitle">Chapter Tools</h2>' +
            '<span class="admin-head__sub">Signed in as ' + esc(state.seatLabel) + ' — you can only see the tools the webmaster has enabled for you.</span></div>' +
          '</div>' +
          '<div id="q">Loading…</div>' +
        '</div>' +
      '</div>';

    document.getElementById('so').onclick = function () { Z.signOut().then(function () { location.href = 'index.html'; }); };

    var side = root.querySelector('.admin-side');
    var burger = document.getElementById('sideBurger');
    if (burger) burger.onclick = function () { side.classList.toggle('open'); };

    document.getElementById('tabs').querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        state.tab = b.dataset.tab; side.classList.remove('open');
        var m = document.getElementById('masthead'); if (m) m.classList.add('is-slim');  // ceremony on entry, efficiency once working
        renderTab();
      };
    });

    if (!state.tools.length) {
      document.getElementById('q').innerHTML =
        '<p class="admin-hint">No officer tools are enabled for you yet. The webmaster turns these on from the ' +
        '<b>Admin Console → Officers</b>. As soon as one is enabled, it will appear in the list on the left.</p>';
      return;
    }
    if (!state.tab || !state.tools.filter(function (t) { return t.id === state.tab; }).length) state.tab = state.tools[0].id;
    renderTab();
  }

  function renderTab() {
    var q = document.getElementById('q');
    if (!q) return;
    var tool = state.tools.filter(function (t) { return t.id === state.tab; })[0];
    if (!tool) { q.innerHTML = ''; return; }
    document.querySelectorAll('#tabs [data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === state.tab); });
    var h = document.getElementById('officerTitle');
    if (h) h.textContent = tool.label;
    tool.render(q);
  }

  /* ================= EVENTS (own copy; no announcement-banner editor) ======= */
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
          '<div class="admin-row__info"><b>' + esc(e.title) + (e.all_day ? ' <span class="tab-count">all-day</span>' : '') + '</b>' +
            '<span>' + esc(when) + (e.location ? ' · ' + esc(e.location) : '') + ' · ' + esc(e.category) + '</span></div>' +
          '<div class="admin-row__act">' + btn('evedit', 'Edit', 'ghost') + btn('evdel', 'Delete', 'danger') + '</div></div>';
      }).join('') : '<p class="admin-empty">No events yet — add the first one.</p>';

      q.innerHTML = '<p class="admin-hint">Add and edit the chapter calendar. Every event is visible to signed-in brothers.</p>' +
        '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="evNew">+ New event</button></p>' + list;
      document.getElementById('evNew').onclick = function () { openEventEdit(null); };
      q.querySelectorAll('[data-ev]').forEach(function (el) {
        var ev = state.events.filter(function (x) { return x.id === el.dataset.ev; })[0];
        each(el, '[data-evedit]', function () { openEventEdit(ev); });
        each(el, '[data-evdel]', function () {
          if (confirm('Delete "' + ev.title + '"?')) Z.eventDelete(ev.id).then(function () { renderTab(); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load events: ' + esc(e.message || '') + '</p>'; });
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
        close(); renderTab();
      });
    };
  }

  /* ================= AWARDS (own copy) ===================================== */
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
        'Add each year’s Greek awards here — the homepage updates itself and older years become a little archive.</p>' +
        '<p style="margin:0 0 1rem"><button class="btn btn--gold" id="awNew">+ Add award</button></p>';
      if (!rows.length) {
        html += '<p class="admin-empty">No awards saved yet.</p>';
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
          if (confirm('Delete "' + a.title + '" from the homepage?')) Z.awardDelete(a.id).then(function () { renderTab(); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load awards: ' + esc(e.message || '') + '</p>'; });
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
        close(); renderTab();
      });
    };
  }

  /* ================= COMMITTEES (own copy) ================================= */
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

  function renderCommitteesTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading committees…</p>';
    Z.committeesList().then(function (cs) {
      q.innerHTML =
        '<p class="admin-hint">Each committee gets a private space on the Board that only its members (and the webmaster) can see. Only brothers with accounts can be added.</p>' +
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
        ZBXIAsk.text({ title: 'New committee', placeholder: 'e.g. Rush Committee', ok: 'Create' }, function (name) {
          Z.committeeCreate(name).then(function () { renderTab(); });
        });
      };
      q.querySelectorAll('[data-comm]').forEach(function (el) {
        var c = cs.filter(function (x) { return x.id === el.dataset.comm; })[0];
        Z.committeeMembers(c.id).then(function (ids) {
          el.querySelector('[data-commcount]').textContent = ids.length + ' member' + (ids.length === 1 ? '' : 's');
        });
        each(el, '[data-members]', function () { openCommitteeMembers(c); });
        each(el, '[data-del]', function () {
          if (confirm('Delete "' + c.name + '"? Its private threads are deleted too.')) Z.committeeDelete(c.id).then(function () { renderTab(); });
        });
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load committees: ' + esc(e.message || '') + '</p>'; });
  }

  function openCommitteeMembers(c) {
    var registered = state.verified.filter(function (b) { return b.user_id; });
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
          a.onclick = function (e) { e.preventDefault(); Z.committeeRemove(c.id, a.dataset.rm).then(refreshList); };
        });
      });
    }
    refreshList();
    wrap.querySelector('[data-f="add"]').onchange = function (e) {
      if (!e.target.value) return;
      Z.committeeAdd(c.id, e.target.value).then(function () { e.target.value = ''; refreshList(); });
    };
  }

  /* ================= SUGGESTIONS (own copy; respond + archive, no delete) == */
  function renderSuggestTab(q) {
    q.innerHTML = '<p class="admin-empty">Loading suggestions…</p>';
    Z.suggestionsMine().then(function (rows) { // RLS returns what this officer may see
      var groups = { new: [], responded: [], archived: [] };
      rows.forEach(function (s) { (groups[s.status] || groups.new).push(s); });

      function block(title, list, showActions) {
        if (!list.length) return '';
        return '<h3 class="stat-h">' + title + ' (' + list.length + ')</h3>' + list.map(function (s) {
          return '<div class="sug-card" data-sug="' + s.id + '">' +
            '<p class="sug-card__body">' + esc(s.body) + '</p>' +
            '<small>' + stamp(s.created_at) + (s.responded_at ? ' · replied ' + stamp(s.responded_at) : '') + '</small>' +
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

      q.innerHTML = '<p class="admin-hint">Read and respond to member suggestions. Your reply sends the brother a notification. (Deleting a suggestion stays with the webmaster.)</p>' +
        (rows.length
          ? block('🆕 New', groups.new, true) + block('✅ Responded', groups.responded, false) + block('📦 Archived', groups.archived, false)
          : '<p class="admin-empty">No suggestions yet — brothers submit them from the Board page.</p>');

      q.querySelectorAll('[data-sug]').forEach(function (el) {
        var id = el.dataset.sug;
        var send = el.querySelector('[data-send]');
        if (send) send.onclick = function () {
          var resp = el.querySelector('[data-resp]').value.trim();
          if (!resp) return;
          Z.suggestionUpdate(id, { response: resp, status: 'responded', responded_at: new Date().toISOString() })
            .then(function () { renderTab(); });
        };
        var arch = el.querySelector('[data-arch]');
        if (arch) arch.onclick = function () { Z.suggestionUpdate(id, { status: 'archived' }).then(function () { renderTab(); }); };
      });
    }).catch(function (e) { q.innerHTML = '<p class="form-status err">Could not load suggestions: ' + esc(e.message || '') + '</p>'; });
  }

  /* ================= GALLERY (moderation happens on the Gallery page) ====== */
  function renderGalleryTab(q) {
    q.innerHTML = '<p class="admin-hint">You can remove inappropriate posts and comments. Moderation happens right on the gallery itself: ' +
      'open the <b>Gallery</b>, and a <b>Delete</b> button appears on every post and comment for you.</p>' +
      '<p style="margin-top:1rem"><a class="btn btn--gold" href="gallery.html">Open the Gallery →</a></p>';
  }

})();
