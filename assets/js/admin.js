/* Admin approval console. Lists pending brothers and lets the admin
   Approve / Reject. All enforced by RLS (only ADMIN_EMAIL can read pending
   or update rows) — the UI check is convenience, not the security boundary. */
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
      renderQueue();
    });
  }

  function renderQueue() {
    root.innerHTML = '<div class="admin-head"><h2>Pending brothers</h2><button class="btn btn--ghost" id="so">Sign out</button></div><div id="q">Loading…</div>';
    document.getElementById('so').onclick = function () { Z.signOut().then(function () { renderLogin(''); }); };
    Z.listPending().then(function (r) {
      var q = document.getElementById('q');
      var rows = r.data || [];
      if (r.error) { q.innerHTML = '<p class="form-status err">' + esc(r.error.message) + '</p>'; return; }
      if (!rows.length) { q.innerHTML = '<p class="admin-empty">🎉 No pending profiles. All caught up.</p>'; return; }
      q.innerHTML = rows.map(function (b) {
        return '<div class="admin-row" data-id="' + b.id + '">' +
          '<div class="admin-row__ph">' + (b.photo_url ? '<img src="' + esc(b.photo_url) + '" alt="">' : 'ΖΒΞ') + '</div>' +
          '<div class="admin-row__info"><b>' + esc(b.full_name) + '</b>' +
            '<span>' + esc(b.pledge_class || '') + (b.major ? ' · ' + esc(b.major) : '') + (b.grad_year ? " · '" + String(b.grad_year).slice(-2) : '') + '</span>' +
            (b.quote ? '<em>“' + esc(b.quote) + '”</em>' : '') + '</div>' +
          '<div class="admin-row__act">' +
            '<button class="btn btn--gold" data-ok>Approve</button>' +
            '<button class="btn btn--ghost" data-no>Reject</button></div></div>';
      }).join('');
      q.querySelectorAll('.admin-row').forEach(function (el) {
        var id = el.dataset.id;
        el.querySelector('[data-ok]').onclick = function () { act(id, 'verified', el); };
        el.querySelector('[data-no]').onclick = function () { act(id, 'rejected', el); };
      });
    });
  }

  function act(id, status, el) {
    el.style.opacity = '.5';
    Z.setStatus(id, status).then(function (r) {
      if (r.error) { el.style.opacity = '1'; alert(r.error.message); return; }
      el.remove();
      var q = document.getElementById('q');
      if (q && !q.querySelector('.admin-row')) q.innerHTML = '<p class="admin-empty">🎉 No pending profiles. All caught up.</p>';
    });
  }

  gate();
})();
