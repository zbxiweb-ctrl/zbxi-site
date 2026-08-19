/* Mentoring tab — shared by the Admin and Officer consoles, the same way
   email-tab.js is. window.ZBXIMentoringTab.render(q) draws the whole thing.

   WHY THIS EXISTS. Until upgrade56 the "I'm open to…" flags had exactly ONE writer
   anywhere in the codebase: the brother's own profile form. So a brother who ticked
   the wrong box, or asked to come off the Mentors list, or never found the checkbox,
   could not be helped by anyone. The Mentoring page had no management surface at all.

   ONE VERB FOR BOTH CONSOLES. officer_set_open_to accepts `is_admin() OR
   officer_can('members.edit')`, so there is no admin branch here — both consoles call
   the same function and get the same server-side validation, and the webmaster's own
   record is refused for an officer by the same guard as everywhere else (upgrade54). */
(function () {
  'use strict';
  var esc = ZBXIUtil.esc;

  /* Active or alumni, by the SAME rule the roster pages use (brothers-page.js) — an
     explicit standing wins, otherwise derive from the grad year. Duplicated rather than
     imported because this module loads in two consoles that do not load brothers-page.js;
     if the rule ever changes, it changes in both. */
  var _now = new Date();
  var CUTOFF = _now.getFullYear() + (_now.getMonth() >= 5 ? 1 : 0);
  function pledgeYear(cls) {
    if (!cls) return null;
    var m4 = String(cls).match(/(19|20)\d{2}/);
    if (m4) return parseInt(m4[0], 10);
    var m2 = String(cls).match(/'(\d{2})/);
    if (!m2) return null;
    var yy = parseInt(m2[1], 10);
    return yy >= 93 ? 1900 + yy : 2000 + yy;
  }
  function isActive(b) {
    if (b.standing) return b.standing === 'active';
    var py = pledgeYear(b.pledge_class);
    var grad = b.grad_year || (py != null ? py + 4 : null);
    if (grad == null) return false;            // unknown -> alumni, as everywhere else
    return grad >= CUTOFF;
  }

  function render(q) {
    var Z = window.ZBXI;
    var OPEN_TO = (Z && Z.OPEN_TO) || [];
    q.innerHTML = '<p class="admin-empty">Loading the roster…</p>';

    Promise.all([Z.listVerifiedDetail(), Z.adminBrotherId(), Z.getUser()]).then(function (res) {
      var rows = (res[0] || []).slice().sort(function (a, z) {
        return String(a.full_name).localeCompare(String(z.full_name));
      });
      var adminBid = res[1];
      var me = res[2];
      // The webmaster's row is locked only for an OFFICER — the admin edits himself.
      // Resolved up here because row() reads it; the server refuses either way.
      var isAdminViewer = !!(Z.adminEmail && me &&
        (me.email || '').toLowerCase() === Z.adminEmail);
      var byId = {};
      rows.forEach(function (b) { byId[b.id] = b; });

      function on(b, key) { return (b.open_to || []).indexOf(key) !== -1; }
      function countOf(key) { return rows.filter(function (b) { return on(b, key); }).length; }

      function counts() {
        return '<div class="stat-grid">' + OPEN_TO.map(function (o) {
          return '<div class="stat-card"><b>' + countOf(o.key) + '</b><span>' + esc(o.label) + '</span></div>';
        }).join('') + '</div>';
      }

      q.innerHTML =
        '<p class="admin-hint">Who appears on the <b>Mentoring</b> page, and on which list. Brothers set these themselves on their profile — this is for fixing a mistake, or adding someone who asked you in person. ' +
        'A brother is on a list <b>only</b> if his box is ticked here.</p>' +
        counts() +
        '<div class="admin-addbar"><a class="btn btn--ghost" href="mentoring.html" target="_blank" rel="noopener">🧭 Open the Mentoring page →</a></div>' +
        '<div class="field"><label style="color:var(--on-navy-2)">Find a brother</label>' +
        '<input id="mtgFind" placeholder="Type a name…" autocomplete="off"></div>' +
        '<div id="mtgList"></div>';

      function draw(filter) {
        var f = String(filter || '').trim().toLowerCase();
        var list = document.getElementById('mtgList');
        if (!f) {
          // Default view is the people already on a list — that is what you came to check.
          var flagged = rows.filter(function (b) { return (b.open_to || []).length; });
          list.innerHTML = '<h3 class="stat-h">Currently listed (' + flagged.length + ')</h3>' +
            (flagged.length ? flagged.map(row).join('')
              : '<p class="admin-empty">Nobody is on either list yet.</p>') +
            '<p class="admin-hint" style="margin-top:.8rem">Type a name above to add or remove someone.</p>';
        } else {
          var hits = rows.filter(function (b) {
            return String(b.full_name || '').toLowerCase().indexOf(f) !== -1;
          }).slice(0, 25);
          list.innerHTML = hits.length ? hits.map(row).join('')
            : '<p class="admin-empty">Nobody matches “' + esc(filter) + '”.</p>';
        }
        wire(list);
      }

      function row(b) {
        var locked = b.id === adminBid && !isAdminViewer;
        var chips = OPEN_TO.map(function (o) {
          return '<label class="mtg-toggle' + (on(b, o.key) ? ' mtg-toggle--on' : '') + '">' +
            '<input type="checkbox" data-mtg="' + esc(b.id) + '" data-key="' + o.key + '"' +
            (on(b, o.key) ? ' checked' : '') + (locked ? ' disabled' : '') + '>' +
            '<span>' + o.icon + ' ' + esc(o.label) + '</span></label>';
        }).join('');
        var meta = [b.pledge_class, b.occupation, b.industry].filter(Boolean).map(esc).join(' · ');
        // An active brother offering to MENTOR is almost always a mistake — nobody wants a
        // current undergrad as their career mentor. Flagged, never blocked: a senior who
        // genuinely wants to help still can, and a brother's own checkbox is his.
        var act = isActive(b);
        var badge = '<span class="mtg-standing' + (act ? ' mtg-standing--active' : '') + '">' +
          (act ? '🎓 active' : '🏛 alumni') + '</span>';
        var warn = (act && on(b, 'mentor'))
          ? '<span class="mtg-warn">⚠ an active brother is listed as a mentor</span>' : '';
        return '<div class="admin-row admin-row--mtg" data-r="' + esc(b.id) + '">' +
          '<div class="admin-row__info"><b>' + esc(b.full_name) + '</b> ' + badge +
            '<span>' + (meta || '—') + '</span>' + warn +
            (locked ? '<span class="admin-row__locked">🔒 Webmaster account — managed by the site administrator</span>' : '') +
          '</div>' +
          '<div class="mtg-toggles">' + chips + '</div>' +
          '<p class="form-status" data-st="' + esc(b.id) + '"></p></div>';
      }

      function wire(scope) {
        scope.querySelectorAll('[data-mtg]').forEach(function (cb) {
          cb.onchange = function () {
            var id = cb.dataset.mtg;
            var b = byId[id];
            var st = scope.querySelector('[data-st="' + id + '"]');
            // Read every box for this brother, so the write is the whole set rather
            // than a patch — the server stores the array, not a diff.
            var want = [];
            scope.querySelectorAll('[data-mtg="' + id + '"]').forEach(function (x) {
              if (x.checked) want.push(x.dataset.key);
            });
            scope.querySelectorAll('[data-mtg="' + id + '"]').forEach(function (x) { x.disabled = true; });
            st.className = 'form-status'; st.textContent = 'Saving…';
            Z.officerSetOpenTo(id, want).then(function (saved) {
              b.open_to = saved;
              st.className = 'form-status ok';
              st.textContent = saved.length
                ? '✓ On: ' + saved.map(function (k) { var o = Z.openTo(k); return o ? o.label : k; }).join(', ')
                : '✓ Removed from both lists.';
              scope.querySelectorAll('[data-mtg="' + id + '"]').forEach(function (x) {
                x.disabled = false;
                x.closest('.mtg-toggle').classList.toggle('mtg-toggle--on', x.checked);
              });
            })['catch'](function (e) {
              // Put the boxes back to what the server still believes — a failed save
              // that leaves the tick showing is a lie about the roster.
              scope.querySelectorAll('[data-mtg="' + id + '"]').forEach(function (x) {
                x.disabled = false;
                x.checked = (b.open_to || []).indexOf(x.dataset.key) !== -1;
                x.closest('.mtg-toggle').classList.toggle('mtg-toggle--on', x.checked);
              });
              st.className = 'form-status err';
              st.textContent = (e && e.message) || 'Could not save that.';
            });
          };
        });
      }

      var find = document.getElementById('mtgFind');
      var t = null;
      find.oninput = function () {
        clearTimeout(t); var v = find.value;
        t = setTimeout(function () { draw(v); }, 120);
      };
      draw('');
    })['catch'](function (e) {
      q.innerHTML = '<p class="form-status err">' + esc((e && e.message) || 'Could not load the roster.') + '</p>';
    });
  }

  window.ZBXIMentoringTab = { render: render };
})();
