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
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

  if (!Z || !Z.configured) {
    if (card) card.innerHTML = '<div class="portal-msg"><div class="portal-msg__ic">🔒</div>' +
      '<h3>Brother sign-in is coming soon</h3>' +
      '<p>The members area is being set up. Soon you\'ll be able to create your brother profile and join the family tree here.</p>' +
      '<p class="form-note">Are you a prospective member instead? <a href="#contact">Reach out here</a>.</p></div>';
    return;
  }

  // `recovery` is seeded from the sessionStorage LATCH (set in supabase-client.js the
  // instant a reset link lands), NOT from the PASSWORD_RECOVERY event alone. That event
  // is fragile: supabase-js scrubs the URL hash, and header-account.js could reload the
  // page — either one lost the signal, after which the restored session looked like an
  // ordinary login and the brother was signed in WITHOUT ever resetting. The latch
  // survives both, so the reset can't be skipped.
  var state = { user: null, profile: null, mode: 'signin', verified: [], tab: 'profile',
                recovery: !!(Z && Z.isRecovery && Z.isRecovery()), loaded: false, wantModal: false,
                invite: null, resetExpired: false };  // resetExpired -> "that link expired" note on the login card

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
    // During password recovery the modal IS the "choose a new password" form.
    // Don't let Escape, a backdrop click, or the ✕ dismiss it into a live
    // session before a new password is actually set — that made the reset link
    // behave like a one-time login. It closes itself once the password is saved.
    if (state.recovery) return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
  }
  // Hide/show the modal's ✕ so recovery can't be dismissed without finishing.
  function setModalCloseVisible(v) {
    var x = modal && modal.querySelector('[data-pm-close]');
    if (x) x.style.display = v ? '' : 'none';
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
    // open('profile' | 'account') — the header dropdown opens the popup straight
    // to the tab the brother picked. No arg = whatever tab he was last on.
    open: function (tab) {
      if (tab === 'profile' || tab === 'account') state.tab = tab;
      state.wantModal = true;
      openModal();
    },
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

  // Password-recovery links land back here with a recovery session. Belt-and-braces:
  // the latch (above) is the source of truth, but if the event fires we set it too.
  Z.onAuth(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      Z.setRecovery();
      state.recovery = true;
      openModal();
    }
  });
  // Latch already set (e.g. the page reloaded mid-reset, or the event fired before
  // this script ran): put the reset form up immediately — don't wait for an event
  // that may never come again.
  if (state.recovery) openModal();

  /* ---------------- main refresh ---------------- */
  function refresh() {
    Z.getUser().then(function (u) {
      state.user = u;
      if (!u) {
        // Latched as "recovering" but no session ever materialised (expired link,
        // already-used link, or a crafted/junk token). There is nothing to reset
        // without a session — drop the latch so we don't strand him on an unusable
        // form, and TELL him why, or the link looks like it silently did nothing.
        if (state.recovery) {
          Z.clearRecovery(); state.recovery = false; setModalCloseVisible(true);
          state.resetExpired = true;
        }
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
      return Z.mfaAAL().catch(function () { return {}; }).then(function (aal) {
        var d = aal && aal.data;   // AAL glitch -> {} -> d undefined -> no gate, normal render
        // 2FA gate: a brother with a verified authenticator who has only completed
        // the password step is at aal1 — hold the members area until he enters his
        // 6-digit code. Enforced on the homepage card (where sign-in happens); once
        // verified the session is aal2 site-wide. Skipped during password recovery,
        // which is its own aal1 flow that must reach the new-password form.
        if (card && !state.recovery && d && d.currentLevel === 'aal1' && d.nextLevel === 'aal2') {
          state.loaded = true; state.profile = null;
          closeModal(); renderPerks(false); renderMfaChallenge();
          return;
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
          // A password-recovery session must land on — and STAY on — the "choose a
          // new password" form; it must never fall through to the profile. Without
          // this guard, refresh() painted the profile over the recovery form a beat
          // after it appeared, so clicking the email link looked like it just logged
          // you straight in (never letting you set a new password). openModal()
          // itself renders the recovery form when state.recovery is set.
          if (state.recovery) {
            openModal();
          } else if (state.wantModal || (modal && modal.classList.contains('open'))) {
            openModal(); renderProfileArea();
          }
        });
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
    // One-time confirmation after a password reset (then log in with the new one).
    // A reset link that expired / was already used lands here with no session, so the
    // reset form can't run. Say so — otherwise the brother clicks the link, sees a
    // plain login page, and thinks the link silently did nothing.
    var resetNote = '';
    if (state.resetExpired) {
      state.resetExpired = false;
      resetNote = '<div class="invite-banner"><b>⏳ That reset link has expired.</b>' +
        '<span>Reset links last one hour and work only once. Choose <b>Forgot your password?</b> below to get a fresh one.</span></div>';
    }
    // Invited brothers get a warm greeting and a pre-filled, locked-in email.
    var banner = inv
      ? '<div class="invite-banner">' +
          (inv.has_account
            ? '<b>👋 Welcome back, brother.</b><span>You already have an account for <b>' + esc(inv.email) + '</b> — just log in.</span>'
            : '<b>🎉 Your invitation is ready.</b><span>Create your account for <b>' + esc(inv.email) + '</b>, then claim your name on the family tree.</span>') +
        '</div>'
      : '';
    var emailVal = inv ? ' value="' + esc(inv.email) + '"' : '';

    h(resetNote + banner +
      '<div class="portal-tabs">' +
        '<button class="' + (!signup ? 'on' : '') + '" data-tab="signin">Log in</button>' +
        '<button class="' + (signup ? 'on' : '') + '" data-tab="signup">Sign up</button>' +
      '</div>' +
      '<form id="authForm" novalidate>' +
        '<div class="field"><label>Email</label><input type="email" name="email" required' + emailVal + '></div>' +
        '<div class="field"><label>Password</label><input type="password" name="password" minlength="8" required placeholder="8+ characters"' + (inv ? ' autofocus' : '') + '></div>' +
        '<div class="ts-holder" id="tsAuth"></div>' +
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

    var capAuth = window.ZBXITurnstile ? ZBXITurnstile.render(card.querySelector('#tsAuth')) : null;
    card.querySelector('#authForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, email = f.email.value.trim(), pw = f.password.value;
      var st = card.querySelector('#authStatus');
      st.className = 'form-status'; st.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var p = signup ? Z.signUp(email, pw, capAuth && capAuth.token()) : Z.signIn(email, pw, capAuth && capAuth.token());
      f.querySelector('button').disabled = true;
      p.then(function (r) {
        if (r.error) throw r.error;
        if (signup && r.data && !r.data.session) {
          // INVITED brother: his invite token already proved his inbox, so confirm
          // his email server-side and log him straight in — no second confirmation
          // email. FAIL-SAFE: any hiccup falls back to the normal confirm-email
          // flow, so this can never leave an invited brother stuck.
          var invTok = state.invite ? inviteToken() : null;
          if (invTok) {
            st.className = 'form-status'; st.textContent = 'Finishing setup…';
            Z.confirmInvited(invTok).then(function (c) {
              if (c.error || !c.data) {                 // token didn't confirm -> normal email flow
                st.className = 'form-status ok'; st.textContent = '✓ Check your email to confirm, then log in.';
                f.querySelector('button').disabled = false;
                return;
              }
              return (window.ZBXITurnstile && ZBXITurnstile.getToken ? ZBXITurnstile.getToken() : Promise.resolve(''))
                .then(function (tok) { return Z.signIn(email, pw, tok); })
                .then(function (r2) {
                  if (r2.error) {                       // confirmed, but couldn't auto-login -> ask him to log in
                    state.mode = 'signin'; if (state.invite) state.invite.has_account = true;
                    renderAuth();
                    var st2 = card.querySelector('#authStatus');
                    if (st2) { st2.className = 'form-status ok'; st2.textContent = '✓ Your account is ready — log in with the password you just set.'; }
                    return;
                  }
                  refresh();                            // logged straight in
                });
            }).catch(function () {
              st.className = 'form-status ok'; st.textContent = '✓ Check your email to confirm, then log in.';
              f.querySelector('button').disabled = false;
            });
            return;
          }
          // non-invited signup: normal confirm-email flow
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
        if (capAuth) capAuth.reset();
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
        '<div class="ts-holder" id="tsReset"></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">Send reset link</button>' +
        '<p class="form-status" id="resetStatus" role="status"></p>' +
      '</form>' +
      '<button class="portal-signout" id="resetBack" type="button">← Back to log in</button></div>');
    card.querySelector('#resetBack').onclick = function () { state.mode = 'signin'; renderAuth(); };
    var capReset = window.ZBXITurnstile ? ZBXITurnstile.render(card.querySelector('#tsReset')) : null;
    card.querySelector('#resetForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = card.querySelector('#resetStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      f.querySelector('button').disabled = true;
      Z.resetPassword(f.email.value.trim(), capReset && capReset.token()).then(function (r) {
        if (r.error) throw r.error;
        st.className = 'form-status ok';
        st.textContent = '✓ Check your email for the reset link.';
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not send the link.';
        if (capReset) capReset.reset();
        f.querySelector('button').disabled = false;
      });
    };
  }

  /* ---------------- 2FA: enter your code to finish signing in ----------------
     Shown by refresh() when the session is aal1 but the account has a verified
     authenticator (nextLevel aal2). Verifying upgrades the session to aal2. */
  function renderMfaChallenge() {
    if (!card) return;
    target = card;
    h('<div class="portal-claim"><h3>🔐 Two-step verification</h3>' +
      '<p class="form-note">Enter the 6-digit code from your authenticator app to finish signing in.</p>' +
      '<form id="mfaForm" novalidate>' +
        '<div class="field"><label>6-digit code</label>' +
          '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456" autofocus></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">Verify</button>' +
        '<p class="form-status" id="mfaStatus" role="status"></p>' +
      '</form>' +
      '<button class="portal-signout" id="mfaCancel" type="button">← Cancel and sign out</button></div>');
    card.querySelector('#mfaCancel').onclick = function () {
      // Don't leave them stranded at aal1 — sign out fully and reload to the login card.
      Z.signOut().then(function () { location.reload(); });
    };
    card.querySelector('#mfaForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = card.querySelector('#mfaStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var btn = f.querySelector('button');
      btn.disabled = true; st.className = 'form-status'; st.textContent = 'Verifying…';
      Z.mfaVerifiedTotp().then(function (factor) {
        if (!factor) { refresh(); return null; }        // no factor after all — just proceed
        return Z.mfaChallengeVerify(factor.id, f.code.value).then(function (r) {
          if (r.error) {
            st.className = 'form-status err'; st.textContent = 'That code isn\'t right — try again.';
            f.code.value = ''; f.code.focus(); btn.disabled = false; return;
          }
          refresh();                                     // session is now aal2 -> members area
        });
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = (err && err.message) || 'Could not verify the code.';
        btn.disabled = false;
      });
    };
  }

  /* ---------------- 2FA account settings: status / enroll / turn off ----------------
     Renders into the #mfa2fa box inside the Account tab. Self-re-rendering as the
     brother moves through set-up -> on, or on -> off. */
  function renderTwoFactor(box) {
    if (!box) return;
    box.innerHTML = '<p class="form-note">Checking…</p>';
    Z.mfaVerifiedTotp().then(function (factor) {
      if (factor) {
        // ON: to turn it off, prove possession of the authenticator with a live code.
        box.innerHTML =
          '<p class="mfa-on">✅ Two-factor is <b>on</b>. You\'ll enter a code from your authenticator app each time you log in.</p>' +
          '<form id="mfaOffForm" novalidate>' +
            '<div class="field"><label>Enter a current code to turn it off</label>' +
              '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456"></div>' +
            '<button class="btn btn--ghost-danger" type="submit">Turn off two-factor</button>' +
            '<p class="form-status" id="mfaOffStatus" role="status"></p>' +
          '</form>' +
          '<p class="form-note" style="margin:.6rem 0 0">Lost your authenticator? Ask the webmaster to reset it for you.</p>';
        box.querySelector('#mfaOffForm').onsubmit = function (e) {
          e.preventDefault();
          var f = e.target, st = box.querySelector('#mfaOffStatus'), btn = f.querySelector('button');
          if (!f.checkValidity()) { f.reportValidity(); return; }
          btn.disabled = true; st.className = 'form-status'; st.textContent = 'Verifying…';
          Z.mfaChallengeVerify(factor.id, f.code.value).then(function (r) {
            if (r.error) { st.className = 'form-status err'; st.textContent = 'That code isn\'t right.'; btn.disabled = false; return; }
            return Z.mfaUnenroll(factor.id).then(function (r2) {
              if (r2.error) throw r2.error;
              renderTwoFactor(box);
            });
          }).catch(function (err) {
            st.className = 'form-status err'; st.textContent = (err && err.message) || 'Could not turn it off.'; btn.disabled = false;
          });
        };
      } else {
        // OFF: offer set-up.
        box.innerHTML =
          '<p class="form-note">Add a second step at login with an authenticator app (Google Authenticator, Authy, 1Password, and the like). Even if someone learns your password, they can\'t get in without your phone.</p>' +
          '<button class="btn btn--navy" id="mfaSetupBtn" type="button">Set up two-factor</button>' +
          '<p class="form-status" id="mfaSetupStatus" role="status"></p>';
        box.querySelector('#mfaSetupBtn').onclick = function () { startMfaEnroll(box); };
      }
    }).catch(function () {
      box.innerHTML = '<p class="form-status err">Could not load two-factor settings — refresh and try again.</p>';
    });
  }

  function startMfaEnroll(box) {
    box.innerHTML = '<p class="form-note">Preparing your setup code…</p>';
    Z.mfaEnroll().then(function (r) {
      if (r.error) throw r.error;
      var d = r.data || {}, factorId = d.id, qr = d.totp && d.totp.qr_code, secret = d.totp && d.totp.secret;
      box.innerHTML =
        '<p class="form-note"><b>1.</b> Scan this with your authenticator app (or type the key by hand), then <b>2.</b> enter the 6-digit code it shows.</p>' +
        (qr ? '<div class="mfa-qr"><img alt="Two-factor QR code" src="' + esc(qr) + '"></div>' : '') +
        (secret ? '<p class="mfa-secret">Manual key: <code>' + esc(secret) + '</code></p>' : '') +
        '<form id="mfaEnrollForm" novalidate>' +
          '<div class="field"><label>6-digit code</label>' +
            '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456" autofocus></div>' +
          '<button class="btn btn--navy" type="submit">Turn on two-factor</button> ' +
          '<button class="btn btn--ghost" id="mfaEnrollCancel" type="button">Cancel</button>' +
          '<p class="form-status" id="mfaEnrollStatus" role="status"></p>' +
        '</form>';
      box.querySelector('#mfaEnrollCancel').onclick = function () { renderTwoFactor(box); };
      box.querySelector('#mfaEnrollForm').onsubmit = function (e) {
        e.preventDefault();
        var f = e.target, st = box.querySelector('#mfaEnrollStatus'), btn = f.querySelector('button[type=submit]');
        if (!f.checkValidity()) { f.reportValidity(); return; }
        btn.disabled = true; st.className = 'form-status'; st.textContent = 'Verifying…';
        Z.mfaChallengeVerify(factorId, f.code.value).then(function (r2) {
          if (r2.error) { st.className = 'form-status err'; st.textContent = 'That code isn\'t right — check the app and try again.'; btn.disabled = false; return; }
          renderTwoFactor(box);
        }).catch(function (err) {
          st.className = 'form-status err'; st.textContent = (err && err.message) || 'Could not turn on two-factor.'; btn.disabled = false;
        });
      };
    }).catch(function (err) {
      box.innerHTML = '<p class="form-status err">Could not start setup: ' + esc((err && err.message) || 'unknown error') + '</p>' +
        '<button class="btn btn--ghost" id="mfaRetry" type="button">Try again</button>';
      box.querySelector('#mfaRetry').onclick = function () { renderTwoFactor(box); };
    });
  }

  function renderNewPassword() {
    target = mbody || card;
    setModalCloseVisible(false);   // must finish the reset — no dismissing out of it
    h('<div class="portal-claim"><h3>Choose a new password</h3>' +
      '<p class="form-note">For your security, set a new password to finish signing in. This link won’t work again.</p>' +
      '<form id="newPwForm" novalidate>' +
        '<div class="field"><label>New password</label><input type="password" name="pw" minlength="8" required placeholder="8+ characters"></div>' +
        '<div class="field"><label>Confirm new password</label><input type="password" name="pw2" minlength="8" required></div>' +
        '<button class="btn btn--navy" style="width:100%" type="submit">Save new password</button>' +
        '<p class="form-status" id="newPwStatus" role="status"></p>' +
      '</form>' +
      // Escape hatch: the form can't be dismissed, so give an explicit way out that
      // ENDS the recovery session rather than leaving him signed in without resetting.
      '<button class="portal-signout" id="newPwCancel" type="button">Cancel and sign out</button></div>');

    target.querySelector('#newPwCancel').onclick = function () {
      Z.clearRecovery();
      var bail = function () {
        state.recovery = false; state.mode = 'signin';
        state.user = null; state.profile = null; state.wantModal = false;
        setModalCloseVisible(true);
        closeModal();
        refresh();
      };
      Z.signOut().then(bail).catch(bail);
    };

    target.querySelector('#newPwForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = f.querySelector('#newPwStatus');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      if (f.pw.value !== f.pw2.value) { st.className = 'form-status err'; st.textContent = 'Passwords don\'t match.'; return; }
      f.querySelector('button').disabled = true;
      Z.updatePassword(f.pw.value).then(function (r) {
        if (r.error) throw r.error;
        // Released here and in "Cancel and sign out" — and nowhere else. Both end
        // the recovery session, so the link can never leave him signed in unreset.
        Z.clearRecovery();
        state.recovery = false;
        setModalCloseVisible(true);   // reset done — the modal is dismissable again
        st.className = 'form-status ok'; st.textContent = '✓ Password updated — you’re all set.';
        // Signing him straight in is safe and is what every other site does: he
        // proved he controls the email AND just set a new password. (The danger was
        // ever being signed in WITHOUT resetting — the latch prevents that.)
        state.wantModal = false;
        setTimeout(function () { closeModal(); refresh(); }, 900);
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = err.message || 'Could not update password.';
        f.querySelector('button').disabled = false;
      });
    };
  }

  /* ---------------- popup: profile area ---------------- */
  function renderProfileArea() {
    target = mbody;
    setModalCloseVisible(true);   // normal profile view is always dismissable
    var pr = state.profile;
    if (pr && pr.status === 'pending') return renderPending(pr);
    if (!pr) return renderChooser(); // no profile yet: claim an existing tree entry or create new
    return renderShell(pr); // profile + account tabs
  }

  function renderShell(pr) {
    target = mbody;
    var onAccount = state.tab === 'account';
    h('<div class="pf-masthead"><img class="pf-masthead__crest" src="assets/img/crest-sm.png" alt="" />' +
        '<span class="pf-masthead__eyebrow">Zeta Beta Xi · Brother Registry</span></div>' +
      '<div class="portal-tabs">' +
        '<button class="' + (!onAccount ? 'on' : '') + '" data-ptab="profile">Brother Profile</button>' +
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
          '<div class="field"><label>Chapter title</label>' +
            (pr.role
              ? '<input value="' + esc(pr.role + (pr.role_term ? ' · ' + pr.role_term : '')) + '" disabled />'
              : '<input value="— none yet —" disabled />') +
            '<div id="titleReqBox"></div>' +
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

    wireTitleRequest(host, pr);

    host.querySelector('#profForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = host.querySelector('#profStatus');
      st.className = 'form-status'; st.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';

      var chosen = ['email', 'phone', 'linkedin'].filter(function (k) { return f['pref_' + k].checked; });
      var file = f.photo.files[0];
      // Downscale headshots before upload (fast mobile loads, small storage).
      // No new upload -> keep the stored PATH (`_photo_path`), never the signed URL
      // that `pr.photo_url` currently holds — that expires, and writing it back
      // would kill the photo in a few hours.
      var photoP = file
        ? Z.downscale(file, 800).then(function (blob) {
            blob.name = 'photo.jpg';
            return Z.uploadPhoto(state.user.id, blob);   // returns the storage path
          })
        : Promise.resolve(pr._photo_path || pr.photo_url || null);
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
  /* ---- Request a chapter title -------------------------------------------
     Titles used to be admin-only and invisible to the brother. Now he can ASK:
     pick one of the known titles, or type a "random"/forgotten historical one
     (plenty of old titles exist that nobody has a record of). Season + Year are
     selects so everything lands in the same `Title · Season Year` shape.

     He is only ever writing a REQUEST row. He still cannot write `role` on his
     own brothers row (tg_guard_status), and he has no UPDATE policy on his own
     request, so he can't approve himself. The admin's approval is the only path. */
  var SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
  var KNOWN_TITLES = ['President', 'Vice President', 'Treasurer', 'Secretary',
                      'Pledge Master', 'Rush Chair', 'Social Chair', 'Philanthropy Chair',
                      'Risk Manager', 'Alumni Chair', 'House Manager', 'Historian', 'Webmaster'];

  function wireTitleRequest(host, pr) {
    var box = host.querySelector('#titleReqBox');
    if (!box || !state.user) return;

    function form(prev) {
      // A decided request is shown, then he may ask again.
      var banner = '';
      if (prev && prev.status === 'pending') {
        return box.innerHTML =
          '<div class="title-req title-req--wait">⏳ <b>Requested:</b> ' + esc(prev.title) + ' · ' + esc(prev.term) +
          '<span>Awaiting approval from chapter leadership. You\'ll get a notification when it\'s decided.</span></div>';
      }
      if (prev && prev.status === 'rejected') {
        banner = '<div class="title-req title-req--no">Your last request (' + esc(prev.title) + ' · ' + esc(prev.term) + ') wasn\'t approved. You can ask again below.</div>';
      }

      var y = new Date().getFullYear(), years = '';
      for (var i = y + 1; i >= 1993; i--) years += '<option>' + i + '</option>';

      box.innerHTML = banner +
        '<details class="title-req-open"><summary>🏅 Request a chapter title</summary>' +
          '<div class="title-req-form">' +
            '<div class="field"><label>Title</label><select id="trTitle">' +
              KNOWN_TITLES.map(function (t) { return '<option>' + t + '</option>'; }).join('') +
              '<option value="__custom">✍️ Other — type it myself…</option>' +
            '</select></div>' +
            '<div class="field" id="trCustomWrap" hidden><label>Custom title</label>' +
              '<input id="trCustom" maxlength="60" placeholder="e.g. Door Duty Chair" /></div>' +
            '<div class="form-row">' +
              '<div class="field"><label>Season</label><select id="trSeason">' +
                SEASONS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div>' +
              '<div class="field"><label>Year</label><select id="trYear">' + years + '</select></div>' +
            '</div>' +
            '<div class="field"><label>Anything leadership should know? (optional)</label>' +
              '<textarea id="trNote" maxlength="300" rows="2" placeholder="e.g. I held this in 2019 — Matt O\'Sullivan can vouch."></textarea></div>' +
            '<button class="btn btn--navy" id="trSend" type="button">Send request</button>' +
            '<p class="form-status" id="trStatus" role="status"></p>' +
            '<p class="form-note" style="margin:.4rem 0 0">Leadership reviews every request. Official E-Board seats are verified before they appear on the board.</p>' +
          '</div>' +
        '</details>';

      var sel = box.querySelector('#trTitle');
      var wrap = box.querySelector('#trCustomWrap');
      sel.onchange = function () { wrap.hidden = sel.value !== '__custom'; };

      box.querySelector('#trSend').onclick = function () {
        var st = box.querySelector('#trStatus');
        var title = sel.value === '__custom' ? (box.querySelector('#trCustom').value || '').trim() : sel.value;
        var term = box.querySelector('#trSeason').value + ' ' + box.querySelector('#trYear').value;
        var note = (box.querySelector('#trNote').value || '').trim();
        if (title.length < 2) { st.className = 'form-status err'; st.textContent = 'Type the title you\'re requesting.'; return; }
        st.className = 'form-status'; st.textContent = 'Sending…';
        Z.titleRequestCreate(state.user.id, pr.id, title, term, note).then(function (r) {
          if (r.error) throw r.error;
          form({ status: 'pending', title: title, term: term });
        }).catch(function (err) {
          st.className = 'form-status err';
          st.textContent = /duplicate|unique/i.test(err.message || '')
            ? 'You already have a request awaiting a decision.'
            : (err.message || 'Could not send the request.');
        });
      };
    }

    Z.titleRequestMine(state.user.id).then(form).catch(function () { form(null); });
  }

  function renderAccount(pr) {
    var host = mbody.querySelector('#portalTabBody');
    var inTree = !!pr.roster_name;
    var acctEmail = (state.user && state.user.email) || '';
    var dangerLabel = inTree ? 'Disconnect from the family tree' : 'Delete my profile';
    host.innerHTML =
      '<div class="acct-block"><h4>🔑 Sign-in email</h4>' +
        '<p class="acct-email">' + esc(acctEmail) + '</p>' +
        // autocomplete=off + the readonly-until-focus trick: Chrome sees an
        // email+password pair, assumes it's a login form, and autofills it (painting
        // its own light background over the theme). Both are needed — Chrome ignores
        // autocomplete=off on its own, but it will not autofill a readonly field.
        '<form id="emailForm" novalidate autocomplete="off">' +
          '<div class="form-row">' +
            '<div class="field"><label>New sign-in email</label><input type="email" name="newEmail" required autocomplete="off" readonly data-unlock placeholder="you@example.com"></div>' +
            '<div class="field"><label>Current password</label><input type="password" name="epw" required autocomplete="off" readonly data-unlock placeholder="Confirm it\'s you"></div>' +
          '</div>' +
          '<div class="ts-holder" id="tsEmail"></div>' +
          '<button class="btn btn--navy" type="submit">Change sign-in email</button>' +
          '<p class="form-status" id="emailStatus" role="status"></p>' +
        '</form>' +
        '<p class="form-note" style="margin:.6rem 0 0">We send a confirmation link to the new address — your sign-in email only changes once you click it. This is <b>separate</b> from the contact email on your profile.</p></div>' +
      '<div class="acct-block"><h4>📬 Email preferences</h4>' +
        '<label class="pref-box"><input type="checkbox" id="digestOpt"' + (pr.email_opt_out ? '' : ' checked') + '> ' +
        'Send me the monthly brotherhood digest</label>' +
        '<p class="form-note" style="margin:.5rem 0 0">Once a month: upcoming events, new job posts on the board, new brothers, and gallery activity. Nothing else, ever.</p>' +
        '<p class="form-status" id="digestStatus" role="status"></p></div>' +
      '<div class="acct-block"><h4>Change password</h4>' +
        '<form id="pwForm" novalidate>' +
          '<div class="field"><label>Current password</label><input type="password" name="oldpw" required autocomplete="current-password" placeholder="Your password today"></div>' +
          '<div class="form-row">' +
            '<div class="field"><label>New password</label><input type="password" name="pw" minlength="8" required autocomplete="new-password" placeholder="8+ characters"></div>' +
            '<div class="field"><label>Confirm</label><input type="password" name="pw2" minlength="8" required autocomplete="new-password"></div>' +
          '</div>' +
          '<div class="ts-holder" id="tsPw"></div>' +
          '<button class="btn btn--navy" type="submit">Update password</button>' +
          '<p class="form-status" id="pwStatus" role="status"></p>' +
        '</form></div>' +
      '<div class="acct-block"><h4>🔐 Two-factor authentication</h4>' +
        '<div id="mfa2fa"><p class="form-note">Checking…</p></div></div>' +
      '<div class="acct-block acct-block--danger"><h4>Family tree link</h4>' +
        (inTree
          ? '<p class="form-note">This account is linked to <b>' + esc(pr.roster_name) + '</b> in the family tree. Disconnecting returns that name to the tree (unclaimed, details cleared) and lets it be claimed again.</p>'
          : '<p class="form-note">This profile was created from scratch (not claimed from the tree). Disconnecting will <b>delete</b> this profile entirely.</p>') +
        '<button class="btn btn--ghost-danger" id="releaseBtn" type="button">' + dangerLabel + '</button>' +
        // step 2: an explicit, typed acknowledgement. A single click should never be
        // able to destroy a profile — this panel only appears after the first click.
        '<div class="danger-confirm" id="dangerConfirm" hidden>' +
          '<p><b>⚠️ Are you sure? This cannot be undone.</b></p>' +
          '<ul>' +
            (inTree
              ? '<li>Your name returns to the family tree as <b>unclaimed</b>.</li><li>Your bio, photo, city, job and contact details are <b>erased</b>.</li>'
              : '<li>Your profile is <b>permanently deleted</b>.</li><li>Your bio, photo, city, job and contact details are <b>erased</b>.</li>') +
            '<li>You keep your login, but you will have to set your profile up again from scratch.</li>' +
          '</ul>' +
          '<div class="field"><label>Type <b>DELETE</b> to confirm</label>' +
            '<input id="dangerWord" autocomplete="off" placeholder="DELETE"></div>' +
          '<div class="danger-actions">' +
            '<button class="btn btn--ghost" id="dangerCancel" type="button">Cancel — keep my profile</button>' +
            '<button class="btn btn--danger" id="dangerGo" type="button" disabled>Yes, ' + dangerLabel.toLowerCase() + '</button>' +
          '</div>' +
        '</div>' +
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

    // Drop the anti-autofill `readonly` the moment the brother actually clicks in,
    // so the fields behave completely normally for him.
    host.querySelectorAll('[data-unlock]').forEach(function (i) {
      var free = function () { i.removeAttribute('readonly'); };
      i.addEventListener('focus', free);
      i.addEventListener('pointerdown', free);
    });

    /* Change the sign-in email. Gated on the current password: an open session
       could otherwise repoint the account to an attacker's inbox and then use
       "forgot password" to take it over outright. */
    var capEmail = window.ZBXITurnstile ? ZBXITurnstile.render(host.querySelector('#tsEmail')) : null;
    host.querySelector('#emailForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = host.querySelector('#emailStatus');
      var btn = f.querySelector('button[type=submit]');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var next = f.newEmail.value.trim().toLowerCase();
      if (next === (acctEmail || '').toLowerCase()) {
        st.className = 'form-status err'; st.textContent = 'That\'s already your sign-in email.'; return;
      }
      btn.disabled = true;
      st.className = 'form-status'; st.textContent = 'Checking your password…';
      Z.verifyPassword(acctEmail, f.epw.value, capEmail && capEmail.token()).then(function (v) {
        if (v.error) {
          st.className = 'form-status err'; st.textContent = 'That password isn\'t right.';
          if (capEmail) capEmail.reset();
          btn.disabled = false; return null;
        }
        return Z.updateEmail(next).then(function (r) {
          if (r.error) throw r.error;
          st.className = 'form-status ok';
          st.textContent = '✓ Confirmation link sent to ' + next + '. Click it to finish — until then you still log in with ' + acctEmail + '.';
          f.reset();
          btn.disabled = false;
        });
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = (err && err.message) || 'Could not change the email.';
        if (capEmail) capEmail.reset();
        btn.disabled = false;
      });
    };

    var capPw = window.ZBXITurnstile ? ZBXITurnstile.render(host.querySelector('#tsPw')) : null;
    host.querySelector('#pwForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, st = host.querySelector('#pwStatus');
      var btn = f.querySelector('button[type=submit]');
      if (!f.checkValidity()) { f.reportValidity(); return; }
      if (f.pw.value !== f.pw2.value) { st.className = 'form-status err'; st.textContent = 'The new passwords don\'t match.'; return; }
      if (f.pw.value === f.oldpw.value) { st.className = 'form-status err'; st.textContent = 'That\'s already your current password.'; return; }

      btn.disabled = true;
      st.className = 'form-status'; st.textContent = 'Checking your current password…';
      // Prove the OLD password before changing it (Supabase doesn't ask for it).
      Z.verifyPassword(acctEmail, f.oldpw.value, capPw && capPw.token()).then(function (v) {
        if (v.error) {
          st.className = 'form-status err';
          st.textContent = 'That current password isn\'t right.';
          if (capPw) capPw.reset();
          btn.disabled = false;
          return null;
        }
        return Z.updatePassword(f.pw.value).then(function (r) {
          if (r.error) throw r.error;
          st.className = 'form-status ok'; st.textContent = '✓ Password updated. Use the new one next time you log in.';
          f.reset();
          btn.disabled = false;
        });
      }).catch(function (err) {
        st.className = 'form-status err'; st.textContent = (err && err.message) || 'Could not update.';
        if (capPw) capPw.reset();
        btn.disabled = false;
      });
    };

    renderTwoFactor(host.querySelector('#mfa2fa'));

    /* Two-step destroy. Click 1 only REVEALS the consequences; nothing happens
       until the brother types DELETE and clicks the second button. */
    var panel = host.querySelector('#dangerConfirm');
    var word  = host.querySelector('#dangerWord');
    var go    = host.querySelector('#dangerGo');
    var relBtn = host.querySelector('#releaseBtn');

    relBtn.onclick = function () {
      panel.hidden = false;
      relBtn.style.display = 'none';
      word.value = ''; go.disabled = true;
      word.focus();
    };
    host.querySelector('#dangerCancel').onclick = function () {
      panel.hidden = true;
      relBtn.style.display = '';
      host.querySelector('#releaseStatus').textContent = '';
    };
    word.oninput = function () { go.disabled = word.value.trim().toUpperCase() !== 'DELETE'; };

    go.onclick = function () {
      if (word.value.trim().toUpperCase() !== 'DELETE') return;
      var st = host.querySelector('#releaseStatus');
      go.disabled = true;
      st.className = 'form-status'; st.textContent = 'Working…';
      Z.releaseProfile().then(function (r) {
        var out = (r && r.data) || '';
        if (r.error) { st.className = 'form-status err'; st.textContent = r.error.message; go.disabled = false; return; }
        if (String(out).indexOf('ok') !== 0) { st.className = 'form-status err'; st.textContent = String(out).replace('error: ', ''); go.disabled = false; return; }
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
