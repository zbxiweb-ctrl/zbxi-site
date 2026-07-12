/* Brother portal. The homepage section (#portalCard) is a slim sign-in/up
   card beside a member-perks grid (#portalPerks). All profile management
   (claim / create / edit / account settings) lives in the #profileModal
   popup, opened from the header "My Profile" menu or auto-opened for new
   sign-ins with no profile yet. Uses window.ZBXI (supabase-client.js). */
(function () {
  'use strict';
  // The inline portal section (#portalCard) lives only on the homepage. The
  // profile popup (#profileModal) is on every page. Run whenever EITHER exists:
  // with just the modal we operate in "modal-only mode" so "My Profile" opens
  // the popup in place on subpages instead of routing home. The section-only
  // renderers (auth / member card / forgot) simply no-op when there's no card.
  var card = document.getElementById('portalCard');
  var modal = document.getElementById('profileModal');
  if (!card && !modal) return;
  var perksEl = document.getElementById('portalPerks');
  var mbody = modal ? modal.querySelector('[data-pm-body]') : null;
  var Z = window.ZBXI;

  // Where the current render goes: the section card (auth) or the popup body.
  var target = card || mbody;
  function h(html) { target.innerHTML = html; }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

  if (!Z || !Z.configured) {
    if (card) card.innerHTML = '<div class="portal-msg"><div class="portal-msg__ic">🔒</div>' +
      '<h3>Brother sign-in is coming soon</h3>' +
      '<p>The members area is being set up. Soon you\'ll be able to create your brother profile and join the family tree here.</p>' +
      '<p class="form-note">Are you a prospective member instead? <a href="#contact">Reach out here</a>.</p></div>';
    return;
  }

  var state = { user: null, profile: null, mode: 'signin', verified: [], tab: 'profile', recovery: false, loaded: false, wantModal: false,
                invite: null };  // { email, has_account } from an invite link

  // Invite links look like  /?invite=<token>#brothers-portal
  // Resolve the token before the first auth render so we can land the brother
  // straight on "Create account" (no profile yet) or "Log in" (already has one).
  function inviteToken() {
    var m = location.search.match(/[?&]invite=([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }
  function resolveInvite() {
    var t = inviteToken();
    if (!t || !Z.inviteStatus) return Promise.resolve(null);
    return Z.inviteStatus(t).then(function (r) {
      if (r && r.ok) {
        state.invite = { email: r.email, has_account: !!r.has_account };
        state.mode = r.has_account ? 'signin' : 'signup';
      }
      return state.invite;
    });
  }

  /* ---------------- popup plumbing ---------------- */
  function openModal() {
    if (!modal) return;
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    if (state.recovery) return renderNewPassword();
    if (state.loaded && state.user) renderProfileArea();
    else { target = mbody; h('<p class="form-note">Loading…</p>'); state.wantModal = true; }
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
  }
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-pm-close]')) closeModal();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }
  // Header menu + other pages open the popup via this hook (or #my-profile hash).
  //   open()            -> profile popup (signed-in flows)
  //   showAuth('signin'|'signup') -> jump to the inline auth card in the chosen
  //     mode; used by the header "Log in / Sign up" dropdown. If already signed
  //     in, falls back to opening the profile popup.
  window.ZBXIPortal = {
    open: function () { state.wantModal = true; openModal(); },
    showAuth: function (mode) {
      if (state.user) { state.wantModal = true; openModal(); return; }
      if (mode === 'signin' || mode === 'signup') state.mode = mode;
      if (state.loaded) renderAuth();
      var sec = document.getElementById('brothers-portal');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // move focus to the email field for a keyboard-friendly hand-off
      setTimeout(function () { var e = card && card.querySelector('input[name="email"]'); if (e) e.focus({ preventScroll: true }); }, 350);
    }
  };
  if (location.hash === '#my-profile') state.wantModal = true;
  // Subpages route here as  index.html?auth=signup#brothers-portal
  function authParam() {
    var m = location.search.match(/[?&]auth=(signin|signup)\b/);
    return m ? m[1] : null;
  }

  // Password-recovery links land back here with a recovery session.
  Z.onAuth(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      state.recovery = true;
      openModal();
    }
  });

  /* ---------------- main refresh ---------------- */
  function refresh() {
    Z.getUser().then(function (u) {
      state.user = u;
      if (!u) {
        state.loaded = true; state.profile = null;
        closeModal();
        renderPerks(false);
        // An invite link decides whether we show Log in or Create account;
        // otherwise a ?auth= param (from the header dropdown on a subpage) does.
        return resolveInvite().then(function () {
          if (!state.invite) { var ap = authParam(); if (ap) state.mode = ap; }
          renderAuth();
        });
      }
      return Promise.all([Z.myProfile(u.id), Z.listFamilyPublic()]).then(function (res) {
        state.profile = res[0]; state.verified = res[1] || [];
        state.loaded = true;
        renderMemberCard();
        renderPerks(true);
        // First sign-in with no profile: walk them straight into onboarding.
        // Homepage only (`card`) — portal.js now also runs on subpages in
        // modal-only mode, and auto-popping this over a roster/board/gallery
        // page would ambush the brother. There, the popup opens only when he
        // actually clicks "My Profile".
        if (!state.profile && card && !sessionStorage.getItem('zbxi_onboard_shown')) {
          sessionStorage.setItem('zbxi_onboard_shown', '1');
          state.wantModal = true;
        }
        if (state.wantModal || (modal && modal.classList.contains('open'))) {
          openModal(); renderProfileArea();
        }
      });
    }).catch(function (err) {
      if (!card) return;               // modal-only pages have no section to show the error in
      target = card;
      h('<div class="portal-msg"><div class="portal-msg__ic">⚠️</div>' +
        '<h3>Something went wrong</h3>' +
        '<p>We couldn\'t load the members area. Please refresh the page and try again.</p>' +
        '<p class="form-note">' + esc(err && err.message ? err.message : 'Unknown error') + '</p></div>');
    });
  }

  /* ---------------- member perks grid ---------------- */
  var PERKS = [
    { ic: '📸', title: 'Private Gallery', blurb: 'Photos from the house & reunions — likes and comments, brothers only.', href: 'gallery.html' },
    { ic: '💬', title: 'Brothers Board', blurb: 'Chapter business, advice, and the job & referral board.', href: 'board.html' },
    { ic: '🌳', title: 'Family Tree', blurb: 'Claim your name and see full profiles across every line.', href: '#family-tree' },
    { ic: '🔎', title: 'Member Directory', blurb: 'Find brothers by class year, city, and profession.', href: 'alumni.html' }
  ];
  function renderPerks(signedIn) {
    if (!perksEl) return;
    perksEl.innerHTML = '<h3 class="perks__title">' + (signedIn ? 'Your member access' : 'What brothers get') + '</h3>' +
      PERKS.map(function (p) {
        return signedIn
          ? '<a class="perk perk--live" href="' + p.href + '"><span class="perk__ic">' + p.ic + '</span><span><b>' + p.title + '</b><small>' + p.blurb + '</small></span><i>→</i></a>'
          : '<div class="perk"><span class="perk__ic">' + p.ic + '</span><span><b>' + p.title + '</b><small>' + p.blurb + '</small></span><i>🔒</i></div>';
      }).join('');
  }

  /* ---------------- signed-in section card ---------------- */
  function renderMemberCard() {
    if (!card) return;               // index-only inline section; modal-only pages skip it
    target = card;
    var pr = state.profile;
    var name = (pr && pr.full_name) || (state.user.email || '').split('@')[0];
    var line = !pr ? 'Your account isn\'t linked to a profile yet — set that up now.'
      : pr.status === 'pending' ? 'Your profile is awaiting verification by chapter leadership.'
      : 'You\'re live on the site. Manage your profile anytime.';
    h('<div class="portal-msg" style="padding:1.4rem 0">' +
      '<div class="portal-msg__ic">🤝</div>' +
      '<h3>Welcome back, ' + esc(name.split(' ')[0]) + '</h3>' +
      '<p>' + line + '</p>' +
      '<button class="btn btn--navy" id="openProfileBtn" style="width:100%">' + (!pr ? 'Set up my profile' : '👤 Manage my profile') + '</button>' +
      signOutBtn() + '</div>');
    wireSignOut();
    card.querySelector('#openProfileBtn').onclick = function () { state.wantModal = true; openModal(); };
  }

  /* ---------------- signed out: sign up / log in / forgot password ---------------- */
  function renderAuth() {
    if (!card) return;               // auth lives in the inline section (index only)
    target = card;
    var signup = state.mode === 'signup';
    var inv = state.invite;
    // Invited brothers get a warm greeting and a pre-filled, locked-in email.
    var banner = inv
      ? '<div class="invite-banner">' +
          (inv.has_account
            ? '<b>👋 Welcome back, brother.</b><span>You already have an account for <b>' + esc(inv.email) + '</b> — just log in.</span>'
            : '<b>🎉 Your invitation is ready.</b><span>Create your account for <b>' + esc(inv.email) + '</b>, then claim your name on the family tree.</span>') +
        '</div>'
      : '';
    var emailVal = inv ? ' value="' + esc(inv.email) + '"' : '';

    h(banner +
      '<div class="portal-tabs">' +
        '<button class="' + (!signup ? 'on' : '') + '" data-tab="signin">Log in</button>' +
        '<button class="' + (signup ? 'on' : '') + '" data-tab="signup">Sign up</button>' +
      '</div>' +
      '<form id="authForm" novalidate>' +
        '<div class="field"><label>Email</label><input type="email" name="email" required' + emailVal + '></div>' +
        '<div class="field"><label>Password</label><input type="password" name="password" minlength="8" required placeholder="8+ characters"' + (inv ? ' autofocus' : '') + '></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">' + (signup ? 'Create account' : 'Log in') + '</button>' +
        '<p class="form-status" id="authStatus" role="status"></p>' +
      '</form>' +
      (signup
        ? '<p class="form-note">Only established brothers should sign up. New profiles are reviewed by chapter leadership once — after that you can edit your profile freely.</p>'
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
        var msg = (err && err.message) || 'Something went wrong.';
        // Signing up with an address that already exists: send them to log in
        // rather than leaving them stuck on an error.
        if (signup && /already registered|already exists|user already/i.test(msg)) {
          state.mode = 'signin';
          if (state.invite) state.invite.has_account = true;
          renderAuth();
          var st2 = card.querySelector('#authStatus');
          st2.className = 'form-status';
          st2.textContent = 'You already have an account for that email — log in below.';
          return;
        }
        st.className = 'form-status err'; st.textContent = msg;
        f.querySelector('button').disabled = false;
      });
    };
  }

  function renderForgot() {
    if (!card) return;
    target = card;
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
    target = mbody || card;
    h('<div class="portal-claim"><h3>Choose a new password</h3>' +
      '<form id="newPwForm" novalidate>' +
        '<div class="field"><label>New password</label><input type="password" name="pw" minlength="8" required placeholder="8+ characters"></div>' +
        '<div class="field"><label>Confirm new password</label><input type="password" name="pw2" minlength="8" required></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">Save new password</button>' +
        '<p class="form-status" id="newPwStatus" role="status"></p>' +
      '</form></div>');
    target.querySelector('#newPwForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = f.querySelector('#newPwStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      if (f.pw.value !== f.pw2.value) { st.className = 'form-status err'; st.textContent = 'Passwords don\'t match.'; return; }
      f.querySelector('button').disabled = true;
      Z.updatePassword(f.pw.value).then(function (r) {
        if (r.error) throw r.error;
        state.recovery = false;
        st.className = 'form-status ok'; st.textContent = '✓ Password updated — signing you in…';
        setTimeout(function () { closeModal(); refresh(); }, 800);
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not update password.';
        f.querySelector('button').disabled = false;
      });
    };
  }

  /* ---------------- popup: profile area ---------------- */
  function renderProfileArea() {
    target = mbody;
    var pr = state.profile;
    if (pr && pr.status === 'pending') return renderPending(pr);
    if (!pr) return renderChooser(); // no profile yet: claim an existing tree entry or create new
    return renderShell(pr); // profile + account tabs
  }

  function renderShell(pr) {
    target = mbody;
    var onAccount = state.tab === 'account';
    h('<div class="portal-tabs">' +
        '<button class="' + (!onAccount ? 'on' : '') + '" data-ptab="profile">My Profile</button>' +
        '<button class="' + (onAccount ? 'on' : '') + '" data-ptab="account">Account</button>' +
      '</div><div id="portalTabBody"></div>');
    mbody.querySelectorAll('[data-ptab]').forEach(function (b) {
      b.onclick = function () { state.tab = b.dataset.ptab; renderShell(pr); };
    });
    if (onAccount) renderAccount(pr); else renderForm(pr);
  }

  /* ---- no profile yet: claim vs create ---- */
  function renderChooser() {
    target = mbody;
    h('<div class="portal-choose">' +
      '<h3>Welcome, brother!</h3>' +
      '<p class="form-note">Most brothers are already in our family tree from the chapter records. Claiming your name links this account to your spot in the tree.</p>' +
      '<button class="portal-choice" id="chooseClaim"><b>🌳 I\'m in the family tree</b><span>Find and claim your name — keeps your lineage intact.</span></button>' +
      '<button class="portal-choice" id="chooseNew"><b>✨ I\'m not in the tree yet</b><span>Create a brand-new profile from scratch.</span></button>' +
      '</div>');
    mbody.querySelector('#chooseClaim').onclick = renderClaim;
    mbody.querySelector('#chooseNew').onclick = function () { renderForm(null, true); };
  }

  function renderClaim() {
    target = mbody;
    h('<div class="portal-claim"><h3>Claim your name</h3>' +
      '<p class="form-note">Search for yourself, then confirm. Chapter leadership verifies every claim before it goes live.</p>' +
      '<div class="field"><label>Search the brotherhood</label><input id="claimSearch" placeholder="Start typing your name…" autocomplete="off"></div>' +
      '<div id="claimList" class="claim-list"></div>' +
      '<p class="form-status" id="claimStatus" role="status"></p>' +
      '<button class="portal-signout" id="claimBack" type="button">← Back</button></div>');
    mbody.querySelector('#claimBack').onclick = renderChooser;

    var listEl = mbody.querySelector('#claimList');
    var input = mbody.querySelector('#claimSearch');
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
          var st = mbody.querySelector('#claimStatus');
          st.className = 'form-status'; st.textContent = 'Claiming…';
          Z.claimProfile(picked.id).then(function (r) {
            var msg = (r && r.data) || '';
            if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
            if (String(msg).indexOf('ok') !== 0) { st.className = 'form-status err'; st.textContent = String(msg).replace('error: ', ''); return; }
            state.wantModal = true;
            refresh(); // -> pending state
          });
        };
      });
    };
  }

  function renderPending(pr) {
    target = mbody;
    h('<div class="portal-msg"><div class="portal-msg__ic">⏳</div>' +
      '<h3>Profile awaiting verification</h3>' +
      '<p>Thanks, <b>' + esc(pr.full_name) + '</b>. Chapter leadership will review your profile shortly. Once approved, you\'ll appear in the brotherhood roster and family tree — and unlock the gallery, board and member directory.</p></div>');
  }

  /* ---- profile form ---- */
  function renderForm(pr, showBack) {
    pr = pr || {};
    var host = mbody.querySelector('#portalTabBody') || mbody;
    var bigOpts = ['<option value="">— none / I\'m a founder —</option>'].concat(
      state.verified.filter(function (b) { return b.id !== pr.id; })
        .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); })
        .map(function (b) { return '<option value="' + b.id + '"' + (pr.big_id === b.id ? ' selected' : '') + '>' + esc(b.full_name) + ' (' + esc(b.pledge_class || '') + ')</option>'; })
    ).join('');
    var prefs = String(pr.contact_prefs || '').split(',');
    function prefBox(key, label) {
      return '<label class="pref-box"><input type="checkbox" name="pref_' + key + '"' +
        (prefs.indexOf(key) !== -1 ? ' checked' : '') + '> ' + label + '</label>';
    }

    // Networking: industry picklist (fixed values so "brothers in your field"
    // matching works) + "open to" flags that power Connect/mentoring.
    var INDUSTRIES = ['Finance & Banking', 'Technology & Software', 'Healthcare & Medicine',
      'Law & Government', 'Engineering', 'Education', 'Marketing & Media',
      'Sales & Business Dev', 'Real Estate & Construction', 'Science & Research',
      'Arts & Entertainment', 'Military & Public Service', 'Student', 'Other'];
    var indOpts = ['<option value="">— pick your field —</option>'].concat(
      INDUSTRIES.map(function (i) { return '<option' + (pr.industry === i ? ' selected' : '') + '>' + i + '</option>'; })
    ).join('');
    var openTo = pr.open_to || [];
    function openBox(key, label) {
      return '<label class="pref-box"><input type="checkbox" name="open_' + key + '"' +
        (openTo.indexOf(key) !== -1 ? ' checked' : '') + '> ' + label + '</label>';
    }

    // Profile completion meter — an empty profile is invisible to the network.
    var CHECKS = [['photo_url', 'a photo'], ['grad_year', 'grad year'], ['city', 'current city'],
      ['occupation', 'occupation'], ['industry', 'industry'], ['linkedin', 'LinkedIn'],
      ['skills', 'skills'], ['bio', 'a short bio']];
    var missing = CHECKS.filter(function (c) { return !pr[c[0]]; });
    var pct = Math.round(100 * (CHECKS.length - missing.length) / CHECKS.length);
    var meter = pct >= 100
      ? '<div class="pmeter pmeter--done">🏅 <b>Profile complete</b> — brothers can find and reach you.</div>'
      : '<div class="pmeter"><div class="pmeter__bar"><i style="width:' + pct + '%"></i></div>' +
        '<span><b>' + pct + '% complete</b> · next: add ' + missing.slice(0, 2).map(function (c) { return c[1]; }).join(' and ') + '</span></div>';

    host.innerHTML =
      (pr.status === 'verified' ? '<p class="portal-live">● You\'re live on the site. Your edits publish immediately.</p>' : '') +
      meter +
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
          (pr.role
            ? '<div class="field"><label>Chapter title</label><input value="' + esc(pr.role + (pr.role_term ? ' · ' + pr.role_term : '')) + '" disabled />' +
              '<p class="form-note" style="margin:.35rem 0 0">Executive-board titles are set by the webmaster. Reach out via the contact form if this needs updating.</p></div>'
            : '') +
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
            fld('LinkedIn', 'linkedin', pr.linkedin, 'url', false, 'https://…') +
          '</div>' +
          '<div class="field"><label>Reach me via</label><div class="pref-row">' +
            prefBox('email', 'Email') + prefBox('phone', 'Phone') + prefBox('linkedin', 'LinkedIn') +
          '</div><p class="form-note" style="margin:.4rem 0 0">Contact details are visible to verified brothers only.</p></div>' +
        '</fieldset>' +
        '<fieldset class="pf-group"><legend>Networking</legend>' +
          '<div class="form-row">' +
            fld('Company / organization', 'company', pr.company, 'text', false, 'e.g. Deloitte') +
            '<div class="field"><label>Industry</label><select name="industry">' + indOpts + '</select></div>' +
          '</div>' +
          '<div class="field"><label>I\'m open to…</label><div class="pref-row">' +
            openBox('mentor', '🎓 Mentoring actives') + openBox('hire', '💼 Hiring & referrals') + openBox('connect', '🤝 Connecting') +
          '</div><p class="form-note" style="margin:.4rem 0 0">These show as badges on your profile so brothers know they can reach out.</p></div>' +
        '</fieldset>' +
        '<fieldset class="pf-group"><legend>Your story</legend>' +
          '<div class="field"><label>Short quote</label><input name="quote" value="' + esc(pr.quote) + '" maxlength="140"></div>' +
          '<div class="field"><label>Bio — your story &amp; memories from the house</label><textarea name="bio">' + esc(pr.bio) + '</textarea></div>' +
          '<div class="field"><label>Skills &amp; interests (great for mentoring)</label><input name="skills" value="' + esc(pr.skills) + '" placeholder="e.g. finance, grad school apps, guitar"></div>' +
          '<div class="field"><label>Profile photo</label><input type="file" name="photo" accept="image/*"></div>' +
        '</fieldset>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">' + (pr.id ? 'Save profile' : 'Submit for verification') + '</button>' +
        '<p class="form-status" id="profStatus" role="status"></p>' +
      '</form>' + (showBack ? '<button class="portal-signout" id="formBack" type="button">← Back</button>' : '');

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
      // Downscale headshots before upload (fast mobile loads, small storage).
      var photoP = file
        ? Z.downscale(file, 800).then(function (blob) {
            blob.name = 'photo.jpg';
            return Z.uploadPhoto(state.user.id, blob);
          })
        : Promise.resolve(pr.photo_url || null);
      photoP.then(function (url) {
        var row = {
          user_id: state.user.id,
          full_name: f.full_name.value.trim(),
          pledge_class: f.pledge_class.value.trim(),
          grad_year: f.grad_year.value ? parseInt(f.grad_year.value, 10) : null,
          major: f.major.value.trim() || null,
          // role / role_scope are intentionally NOT sent — chapter titles are
          // admin-assigned (E-Board console) and the DB guard would ignore them
          // from a brother anyway. See upgrade13.sql.
          big_id: f.big_id.value || null,
          city: f.city.value.trim() || null,
          occupation: f.occupation.value.trim() || null,
          hometown: f.hometown.value.trim() || null,
          phone: f.phone.value.trim() || null,
          email: f.email.value.trim() || null,
          linkedin: f.linkedin.value.trim() || null,
          company: f.company.value.trim() || null,
          industry: f.industry.value || null,
          open_to: ['mentor', 'hire', 'connect'].filter(function (k) { return f['open_' + k].checked; }),
          contact_prefs: chosen.length ? chosen.join(',') : null,
          quote: f.quote.value.trim() || null,
          bio: f.bio.value.trim() || null,
          skills: f.skills.value.trim() || null,
          photo_url: url
          // `status` is never sent from the browser: the guard_status trigger
          // (upgrade12.sql) pins it — new rows start pending, and an approved
          // brother's edits publish immediately without re-review.
        };
        if (pr.id) row.id = pr.id;
        return Z.upsertProfile(row);
      }).then(function (r) {
        if (r.error) throw r.error;
        st.className = 'form-status ok';
        st.textContent = pr.status === 'verified'
          ? '✓ Saved — your profile is updated across the site.'
          : '✓ Submitted — pending verification by chapter leadership.';
        state.wantModal = true;
        setTimeout(refresh, 900);
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not save.';
        btn.disabled = false; btn.textContent = 'Try again';
      });
    };
  }

  /* ---- account settings tab ---- */
  function renderAccount(pr) {
    var host = mbody.querySelector('#portalTabBody');
    var inTree = !!pr.roster_name;
    host.innerHTML =
      '<div class="acct-block"><h4>📬 Email preferences</h4>' +
        '<label class="pref-box"><input type="checkbox" id="digestOpt"' + (pr.email_opt_out ? '' : ' checked') + '> ' +
        'Send me the monthly brotherhood digest</label>' +
        '<p class="form-note" style="margin:.5rem 0 0">Once a month: upcoming events, new job posts on the board, new brothers, and gallery activity. Nothing else, ever.</p>' +
        '<p class="form-status" id="digestStatus" role="status"></p></div>' +
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
      '</div>';

    var digestBox = host.querySelector('#digestOpt');
    if (digestBox) digestBox.onchange = function () {
      var st = host.querySelector('#digestStatus');
      st.className = 'form-status'; st.textContent = 'Saving…';
      Z.setEmailOptOut(state.user.id, !digestBox.checked).then(function (r) {
        if (r.error) throw r.error;
        st.className = 'form-status ok';
        st.textContent = digestBox.checked ? '✓ You\'ll get the monthly digest.' : '✓ Unsubscribed from the digest.';
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not save.';
        digestBox.checked = !digestBox.checked;
      });
    };

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
        state.wantModal = true;
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
    var b = card && card.querySelector('#signOut');
    if (b) b.onclick = function () { Z.signOut().then(function () { state.profile = null; state.mode = 'signin'; state.tab = 'profile'; state.wantModal = false; refresh(); }); };
  }

  refresh();
})();
