/* "Are you a brother?" portal: sign up / log in / password reset / claim /
   create + edit profile / account settings. Renders into #portalCard.
   Uses window.ZBXI (supabase-client.js). */
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

  var state = { user: null, profile: null, mode: 'signin', verified: [], tab: 'profile', recovery: false };

  // Password-recovery links land back here with a recovery session.
  Z.onAuth(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      state.recovery = true;
      renderNewPassword();
      var sec = document.getElementById('brothers-portal');
      if (sec) sec.scrollIntoView();
    }
  });

  function refresh() {
    if (state.recovery) return; // stay on the set-new-password screen
    Z.getUser().then(function (u) {
      state.user = u;
      if (!u) return renderAuth();
      // Big-brother options come from the PUBLIC roster view so the dropdown
      // works before approval too (details stay members-only).
      return Promise.all([Z.myProfile(u.id), Z.listFamilyPublic()]).then(function (res) {
        state.profile = res[0]; state.verified = res[1] || [];
        renderProfileArea();
      });
    }).catch(function (err) {
      h('<div class="portal-msg"><div class="portal-msg__ic">⚠️</div>' +
        '<h3>Something went wrong</h3>' +
        '<p>We couldn\'t load the members area. Please refresh the page and try again.</p>' +
        '<p class="form-note">' + esc(err && err.message ? err.message : 'Unknown error') + '</p></div>');
    });
  }

  /* ---- signed out: sign up / log in / forgot password ---- */
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
      (signup
        ? '<p class="form-note">Only established brothers should sign up. New profiles are reviewed by chapter leadership before going public.</p>'
        : '<p class="form-note center"><a href="#" id="forgotPw">Forgot your password?</a></p>'));

    card.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { state.mode = b.dataset.tab; renderAuth(); };
    });
    var forgot = card.querySelector('#forgotPw');
    if (forgot) forgot.onclick = function (e) { e.preventDefault(); renderForgot(); };

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

  function renderForgot() {
    h('<div class="portal-claim"><h3>Reset your password</h3>' +
      '<p class="form-note">Enter your account email and we\'ll send you a reset link.</p>' +
      '<form id="resetForm" novalidate>' +
        '<div class="field"><label>Email</label><input type="email" name="email" required></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">Send reset link</button>' +
        '<p class="form-status" id="resetStatus" role="status"></p>' +
      '</form>' +
      '<button class="portal-signout" id="resetBack" type="button">← Back to log in</button></div>');
    card.querySelector('#resetBack').onclick = function () { state.mode = 'signin'; renderAuth(); };
    card.querySelector('#resetForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = card.querySelector('#resetStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      f.querySelector('button').disabled = true;
      Z.resetPassword(f.email.value.trim()).then(function (r) {
        if (r.error) throw r.error;
        st.className = 'form-status ok';
        st.textContent = '✓ Check your email for the reset link.';
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not send the link.';
        f.querySelector('button').disabled = false;
      });
    };
  }

  function renderNewPassword() {
    h('<div class="portal-claim"><h3>Choose a new password</h3>' +
      '<form id="newPwForm" novalidate>' +
        '<div class="field"><label>New password</label><input type="password" name="pw" minlength="8" required placeholder="8+ characters"></div>' +
        '<div class="field"><label>Confirm new password</label><input type="password" name="pw2" minlength="8" required></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">Save new password</button>' +
        '<p class="form-status" id="newPwStatus" role="status"></p>' +
      '</form></div>');
    card.querySelector('#newPwForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = card.querySelector('#newPwStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      if (f.pw.value !== f.pw2.value) { st.className = 'form-status err'; st.textContent = 'Passwords don\'t match.'; return; }
      f.querySelector('button').disabled = true;
      Z.updatePassword(f.pw.value).then(function (r) {
        if (r.error) throw r.error;
        state.recovery = false;
        st.className = 'form-status ok'; st.textContent = '✓ Password updated — signing you in…';
        setTimeout(refresh, 800);
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not update password.';
        f.querySelector('button').disabled = false;
      });
    };
  }

  /* ---- signed in ---- */
  function renderProfileArea() {
    var pr = state.profile;
    if (pr && pr.status === 'pending') return renderPending(pr);
    if (!pr) return renderChooser(); // no profile yet: claim an existing tree entry or create new
    return renderShell(pr); // profile + account tabs
  }

  function renderShell(pr) {
    var onAccount = state.tab === 'account';
    h('<div class="portal-tabs">' +
        '<button class="' + (!onAccount ? 'on' : '') + '" data-ptab="profile">My Profile</button>' +
        '<button class="' + (onAccount ? 'on' : '') + '" data-ptab="account">Account</button>' +
      '</div><div id="portalTabBody"></div>');
    card.querySelectorAll('[data-ptab]').forEach(function (b) {
      b.onclick = function () { state.tab = b.dataset.ptab; renderShell(pr); };
    });
    if (onAccount) renderAccount(pr); else renderForm(pr);
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
    card.querySelector('#chooseNew').onclick = function () { renderForm(null, card); };
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
      '<p>Thanks, <b>' + esc(pr.full_name) + '</b>. Chapter leadership will review your profile shortly. Once approved, you\'ll appear in the brotherhood roster and family tree — and unlock the gallery, board and member directory.</p>' +
      signOutBtn() + '</div>');
    wireSignOut();
  }

  /* ---- profile form ---- */
  var TITLES = ['President', 'Vice-President', 'Treasurer', 'Secretary'];

  function renderForm(pr, target) {
    pr = pr || {};
    var host = target || card.querySelector('#portalTabBody') || card;
    var bigOpts = ['<option value="">— none / I\'m a founder —</option>'].concat(
      state.verified.filter(function (b) { return b.id !== pr.id; })
        .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); })
        .map(function (b) { return '<option value="' + b.id + '"' + (pr.big_id === b.id ? ' selected' : '') + '>' + esc(b.full_name) + ' (' + esc(b.pledge_class || '') + ')</option>'; })
    ).join('');
    var titleOpts = ['<option value="">— no title —</option>'].concat(
      TITLES.map(function (t) { return '<option value="' + t + '"' + (pr.role === t ? ' selected' : '') + '>' + t + '</option>'; })
    ).join('');
    var prefs = String(pr.contact_prefs || '').split(',');
    function prefBox(key, label) {
      return '<label class="pref-box"><input type="checkbox" name="pref_' + key + '"' +
        (prefs.indexOf(key) !== -1 ? ' checked' : '') + '> ' + label + '</label>';
    }

    host.innerHTML =
      (pr.status === 'verified' ? '<p class="portal-live">● You\'re live on the site. Edits re-enter review.</p>' : '') +
      '<form id="profForm" novalidate>' +
        '<fieldset class="pf-group"><legend>The basics</legend>' +
          '<div class="form-row">' +
            fld('Full name *', 'full_name', pr.full_name, 'text', true) +
            fld('Pledge class *', 'pledge_class', pr.pledge_class, 'text', true, 'e.g. Fall 2019') +
          '</div>' +
          '<div class="form-row">' +
            fld('Grad year', 'grad_year', pr.grad_year, 'number') +
            fld('Major', 'major', pr.major) +
          '</div>' +
          '<div class="form-row">' +
            '<div class="field"><label>Chapter title (if held)</label><select name="role">' + titleOpts + '</select></div>' +
            fld('Title term', 'role_term', pr.role_term, 'text', false, 'e.g. Fall 2019') +
          '</div>' +
          '<div class="field"><label>Big brother</label><select name="big_id">' + bigOpts + '</select></div>' +
        '</fieldset>' +
        '<fieldset class="pf-group"><legend>Where you are now</legend>' +
          '<div class="form-row">' +
            fld('Current city', 'city', pr.city, 'text', false, 'e.g. Brooklyn, NY') +
            fld('Occupation', 'occupation', pr.occupation, 'text', false, 'e.g. Software Engineer') +
          '</div>' +
          '<div class="form-row">' +
            fld('Hometown', 'hometown', pr.hometown) +
            fld('Phone', 'phone', pr.phone, 'tel') +
          '</div>' +
          '<div class="form-row">' +
            fld('Contact email', 'email', pr.email || (state.user && state.user.email), 'email') +
            '<div class="field"><label>&nbsp;</label><p class="form-note" style="margin:0">Contact details are visible to verified brothers only.</p></div>' +
          '</div>' +
          '<div class="form-row">' +
            fld('LinkedIn', 'linkedin', pr.linkedin, 'url', false, 'https://…') +
            '<div class="field"><label>Reach me via</label><div class="pref-row">' +
              prefBox('email', 'Email') + prefBox('phone', 'Phone') + prefBox('linkedin', 'LinkedIn') +
            '</div></div>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="pf-group"><legend>Your story</legend>' +
          '<div class="field"><label>Short quote</label><input name="quote" value="' + esc(pr.quote) + '" maxlength="140"></div>' +
          '<div class="field"><label>Bio — your story &amp; memories from the house</label><textarea name="bio">' + esc(pr.bio) + '</textarea></div>' +
          '<div class="field"><label>Skills &amp; interests (great for mentoring)</label><input name="skills" value="' + esc(pr.skills) + '" placeholder="e.g. finance, grad school apps, guitar"></div>' +
          '<div class="field"><label>Profile photo</label><input type="file" name="photo" accept="image/*"></div>' +
        '</fieldset>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">' + (pr.id ? 'Save profile' : 'Submit for verification') + '</button>' +
        '<p class="form-status" id="profStatus" role="status"></p>' +
      '</form>' + (target ? '<button class="portal-signout" id="formBack" type="button">← Back</button>' : signOutBtn());

    wireSignOut();
    var back = host.querySelector('#formBack');
    if (back) back.onclick = renderChooser;

    host.querySelector('#profForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = host.querySelector('#profStatus');
      st.className = 'form-status'; st.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';

      var chosen = ['email', 'phone', 'linkedin'].filter(function (k) { return f['pref_' + k].checked; });
      var file = f.photo.files[0];
      var photoP = file ? Z.uploadPhoto(state.user.id, file) : Promise.resolve(pr.photo_url || null);
      photoP.then(function (url) {
        var row = {
          user_id: state.user.id,
          full_name: f.full_name.value.trim(),
          pledge_class: f.pledge_class.value.trim(),
          grad_year: f.grad_year.value ? parseInt(f.grad_year.value, 10) : null,
          major: f.major.value.trim() || null,
          role: f.role.value || null,
          role_term: f.role_term.value.trim() || null,
          big_id: f.big_id.value || null,
          city: f.city.value.trim() || null,
          occupation: f.occupation.value.trim() || null,
          hometown: f.hometown.value.trim() || null,
          phone: f.phone.value.trim() || null,
          email: f.email.value.trim() || null,
          linkedin: f.linkedin.value.trim() || null,
          contact_prefs: chosen.length ? chosen.join(',') : null,
          quote: f.quote.value.trim() || null,
          bio: f.bio.value.trim() || null,
          skills: f.skills.value.trim() || null,
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

  /* ---- account settings tab ---- */
  function renderAccount(pr) {
    var host = card.querySelector('#portalTabBody');
    var inTree = !!pr.roster_name;
    host.innerHTML =
      '<div class="acct-block"><h4>Change password</h4>' +
        '<form id="pwForm" novalidate>' +
          '<div class="form-row">' +
            '<div class="field"><label>New password</label><input type="password" name="pw" minlength="8" required placeholder="8+ characters"></div>' +
            '<div class="field"><label>Confirm</label><input type="password" name="pw2" minlength="8" required></div>' +
          '</div>' +
          '<button class="btn btn--navy" type="submit">Update password</button>' +
          '<p class="form-status" id="pwStatus" role="status"></p>' +
        '</form></div>' +
      '<div class="acct-block acct-block--danger"><h4>Family tree link</h4>' +
        (inTree
          ? '<p class="form-note">This account is linked to <b>' + esc(pr.roster_name) + '</b> in the family tree. Disconnecting returns that name to the tree (unclaimed, details cleared) and lets it be claimed again.</p>' +
            '<button class="btn btn--ghost-danger" id="releaseBtn" type="button">Disconnect from the family tree</button>'
          : '<p class="form-note">This profile was created from scratch (not claimed from the tree). Disconnecting will <b>delete</b> this profile entirely.</p>' +
            '<button class="btn btn--ghost-danger" id="releaseBtn" type="button">Delete my profile</button>') +
        '<p class="form-status" id="releaseStatus" role="status"></p>' +
      '</div>' + signOutBtn();

    wireSignOut();

    host.querySelector('#pwForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = host.querySelector('#pwStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      if (f.pw.value !== f.pw2.value) { st.className = 'form-status err'; st.textContent = 'Passwords don\'t match.'; return; }
      Z.updatePassword(f.pw.value).then(function (r) {
        if (r.error) throw r.error;
        st.className = 'form-status ok'; st.textContent = '✓ Password updated.';
        f.reset();
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not update.';
      });
    };

    host.querySelector('#releaseBtn').onclick = function () {
      var msg = inTree
        ? 'Disconnect this account from "' + pr.roster_name + '"? Your personal details will be cleared and the name becomes claimable again.'
        : 'Delete your profile entirely? This cannot be undone.';
      if (!confirm(msg)) return;
      var st = host.querySelector('#releaseStatus');
      st.className = 'form-status'; st.textContent = 'Working…';
      Z.releaseProfile().then(function (r) {
        var out = (r && r.data) || '';
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
        if (String(out).indexOf('ok') !== 0) { st.className = 'form-status err'; st.textContent = String(out).replace('error: ', ''); return; }
        state.profile = null; state.tab = 'profile';
        Z._approvedCache = undefined; // re-evaluate member access
        refresh(); // -> chooser
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
    if (b) b.onclick = function () { Z.signOut().then(function () { state.profile = null; state.mode = 'signin'; state.tab = 'profile'; refresh(); }); };
  }

  refresh();
})();
