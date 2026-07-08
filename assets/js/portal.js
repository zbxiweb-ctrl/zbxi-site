/* "Are you a brother?" portal: sign up / log in / create + edit profile.
   Renders into #portalCard. Uses window.ZBXI (supabase-client.js). When Supabase
   isn't configured yet, shows a friendly coming-soon state. */
(function () {
  'use strict';
  var card = document.getElementById('portalCard');
  if (!card) return;
  var Z = window.ZBXI;

  function h(html) { card.innerHTML = html; }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

  if (!Z || !Z.configured) {
    h('<div class="portal-msg"><div class="portal-msg__ic">🔒</div>' +
      '<h3>Brother sign-in is coming soon</h3>' +
      '<p>The members area is being set up. Soon you\'ll be able to create your brother profile and join the family tree here.</p>' +
      '<p class="form-note">Are you a prospective member instead? <a href="#contact">Reach out here</a>.</p></div>');
    return;
  }

  var state = { user: null, profile: null, mode: 'signin', verified: [] };

  function refresh() {
    Z.getUser().then(function (u) {
      state.user = u;
      if (!u) return renderAuth();
      return Promise.all([Z.myProfile(u.id), Z.listVerified()]).then(function (res) {
        state.profile = res[0]; state.verified = res[1] || [];
        renderProfileArea();
      });
    });
  }

  /* ---- signed out: sign up / log in ---- */
  function renderAuth() {
    var signup = state.mode === 'signup';
    h('<div class="portal-tabs">' +
        '<button class="' + (!signup ? 'on' : '') + '" data-tab="signin">Log in</button>' +
        '<button class="' + (signup ? 'on' : '') + '" data-tab="signup">Sign up</button>' +
      '</div>' +
      '<form id="authForm" novalidate>' +
        '<div class="field"><label>Email</label><input type="email" name="email" required></div>' +
        '<div class="field"><label>Password</label><input type="password" name="password" minlength="8" required placeholder="8+ characters"></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">' + (signup ? 'Create account' : 'Log in') + '</button>' +
        '<p class="form-status" id="authStatus" role="status"></p>' +
      '</form>' +
      (signup ? '<p class="form-note">Only established brothers should sign up. New profiles are reviewed by chapter leadership before going public.</p>' : ''));

    card.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { state.mode = b.dataset.tab; renderAuth(); };
    });
    card.querySelector('#authForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, email = f.email.value.trim(), pw = f.password.value;
      var st = card.querySelector('#authStatus');
      st.className = 'form-status'; st.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var p = signup ? Z.signUp(email, pw) : Z.signIn(email, pw);
      f.querySelector('button').disabled = true;
      p.then(function (r) {
        if (r.error) throw r.error;
        if (signup && r.data && !r.data.session) {
          st.className = 'form-status ok';
          st.textContent = '✓ Check your email to confirm, then log in.';
          f.querySelector('button').disabled = false;
          return;
        }
        refresh();
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Something went wrong.';
        f.querySelector('button').disabled = false;
      });
    };
  }

  /* ---- signed in ---- */
  function renderProfileArea() {
    var pr = state.profile;
    if (pr && pr.status === 'pending') return renderPending(pr);
    if (!pr) return renderChooser(); // no profile yet: claim an existing tree entry or create new
    return renderForm(pr); // edit (verified/rejected)
  }

  /* ---- no profile yet: claim vs create ---- */
  function renderChooser() {
    h('<div class="portal-choose">' +
      '<h3>Welcome, brother!</h3>' +
      '<p class="form-note">Most brothers are already in our family tree from the chapter records. Claiming your name links this account to your spot in the tree.</p>' +
      '<button class="portal-choice" id="chooseClaim"><b>🌳 I\'m in the family tree</b><span>Find and claim your name — keeps your lineage intact.</span></button>' +
      '<button class="portal-choice" id="chooseNew"><b>✨ I\'m not in the tree yet</b><span>Create a brand-new profile from scratch.</span></button>' +
      signOutBtn() + '</div>');
    wireSignOut();
    card.querySelector('#chooseClaim').onclick = renderClaim;
    card.querySelector('#chooseNew').onclick = function () { renderForm(null); };
  }

  function renderClaim() {
    h('<div class="portal-claim"><h3>Claim your name</h3>' +
      '<p class="form-note">Search for yourself, then confirm. Chapter leadership verifies every claim before it goes live.</p>' +
      '<div class="field"><label>Search the brotherhood</label><input id="claimSearch" placeholder="Start typing your name…" autocomplete="off"></div>' +
      '<div id="claimList" class="claim-list"></div>' +
      '<p class="form-status" id="claimStatus" role="status"></p>' +
      '<button class="portal-signout" id="claimBack" type="button">← Back</button></div>');
    card.querySelector('#claimBack').onclick = renderChooser;

    var listEl = card.querySelector('#claimList');
    var input = card.querySelector('#claimSearch');
    var all = [];
    listEl.innerHTML = '<p class="form-note">Loading the brotherhood…</p>';
    Z.listUnclaimed().then(function (rows) {
      all = rows || [];
      listEl.innerHTML = '<p class="form-note">' + all.length + ' unclaimed brothers. Type to search.</p>';
    });

    input.oninput = function () {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { listEl.innerHTML = '<p class="form-note">Keep typing…</p>'; return; }
      var hits = all.filter(function (b) { return b.full_name.toLowerCase().indexOf(q) !== -1; }).slice(0, 12);
      if (!hits.length) { listEl.innerHTML = '<p class="form-note">No match — use "I\'m not in the tree yet" instead.</p>'; return; }
      listEl.innerHTML = hits.map(function (b) {
        return '<button class="claim-row" data-id="' + b.id + '"><b>' + esc(b.full_name) + '</b><span>' + esc(b.pledge_class || '') + '</span></button>';
      }).join('');
      listEl.querySelectorAll('.claim-row').forEach(function (row) {
        row.onclick = function () {
          var picked = all.filter(function (b) { return b.id === row.dataset.id; })[0];
          if (!picked) return;
          if (!confirm('Claim "' + picked.full_name + ' (' + (picked.pledge_class || '') + ')" as your profile?')) return;
          var st = card.querySelector('#claimStatus');
          st.className = 'form-status'; st.textContent = 'Claiming…';
          Z.claimProfile(picked.id).then(function (r) {
            var msg = (r && r.data) || '';
            if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
            if (String(msg).indexOf('ok') !== 0) { st.className = 'form-status err'; st.textContent = String(msg).replace('error: ', ''); return; }
            refresh(); // -> pending state
          });
        };
      });
    };
  }

  function renderPending(pr) {
    h('<div class="portal-msg"><div class="portal-msg__ic">⏳</div>' +
      '<h3>Profile awaiting verification</h3>' +
      '<p>Thanks, <b>' + esc(pr.full_name) + '</b>. Chapter leadership will review your profile shortly. Once approved, you\'ll appear in the brotherhood roster and family tree.</p>' +
      signOutBtn() + '</div>');
    wireSignOut();
  }

  function renderForm(pr) {
    pr = pr || {};
    var bigOpts = ['<option value="">— none / I\'m a founder —</option>'].concat(
      state.verified.filter(function (b) { return b.user_id !== state.user.id; })
        .map(function (b) { return '<option value="' + b.id + '"' + (pr.big_id === b.id ? ' selected' : '') + '>' + esc(b.full_name) + ' (' + esc(b.pledge_class || '') + ')</option>'; })
    ).join('');

    h((pr.status === 'verified' ? '<p class="portal-live">● You\'re live on the site. Edits re-enter review.</p>' : '') +
      '<form id="profForm" novalidate>' +
        '<div class="form-row">' +
          fld('Full name *', 'full_name', pr.full_name, 'text', true) +
          fld('Pledge class *', 'pledge_class', pr.pledge_class, 'text', true, 'e.g. Fall 2019') +
        '</div>' +
        '<div class="form-row">' +
          fld('Grad year', 'grad_year', pr.grad_year, 'number') +
          fld('Major', 'major', pr.major) +
        '</div>' +
        '<div class="field"><label>Big brother</label><select name="big_id">' + bigOpts + '</select></div>' +
        '<div class="form-row">' +
          fld('Hometown', 'hometown', pr.hometown) +
          fld('LinkedIn', 'linkedin', pr.linkedin, 'url', false, 'https://…') +
        '</div>' +
        '<div class="field"><label>Short quote</label><input name="quote" value="' + esc(pr.quote) + '" maxlength="140"></div>' +
        '<div class="field"><label>Bio</label><textarea name="bio">' + esc(pr.bio) + '</textarea></div>' +
        '<div class="field"><label>Profile photo</label><input type="file" name="photo" accept="image/*"></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">' + (pr.id ? 'Save profile' : 'Submit for verification') + '</button>' +
        '<p class="form-status" id="profStatus" role="status"></p>' +
      '</form>' + signOutBtn());

    wireSignOut();
    card.querySelector('#profForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = card.querySelector('#profStatus');
      st.className = 'form-status'; st.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';

      var file = f.photo.files[0];
      var photoP = file ? Z.uploadPhoto(state.user.id, file) : Promise.resolve(pr.photo_url || null);
      photoP.then(function (url) {
        var row = {
          user_id: state.user.id,
          full_name: f.full_name.value.trim(),
          pledge_class: f.pledge_class.value.trim(),
          grad_year: f.grad_year.value ? parseInt(f.grad_year.value, 10) : null,
          major: f.major.value.trim() || null,
          big_id: f.big_id.value || null,
          hometown: f.hometown.value.trim() || null,
          linkedin: f.linkedin.value.trim() || null,
          quote: f.quote.value.trim() || null,
          bio: f.bio.value.trim() || null,
          photo_url: url,
          status: 'pending' // any create/edit re-enters review
        };
        if (pr.id) row.id = pr.id;
        return Z.upsertProfile(row);
      }).then(function (r) {
        if (r.error) throw r.error;
        st.className = 'form-status ok'; st.textContent = '✓ Submitted — pending verification.';
        setTimeout(refresh, 900);
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not save.';
        btn.disabled = false; btn.textContent = 'Try again';
      });
    };
  }

  function fld(label, name, val, type, req, ph) {
    return '<div class="field"><label>' + label + '</label><input name="' + name + '" type="' + (type || 'text') + '"' +
      (req ? ' required' : '') + (ph ? ' placeholder="' + ph + '"' : '') + ' value="' + esc(val) + '"></div>';
  }
  function signOutBtn() { return '<button class="portal-signout" id="signOut" type="button">Sign out</button>'; }
  function wireSignOut() {
    var b = card.querySelector('#signOut');
    if (b) b.onclick = function () { Z.signOut().then(function () { state.profile = null; state.mode = 'signin'; refresh(); }); };
  }

  refresh();
})();
