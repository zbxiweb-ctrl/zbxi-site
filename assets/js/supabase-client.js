/* Supabase bootstrap + shared data helpers for Zeta Beta Xi.
   Depends on the @supabase/supabase-js UMD bundle (loaded via CDN before this)
   and window.ZBXI_CONFIG (config.js). Exposes window.ZBXI. */
(function () {
  'use strict';

  var cfg = window.ZBXI_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    window.supabase && typeof window.supabase.createClient === 'function');

  /* ---- RECOVERY LATCH (must run before createClient) -----------------------
     A password-reset email lands here as  #...&type=recovery  (or ?type=recovery).
     Two things then race to destroy that fact:
       1. supabase-js consumes the tokens and SCRUBS the hash, and
       2. header-account.js may reload the page on an auth-identity change.
     Either one loses the in-memory PASSWORD_RECOVERY signal, after which the
     restored session looks like an ordinary login — which is exactly how the
     reset link ended up silently signing brothers in without resetting.
     So latch it in sessionStorage the instant the page loads, before the client
     exists. It survives reloads and is cleared only when the password is
     actually changed (or the brother cancels).

     Require an access_token ALONGSIDE type=recovery: a real Supabase recovery
     redirect always carries one. Latching on a bare `#type=recovery` would let a
     crafted link force a "choose a new password" prompt on any signed-in brother.
     (A junk token can't survive either — refresh() drops the latch if no session
     actually materialises, since you cannot change a password without one.) */
  try {
    var h = (location.hash || '') + '&' + (location.search || '');
    if (/\btype=recovery\b/.test(h) && /\baccess_token=/.test(h)) {
      sessionStorage.setItem('zbxi_recovery', '1');
    }
  } catch (e) { /* private mode — fall back to the in-memory event */ }

  var client = null;
  if (configured) {
    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) { configured = false; }
  }

  var Z = {
    configured: configured,
    client: client,
    adminEmail: (cfg.ADMIN_EMAIL || '').toLowerCase(),

    /* ---- "I'm open to…" — the one definition (upgrade55) ---------------------
       These three keys were previously re-typed from scratch in five files
       (portal.js, profile-card.js, mentor-page.js, brothers-page.js, main.js)
       plus the digest, each with its own wording — which is how "Hiring &
       referrals" and "hiring & referrals" and "💼" ended up describing the same
       flag differently depending on which page you were looking at.

       `key` is what the database stores and what brothers_open_to_valid
       enforces. Everything else is presentation, and the split exists because
       the same flag has to read correctly in four different places:
         label — the checkbox on your own profile ("Being a Mentor")
         desc  — the line under that checkbox, why you would tick it
         chip  — the badge on your profile card, seen by other brothers
         title — the tooltip on the little icon in a roster grid
       A mentor is described from HIS side; a mentee from his own side too —
       he is the one asking, and the copy should not make that sound like a
       lesser thing. */
    OPEN_TO: [
      { key: 'mentor', icon: '🎓',
        label: 'Being a Mentor',
        desc: 'Career advice, industry questions, a look at a résumé, or a foot in the door.',
        chip: '🎓 Open to mentoring', title: 'mentoring' },
      { key: 'mentee', icon: '🌱',
        label: 'Being a Mentee',
        desc: 'Hiring, referrals, advice — you\'re the one asking, and that\'s the point.',
        chip: '🌱 Looking for a mentor', title: 'looking for a mentor' },
      { key: 'connect', icon: '🤝',
        label: 'Connecting',
        desc: 'No agenda. Grab a coffee, catch a game, say hello in a new city.',
        chip: '🤝 Open to connecting', title: 'connecting' }
    ],
    // Lookup by key, for the render paths that iterate a brother's own flags.
    openTo: function (key) {
      var all = this.OPEN_TO;
      for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
      return null;
    },

    /* ---- password-recovery latch (see the block above) ---- */
    // True from the moment a reset link lands until the password is actually
    // changed — survives the hash scrub AND a full page reload.
    isRecovery: function () {
      try { return sessionStorage.getItem('zbxi_recovery') === '1'; } catch (e) { return false; }
    },
    setRecovery: function () {
      try { sessionStorage.setItem('zbxi_recovery', '1'); } catch (e) {}
    },
    clearRecovery: function () {
      try { sessionStorage.removeItem('zbxi_recovery'); } catch (e) {}
    },

    /* ---- auth ---- */
    // SYNCHRONOUS hint: does a session probably exist? (supabase-js keeps it in
    // localStorage under sb-<ref>-auth-token). Lets a gated page paint its skeleton
    // instantly instead of sitting blank through the ~200ms async auth check —
    // while signed-out visitors still go straight to the lock, never teased with
    // a skeleton for content they can't see. A hint only: getUser() is the truth.
    hasSessionHint: function () {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          if (/^sb-.+-auth-token$/.test(localStorage.key(i))) return true;
        }
      } catch (e) {}
      return false;
    },
    // Deduped for the page's life: ~5 scripts ask on every load, one request
    // serves them all. Sign-in/out reloads the page (portal), so the memo can't
    // go stale — and signIn/signOut clear it anyway, belt and braces.
    getUser: function () {
      if (!configured) return Promise.resolve(null);
      if (this._userP) return this._userP;
      var self = this;
      this._userP = client.auth.getUser().then(function (r) { return r.data ? r.data.user : null; });
      this._userP['catch'](function () { self._userP = null; });
      return this._userP;
    },
    signUp: function (email, password, captchaToken) {
      return client.auth.signUp({ email: email, password: password, options: captchaToken ? { captchaToken: captchaToken } : undefined });
    },
    signIn: function (email, password, captchaToken) {
      var self = this;
      return client.auth.signInWithPassword({ email: email, password: password, options: captchaToken ? { captchaToken: captchaToken } : undefined })
        .then(function (r) { self._userP = null; self.cacheBust(); return r; });
    },
    signOut: function () {
      var self = this;
      return client.auth.signOut().then(function (r) { self._userP = null; self.cacheBust(); return r; });
    },
    onAuth: function (cb) { if (configured) client.auth.onAuthStateChange(cb); },
    // Send a password-reset email.
    /* redirectTo MUST NOT carry a #fragment. Supabase returns its tokens as a
       fragment, and when redirectTo already has one it keeps yours and escapes
       the second '#' — the link came back as
         /#brothers-portal%23access_token=...&type=recovery
       which is a SINGLE fragment whose first parameter is named
       "brothers-portal#access_token". supabase-js looks up "access_token",
       finds nothing, and never creates the session — so the brother landed on
       the home page with no reset form, and the login card then told him the
       link had expired. (The server had created the session; only the browser
       couldn't see it.) Observed on a real device 2026-08-07; the anchor was
       cosmetic, the modal opens on its own. */
    resetPassword: function (email, captchaToken) {
      return client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/index.html',
        captchaToken: captchaToken || undefined
      });
    },
    // Set a new password for the signed-in (or recovery-session) user.
    updatePassword: function (pw) { return client.auth.updateUser({ password: pw }); },
    /* Supabase's updateUser({password}) does NOT require the current password — so
       anyone with a borrowed/left-open session could silently change it and lock the
       brother out. Prove the old password first by re-authenticating with it; this
       returns { error } on a wrong password and refreshes the same session on success. */
    verifyPassword: function (email, password, captchaToken) {
      return client.auth.signInWithPassword({ email: email, password: password, options: captchaToken ? { captchaToken: captchaToken } : undefined });
    },
    /* Change the SIGN-IN email. Supabase sends a confirmation link and does not
       switch the address until it's clicked, so an account can't be hijacked by a
       typo. (Separate from `brothers.email`, the contact address on the profile.) */
    updateEmail: function (email) { return client.auth.updateUser({ email: email }); },

    /* ---- two-factor auth (TOTP), opt-in per brother --------------------
       enroll() returns a QR + secret for an authenticator app; challengeVerify()
       confirms a 6-digit code (used to FINISH enrollment AND to satisfy a login).
       mfaAAL(): currentLevel 'aal1' + nextLevel 'aal2' means this session still
       owes a 2FA code (a verified factor exists but hasn't been used yet).
       MFA challenge/verify are NOT the password endpoint, so Turnstile captcha
       does not apply to them. */
    mfaListFactors: function () { return client.auth.mfa.listFactors(); },
    mfaVerifiedTotp: function () {
      return client.auth.mfa.listFactors().then(function (r) {
        var list = (r.data && (r.data.totp || r.data.all)) || [];
        return list.filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; })[0] || null;
      });
    },
    mfaEnroll: function () {
      // Clear any half-finished (unverified) factor first, so re-enrolling after an
      // abandoned attempt doesn't hit "a factor with this friendly name already exists".
      return client.auth.mfa.listFactors().then(function (r) {
        var stale = ((r.data && r.data.all) || []).filter(function (f) { return f.status !== 'verified'; });
        return Promise.all(stale.map(function (f) { return client.auth.mfa.unenroll({ factorId: f.id }); }));
      }).then(function () {
        return client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ZBXi authenticator ' + Date.now() });
      });
    },
    mfaChallengeVerify: function (factorId, code) {
      return client.auth.mfa.challengeAndVerify({ factorId: factorId, code: String(code || '').trim() });
    },
    mfaUnenroll: function (factorId) { return client.auth.mfa.unenroll({ factorId: factorId }); },
    mfaAAL: function () { return client.auth.mfa.getAuthenticatorAssuranceLevel(); },
    // Admin-only: clear a brother's 2FA (if he lost his authenticator) so he can
    // log in with just his password again. Server RPC is is_admin()-gated.
    adminResetMfa: function (targetUserId) { return client.rpc('admin_reset_2fa', { target: targetUserId }); },

    // Disconnect my account from its family-tree row (row becomes claimable again).
    releaseProfile: function () { return this._bust(client.rpc('release_profile')); },

    /* ---- profile photos: PRIVATE bucket, signed on the way out ---------------
       `brother-photos` went private in upgrade16 (it used to be world-readable by
       URL). `brothers.photo_url` now stores a storage PATH, not a URL.

       Rather than teach ~10 render sites to sign, we sign HERE — at the single
       boundary every brother row passes through. Downstream code still just reads
       `b.photo_url` and gets something it can drop straight into an <img>.
       Batch-signed (one request for N paths), same as gallerySignedUrls. */
    _signPhotos: function (rows) {
      if (!configured || !rows) return Promise.resolve(rows);
      var list = Array.isArray(rows) ? rows : [rows];
      // Only sign storage paths. Anything already absolute (http/data/blob) is
      // left alone — e.g. a legacy or externally-hosted image.
      var paths = [];
      list.forEach(function (b) {
        var v = b && b.photo_url;
        if (v && !/^(https?:|data:|blob:)/i.test(v) && paths.indexOf(v) === -1) paths.push(v);
      });
      if (!paths.length) return Promise.resolve(rows);
      return client.storage.from('brother-photos').createSignedUrls(paths, 21600) // 6h
        .then(function (r) {
          var map = {};
          (r.data || []).forEach(function (row, i) { if (row && row.signedUrl) map[paths[i]] = row.signedUrl; });
          list.forEach(function (b) {
            if (!b || !b.photo_url) return;
            // Keep the ORIGINAL path. photo_url is about to become a signed URL that
            // expires; anything saving the row back (the profile editor) must write
            // the path, or the next save would persist a dying URL into the DB.
            if (!/^(https?:|data:|blob:)/i.test(b.photo_url)) b._photo_path = b.photo_url;
            if (map[b.photo_url]) b.photo_url = map[b.photo_url];
            else if (b._photo_path) b.photo_url = null;   // not allowed to see it
          });
          return rows;
        })
        .catch(function () {
          // No permission to sign (e.g. signed-out) -> show no photo rather than a broken one.
          list.forEach(function (b) {
            if (b && b.photo_url && !/^(https?:|data:|blob:)/i.test(b.photo_url)) {
              b._photo_path = b.photo_url;
              b.photo_url = null;
            }
          });
          return rows;
        });
    },

    /* ---- roster cache (sessionStorage, per-tab) ------------------------------
       Every page used to re-download the full roster and re-sign every photo on
       every navigation. The three heavy reads (family_public, roster_detail,
       member_directory) now serve from a per-tab cache and refresh in the
       background (stale-while-revalidate), so the NEXT navigation is fresh.
       - sessionStorage, not localStorage: roster PII dies with the browser tab.
       - 30-min TTL, well inside the 6h life of the signed photo URLs that ride
         along in the rows.
       - Never caches an empty result (signed-out / not-yet-approved viewers get
         [] from the self-gating views — caching that would stick).
       - Busted by every roster write and by sign-in/sign-out, so your own edits
         and account switches are never stale. Another brother's edit can take up
         to 30 min to reach an already-open tab. */
    _CACHE_TTL: 30 * 60 * 1000,
    _cget: function (name) {
      try {
        var raw = sessionStorage.getItem('zbxic_' + name);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        return (obj && obj.exp > Date.now()) ? obj.v : null;
      } catch (e) { return null; }
    },
    // ttl is optional — a caller with a freshness requirement tighter than the
    // roster's 30 min (e.g. the announcement banner) passes its own.
    _cput: function (name, v, ttl) {
      try { sessionStorage.setItem('zbxic_' + name, JSON.stringify({ exp: Date.now() + (ttl || this._CACHE_TTL), v: v })); } catch (e) {}
    },
    cacheBust: function () {
      try {
        for (var i = sessionStorage.length - 1; i >= 0; i--) {
          var k = sessionStorage.key(i);
          if (k && k.indexOf('zbxic_') === 0) sessionStorage.removeItem(k);
        }
      } catch (e) {}
    },
    // Wrap a write so the roster cache clears once it lands.
    _bust: function (p) {
      var self = this;
      return Promise.resolve(p).then(function (r) { self.cacheBust(); return r; });
    },

    /* ---- brothers ---- */
    // PUBLIC: names + lineage only (via the family_public view — no details, and
    // no photo_url column at all, so nothing to sign here).
    listFamilyPublic: function () {
      if (!configured) return Promise.resolve([]);
      // Despite the name, family_public is brothers-only: `anon` has no SELECT grant
      // on the view, so asking while signed out always 401s. That painted two red
      // console errors onto every visitor's homepage — harmless, but it reads as a
      // broken site to anyone who opens devtools. Callers already treat [] as
      // "not allowed" (tree -> placeholder, homepage stats -> "🔒 members"), so just
      // don't make a request we know will be refused. getSession() is local (no
      // network round-trip), unlike getUser().
      var self = this;
      return client.auth.getSession().then(function (r) {
        if (!r.data || !r.data.session) return [];
        var fresh = function () {
          return client.from('family_public').select('*')
            .then(function (x) {
              var rows = x.data || [];
              if (rows.length) self._cput('fam', rows);
              return rows;
            });
        };
        var hit = self._cget('fam');
        if (hit) { fresh()['catch'](function () {}); return hit; }
        return fresh();
      });
    },
    // All verified brothers — read through the roster_detail VIEW, not the raw
    // table. The view self-gates to approved brothers / admin, drops the
    // unsubscribe_token entirely, and only returns a brother's email/phone if HE
    // chose to share them (contact_prefs) — so the raw contact info never reaches
    // another brother's browser. Used to hydrate the roster/tree for signed-in brothers.
    listVerifiedDetail: function () {
      if (!configured) return Promise.resolve([]);
      var self = this;
      var fresh = function () {
        return client.from('roster_detail').select('*').eq('status', 'verified')
          .then(function (r) { return self._signPhotos(r.data || []); })
          .then(function (rows) {
            if (rows.length) self._cput('roster', rows);
            return rows;
          });
      };
      var hit = this._cget('roster');
      if (hit) { fresh()['catch'](function () {}); return Promise.resolve(hit); }
      return fresh();
    },
    // Unregistered (claimable) tree entries, alphabetical — for the claim picker.
    listUnclaimed: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('family_public').select('id, full_name, pledge_class')
        .eq('registered', false).order('full_name')
        .then(function (r) { return r.data || []; });
    },
    // Claim an existing tree row for the signed-in account (goes to pending review).
    claimProfile: function (targetId) {
      return this._bust(client.rpc('claim_profile', { target_id: targetId }));
    },
    // One brother's full detail for the profile card. Read the row from the
    // PII-safe roster_detail view (email/phone gated by his own contact_prefs, no
    // unsubscribe_token) and his positions history from brother_titles (its own
    // approved-brother read policy), then merge to the shape profile-card.js expects.
    brotherDetail: function (id) {
      if (!configured) return Promise.resolve(null);
      var self = this;
      return Promise.all([
        client.from('roster_detail').select('*').eq('id', id).maybeSingle(),
        client.from('brother_titles').select('title,term,scope,sort').eq('brother_id', id).order('sort', { ascending: true }),
        // How many gallery photos he has been tagged in (upgrade60). head:true asks
        // for the count only — no rows cross the wire. A brother with no account has
        // a count too, which is the whole point: he is in the photos regardless.
        client.from('gallery_tags').select('post_id', { count: 'exact', head: true }).eq('brother_id', id)
      ]).then(function (res) {
        var d = res[0].data;
        if (!d) return null;
        d.brother_titles = res[1].data || [];
        d.photo_count = (res[2] && res[2].count) || 0;
        return self._signPhotos(d);
      });
    },
    // Is the currently signed-in user an approved (verified) brother? (cached)
    amApprovedBrother: function () {
      if (!configured) return Promise.resolve(false);
      if (this._approvedCache !== undefined) return Promise.resolve(this._approvedCache);
      var self = this;
      return this.getUser().then(function (u) {
        if (!u) { self._approvedCache = false; return false; }
        // The admin always counts as an approved viewer.
        if (self.adminEmail && (u.email || '').toLowerCase() === self.adminEmail) { self._approvedCache = true; return true; }
        return self.myProfile(u.id).then(function (p) {
          self._approvedCache = !!(p && p.status === 'verified'); return self._approvedCache;
        });
      }).catch(function () { return false; });
    },
    // The signed-in user's own row (may be pending)
    myProfile: function (userId) {
      if (!configured) return Promise.resolve(null);
      var self = this;
      return client.from('brothers').select('*, brother_titles(title,term,scope,sort)').eq('user_id', userId).maybeSingle()
        .then(function (r) { return r.data ? self._signPhotos(r.data) : null; });
    },
    upsertProfile: function (row) {
      return this._bust(client.from('brothers').upsert(row, { onConflict: 'user_id' }).select().maybeSingle());
    },
    // Admin: list by status (alphabetical by name)
    listByStatus: function (status) {
      var self = this;
      return client.from('brothers').select('*').eq('status', status)
        .order('full_name', { ascending: true })
        .then(function (r) {
          if (r.error || !r.data) return r;
          return self._signPhotos(r.data).then(function () { return r; }); // callers read r.data
        });
    },
    listPending: function () { return this.listByStatus('pending'); },
    // Admin-only: signup (login) email for each pending brother, from auth.users.
    // Returns [] for non-admins (the DB function is admin-gated). See upgrade23.sql.
    adminPendingEmails: function () { return client.rpc('admin_pending_emails').then(function (r) { return r; }); },
    setStatus: function (id, status) {
      return this._bust(client.from('brothers').update({ status: status }).eq('id', id));
    },
    /* ---- pledge classes (admin console) --------------------------------------
       `pledge_class` is one free-text field on the brother's row, and the roster,
       family-tree card and class pages all read it — so writing it here fixes the
       brother everywhere at once. No table to keep in sync.
       Both writes are gated server-side by the brothers_admin_update RLS policy
       (is_admin(), upgrade14.sql); a non-admin caller updates 0 rows. */
    setPledgeClass: function (id, cls) {
      return this._bust(client.from('brothers').update({ pledge_class: cls }).eq('id', id));
    },
    // Bulk merge/rename: move EVERY brother in `oldCls` to `newCls` in one call.
    // The admin's "— blank —" bucket groups NULL and '' together, but SQL `= ''`
    // never matches NULL — so merging it used to silently leave the NULL rows behind
    // while the confirm promised "all N". Match both for that bucket.
    renamePledgeClass: function (oldCls, newCls) {
      var q = client.from('brothers').update({ pledge_class: newCls });
      return this._bust(oldCls === '' || oldCls == null
        ? q.or('pledge_class.is.null,pledge_class.eq.')
        : q.eq('pledge_class', oldCls));
    },
    updateBrother: function (id, fields) {
      return this._bust(client.from('brothers').update(fields).eq('id', id));
    },
    // Admin: the same fields on many brothers in one request (CSV import). RLS
    // brothers_admin_update still gates it server-side. Caller chunks the ids —
    // they ride in the query string, and a few hundred uuids overflows it.
    // NOT upsertProfile: that keys on user_id, which is null on roster rows, so it
    // would INSERT duplicates rather than update.
    updateBrothersIn: function (ids, fields) {
      return this._bust(client.from('brothers').update(fields).in('id', ids));
    },
    deleteBrother: function (id) {
      return this._bust(client.from('brothers').delete().eq('id', id));
    },
    // Admin: add roster rows directly (single object or array). Unclaimed
    // (user_id null) + verified so they appear in the tree immediately.
    addBrothers: function (rows) {
      return this._bust(client.from('brothers').insert(rows).select());
    },

    /* ---- member directory (author chips; approved brothers only) ---- */
    memberDirectory: function () {
      if (!configured) return Promise.resolve({});
      if (this._dirCache) return Promise.resolve(this._dirCache);
      var self = this;
      var fresh = function () {
        return client.from('member_directory').select('*').then(function (r) {
          return self._signPhotos(r.data || []);   // author chips show avatars
        }).then(function (rows) {
          var map = {};
          (rows || []).forEach(function (m) { map[m.user_id] = m; });
          if ((rows || []).length) self._cput('dir', map);
          self._dirCache = map;
          return map;
        });
      };
      var hit = this._cget('dir');
      if (hit) { this._dirCache = hit; fresh()['catch'](function () {}); return Promise.resolve(hit); }
      return fresh();
    },

    /* ---- gallery (members only; RLS-gated) ---- */
    galleryList: function () {
      return client.from('gallery_posts').select('*').order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },
    galleryLikesAll: function () {
      return client.from('gallery_likes').select('post_id, user_id')
        .then(function (r) { return r.data || []; });
    },
    // THROWS on failure, deliberately. supabase-js v2 does NOT reject on a query
    // error — it resolves with {data: null, error}. The old `return r.data || []`
    // therefore turned an expired token, a 500 or a dropped connection into an
    // empty array, and the viewer stated "No comments yet" as fact on a photo that
    // had comments. A caller cannot tell silence from failure unless this throws.
    galleryComments: function (postId) {
      return client.from('gallery_comments').select('*').eq('post_id', postId)
        .order('created_at').then(function (r) {
          if (r.error) throw r.error;
          return r.data || [];
        });
    },
    // userId/imagePath are kept for the callers' sake but IGNORED — the edge fn
    // derives the key from the verified caller uid (upload) and from the row (delete).
    // Declares the blob's exact byte length up front: the edge fn refuses anything
    // over the cap and signs the URL against that length and content type, so the
    // PUT that follows can only be this image. Send back exactly the type the fn
    // signed, or R2 rejects the signature.
    galleryUpload: function (userId, blob, ext) {
      return this._gallery({ op: 'sign-upload', ext: ext || 'jpg', size: blob.size })
        .then(function (r) {
          if (r.status === 409) throw new Error('This page is out of date — refresh and try again.');
          // The server cap applies to the DOWNSCALED image, which lands ~400KB, so
          // this should be unreachable from the site — don't quote 5MB at someone
          // whose picker just told them 25MB.
          if (r.status === 413) throw new Error('That image could not be processed. Try a different photo.');
          if (!r.ok) throw new Error('upload not allowed');
          return r.json();
        })
        .then(function (j) {
          return fetch(j.url, { method: 'PUT', headers: { 'Content-Type': j.type || 'image/jpeg' }, body: blob })
            .then(function (pr) { if (!pr.ok) throw new Error('upload failed'); return j.key; });
        });
    },
    gallerySignedUrls: function (paths) {
      if (!paths.length) return Promise.resolve({});
      return this._gallery({ op: 'sign-view', paths: paths })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) { return (j && j.urls) || {}; })
        .catch(function () { return {}; });   // signed-out / error -> {} (posts show the placeholder)
    },
    galleryCreate: function (row) { return client.from('gallery_posts').insert(row).select().single(); },
    // Edit your own post (or anyone's, with gallery.moderate). Only these three
    // fields are sent, and only these three are UPDATE-grantable to `authenticated`
    // — upgrade41 revoked the rest and upgrade60 added taken_year, so a wider patch
    // is refused by Postgres itself rather than by this line.
    galleryUpdate: function (id, caption, albumId, takenYear) {
      return client.from('gallery_posts')
        .update({ caption: caption || null, album_id: albumId || null, taken_year: takenYear || null })
        .eq('id', id).select().single();
    },

    /* ---- who is in a photo (upgrade60) ----
       Tags point at brothers.id — the ROSTER — not at an account, because most of
       the men in the old photos never signed up. One flat read for the whole table:
       it is small, the gallery already holds every post in memory, and a per-post
       query would be one round trip per photo opened. */
    galleryTags: function () {
      return client.from('gallery_tags').select('post_id, brother_id, tagged_by')
        .then(function (r) { return r.data || []; });
    },
    // One brother's photo count on its own. brotherDetail() already returns this for
    // a brother WITH an account, but the profile card never calls it for a brother
    // WITHOUT one — and he is exactly who "he's in 6 photos" is worth knowing about,
    // because it is the reason to go and invite him.
    galleryTagCount: function (brotherId) {
      return client.from('gallery_tags').select('post_id', { count: 'exact', head: true })
        .eq('brother_id', brotherId)
        .then(function (r) { return (r && r.count) || 0; });
    },
    galleryTagAdd: function (postId, brotherId, userId) {
      return client.from('gallery_tags')
        .insert({ post_id: postId, brother_id: brotherId, tagged_by: userId })
        .select().single();
    },
    // .select() is not decoration. An RLS `using` refusal deletes zero rows and
    // returns 204 — indistinguishable from success — so without the returned rows
    // "remove tag" would silently do nothing for anyone not allowed to. The caller
    // treats an empty array as a refusal and says so.
    galleryTagRemove: function (postId, brotherId) {
      return client.from('gallery_tags').delete()
        .eq('post_id', postId).eq('brother_id', brotherId).select();
    },
    galleryDeletePost: function (id, imagePath) {
      return this._gallery({ op: 'delete-post', id: id });   // fn deletes the row (RLS) + the R2 object
    },
    // Albums: a small admin-managed list photos are filed under. RLS: brothers read,
    // only the admin writes (upgrade30.sql).
    galleryAlbums: function () {
      return client.from('gallery_albums').select('*').order('sort')
        .then(function (r) { return r.data || []; });
    },
    albumCreate: function (name) { return client.from('gallery_albums').insert({ name: name }).select().single(); },
    albumRename: function (id, name) { return client.from('gallery_albums').update({ name: name }).eq('id', id); },
    albumDelete: function (id) { return client.from('gallery_albums').delete().eq('id', id); },
    // Total R2 usage {objects, bytes} for the admin storage meter (edge fn admin-gated).
    galleryUsage: function () {
      return this._gallery({ op: 'usage' })
        .then(function (r) { return r.ok ? r.json() : null; })
        ['catch'](function () { return null; });
    },
    likePost: function (postId, userId) {
      return client.from('gallery_likes').insert({ post_id: postId, user_id: userId });
    },
    unlikePost: function (postId, userId) {
      return client.from('gallery_likes').delete().eq('post_id', postId).eq('user_id', userId);
    },
    // .select() on both: an insert/delete that RLS refuses is NOT an error — it
    // touches zero rows and resolves 200. Asking for the rows back is the only way
    // the caller can tell "saved" from "silently declined", which is what let a
    // refused comment disappear with the brother's text.
    addComment: function (postId, userId, body) {
      return client.from('gallery_comments')
        .insert({ post_id: postId, author_user: userId, body: body }).select();
    },
    deleteComment: function (id) {
      return client.from('gallery_comments').delete().eq('id', id).select();
    },

    /* ---- discussion board (members only; RLS-gated) ---- */
    threadsList: function () {
      return client.from('forum_threads').select('*').order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },
    // Per-thread reply meta: {count, lastAt} in one query.
    replyMeta: function () {
      return client.from('forum_replies').select('thread_id, created_at').then(function (r) {
        var map = {};
        (r.data || []).forEach(function (x) {
          var m = map[x.thread_id] = map[x.thread_id] || { count: 0, lastAt: null };
          m.count++;
          if (!m.lastAt || x.created_at > m.lastAt) m.lastAt = x.created_at;
        });
        return map;
      });
    },
    // Reactions on replies (👍 ❤️ 😂)
    reactionsFor: function (replyIds) {
      if (!replyIds.length) return Promise.resolve([]);
      return client.from('reply_reactions').select('reply_id, user_id, kind').in('reply_id', replyIds)
        .then(function (r) { return r.data || []; });
    },
    react: function (replyId, userId, kind) {
      return client.from('reply_reactions').insert({ reply_id: replyId, user_id: userId, kind: kind });
    },
    unreact: function (replyId, userId, kind) {
      return client.from('reply_reactions').delete()
        .eq('reply_id', replyId).eq('user_id', userId).eq('kind', kind);
    },
    threadReplies: function (threadId) {
      return client.from('forum_replies').select('*').eq('thread_id', threadId)
        .order('created_at').then(function (r) { return r.data || []; });
    },
    threadCreate: function (row) { return client.from('forum_threads').insert(row).select().single(); },
    // upgrade49 grants authenticated UPDATE on title + body only, so `row` must
    // carry nothing else — anything more is refused 42501 by column privilege,
    // before RLS is even consulted.
    // .select() is load-bearing: an update RLS refuses is NOT an error, it just
    // matches zero rows and returns 200. Asking for the rows back is what lets the
    // caller tell "saved" from "silently declined".
    threadUpdate: function (id, row) {
      return client.from('forum_threads').update(row).eq('id', id).select();
    },
    threadDelete: function (id) { return client.from('forum_threads').delete().eq('id', id); },
    replyCreate: function (row) { return client.from('forum_replies').insert(row); },
    replyDelete: function (id) { return client.from('forum_replies').delete().eq('id', id); },

    /* ---- shared: canvas-downscale an image file to a small JPEG ---- */
    downscale: function (file, maxPx) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth, h = img.naturalHeight;
          if (Math.max(w, h) > maxPx) {
            var k = maxPx / Math.max(w, h);
            w = Math.round(w * k); h = Math.round(h * k);
          }
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not process image')); }, 'image/jpeg', 0.86);
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Not a readable image')); };
        img.src = url;
      });
    },

    /* ---- event RSVPs (members only; RLS-gated) ---- */
    rsvpList: function () {
      return client.from('event_rsvps').select('event_id, user_id, guests, note')
        .then(function (r) { return r.data || []; });
    },
    rsvp: function (eventId, userId) {
      return client.from('event_rsvps').insert({ event_id: eventId, user_id: userId });
    },
    unrsvp: function (eventId, userId) {
      return client.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', userId);
    },
    // How many you're bringing, and one line for the door (upgrade61). Only these two
    // columns are UPDATE-grantable to `authenticated` — event_id and user_id were
    // revoked, so an RSVP cannot be re-pointed at another event or another brother
    // even by a hand-written request. .select() so a refusal is visible rather than
    // a silent 204.
    rsvpUpdate: function (eventId, userId, guests, note) {
      return client.from('event_rsvps')
        .update({ guests: guests, note: note || null })
        .eq('event_id', eventId).eq('user_id', userId).select();
    },

    /* ---- site settings (announcement banner) ----
       getSetting('announcement') runs from notify.js on EVERY page load for every
       visitor — the most-fired query on the site — to paint a banner that changes
       maybe monthly. Cache it per tab so navigation costs no round-trip. Short TTL
       (not the roster's 30 min) because it's cheap to refetch and the admin expects
       a new banner to show up promptly; setSetting busts it so his own edit is
       instant. null is cached too — "no announcement" is the common answer and
       re-asking every page view is exactly the waste being removed. */
    _SETTING_TTL: 5 * 60 * 1000,
    getSetting: function (key) {
      if (!configured) return Promise.resolve(null);
      var self = this, ck = 'set_' + key;
      var hit = this._cget(ck);
      if (hit !== null && hit !== undefined) return Promise.resolve(hit.v);
      return client.from('site_settings').select('value').eq('key', key).maybeSingle()
        .then(function (r) {
          var v = r.data ? r.data.value : null;
          self._cput(ck, { v: v }, self._SETTING_TTL);   // wrapped so a null value still caches
          return v;
        });
    },
    setSetting: function (key, value) {
      return this._bust(client.from('site_settings').upsert({ key: key, value: value, updated_at: new Date().toISOString() }));
    },

    /* ---- The alumni fund (donations; see upgrade52.sql) --------------------
       Deliberately NOT a site_settings key: that table is world-readable, and
       the Venmo handle belongs only to brothers who are signed in.

       Read: approved brothers. Write: THE ADMIN ONLY — not the alumni president,
       even though it is his account. This field decides where the chapter's money
       lands, so it is the one power on this site not extended to the seat-holder;
       a redirected payment is not undoable the way a bad board record is. */
    donationsGet: function () {
      if (!configured) return Promise.resolve(null);
      return client.from('donations').select('*').eq('id', 1).maybeSingle()
        .then(function (r) {
          // A signed-out or unapproved caller gets no row rather than an error —
          // callers treat null as "show the members-only lock".
          if (r.error) throw r.error;
          return r.data || null;
        });
    },
    donationsSet: function (row) {
      row.updated_at = new Date().toISOString();
      return client.from('donations').update(row).eq('id', 1).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) {
            throw new Error('The fund details were not saved — only the admin may change where money goes.');
          }
          return r.data[0];
        });
    },

    /* ---- Digest notes: "what's new on the site" ---------------------------
       Added as things ship; the next REAL digest sweeps up everything unsent and
       stamps it. `sent_at` is written by the digest function, never from here. */
    digestNotesList: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('digest_notes').select('*').order('created_at', { ascending: false })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    digestNoteAdd: function (row) {
      return client.from('digest_notes').insert(row).select()
        .then(function (r) {
          if (r.error) throw r.error;
          var made = (r.data || [])[0];
          if (!made) throw new Error('The note was not added — you may not have permission.');
          return made;
        });
    },
    // Approve a draft, or rewrite its wording first. The agent's phrasing is a
    // proposal — this is how it gets corrected before 113 brothers read it.
    digestNoteUpdate: function (id, row) {
      return client.from('digest_notes').update(row).eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('That note was not saved — you may not have permission.');
          return r.data[0];
        });
    },
    digestNoteDelete: function (id) {
      return client.from('digest_notes').delete().eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('The note was not deleted — you may not have permission.');
          return true;
        });
    },

    /* ---- polls (any approved brother authors his own; members vote) ---- */
    pollsList: function () {
      return client.from('polls').select('*').order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },
    pollVotesAll: function () {
      return client.from('poll_votes').select('poll_id, user_id, choice')
        .then(function (r) { return r.data || []; });
    },
    pollVote: function (pollId, userId, choice) {
      return client.from('poll_votes').upsert({ poll_id: pollId, user_id: userId, choice: choice });
    },
    pollCreate: function (row) { return client.from('polls').insert(row); },
    // RLS (upgrade38) decides who may change what: the author, the admin, or a
    // seat holding polls.moderate. This helper carries no permission logic.
    pollUpdate: function (id, patch) { return client.from('polls').update(patch).eq('id', id); },
    pollDelete: function (id) { return client.from('polls').delete().eq('id', id); },

    /* ---- suggestion dropbox ---- */
    suggestionsMine: function () {
      return client.from('suggestions').select('*').order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },
    suggestionCreate: function (userId, body) {
      return client.from('suggestions').insert({ author_user: userId, body: body });
    },
    suggestionUpdate: function (id, fields) {
      return client.from('suggestions').update(fields).eq('id', id);
    },
    suggestionDelete: function (id) { return client.from('suggestions').delete().eq('id', id); },

    /* ---- committees (RLS: members see their own; admin sees all) ---- */
    committeesList: function () {
      return client.from('committees').select('*').order('name')
        .then(function (r) { return r.data || []; });
    },
    committeeMembers: function (cid) {
      return client.from('committee_members').select('user_id').eq('committee_id', cid)
        .then(function (r) { return (r.data || []).map(function (x) { return x.user_id; }); });
    },
    committeeCreate: function (name) { return client.from('committees').insert({ name: name }).select().single(); },
    // .select() is not decoration: without it PostgREST answers 204 whether the row was
    // updated or the row rules refused, so a refusal is indistinguishable from success.
    // This verb had no caller until the Rename button existed; now that it does, an
    // empty result is treated as the failure it is.
    committeeRename: function (id, name) {
      return client.from('committees').update({ name: name }).eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.length) throw new Error('That committee could not be renamed.');
          return r.data[0];
        });
    },
    committeeDelete: function (id) { return client.from('committees').delete().eq('id', id); },
    committeeAdd: function (cid, userId) {
      return client.from('committee_members').upsert({ committee_id: cid, user_id: userId });
    },
    committeeRemove: function (cid, userId) {
      return client.from('committee_members').delete().eq('committee_id', cid).eq('user_id', userId);
    },

    /* ---- events ---- */
    eventsList: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('events').select('*').order('starts_at')
        .then(function (r) { return r.data || []; });
    },
    eventCreate: function (row) { return client.from('events').insert(row); },
    eventUpdate: function (id, row) { return client.from('events').update(row).eq('id', id); },
    eventDelete: function (id) { return client.from('events').delete().eq('id', id); },

    /* ---- awards (Greek Excellence showcase; public read, admin write) ---- */
    awardsList: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('awards').select('*').order('year_label', { ascending: false }).order('sort')
        .then(function (r) { return r.data || []; });
    },
    awardCreate: function (row) { return client.from('awards').insert(row); },
    awardUpdate: function (id, row) { return client.from('awards').update(row).eq('id', id); },
    awardDelete: function (id) { return client.from('awards').delete().eq('id', id); },

    /* ---- networking: intro request (SECURITY DEFINER RPC; upgrade9 + upgrade39) ----
       `note` is optional; the function trims and caps it at 200 chars itself. */
    connectRequest: function (targetUserId, note) {
      return client.rpc('connect_request', { target: targetUserId, note: note || null })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    // Notifies up to 5 alumni who flagged "open to mentoring" in that field.
    mentorRequest: function (field, note) {
      return client.rpc('mentor_request', { field: field, note: note || null })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },

    /* ---- Chapter-title requests -------------------------------------------
       A brother can only ASK. RLS lets him insert/read his own row and nothing
       else — he has no UPDATE policy, so he cannot flip his own request to
       'approved', and the tg_guard_status trigger still stops him writing
       `role` on his brothers row. Only the admin's approval grants a title. */
    titleRequestCreate: function (userId, brotherId, title, term, note) {
      return client.from('title_requests').insert({
        user_id: userId, brother_id: brotherId || null,
        title: title, term: term, note: note || null
      });
    },
    titleRequestMine: function (userId) {
      return client.from('title_requests').select('*')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
        .then(function (r) { if (r.error) throw r.error; return (r.data || [])[0] || null; });
    },
    // admin only (RLS enforces it)
    titleRequestsList: function () {
      return client.from('title_requests').select('*')
        .order('status', { ascending: true }).order('created_at', { ascending: false })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    titleRequestDecide: function (id, status) {
      return client.from('title_requests')
        .update({ status: status, decided_at: new Date().toISOString() })
        .eq('id', id);
    },

    /* ---- Positions history (brother_titles; see upgrade19.sql) --------------
       The FULL list of titles a brother has held. brothers.role stays the
       headline (E-Board). Admin writes; approved brothers read (RLS). */
    // Positions recorded against no board. Title-request approval mints these (it has
    // no board to attach to), and eboardSeats() filters them out — so they show on a
    // brother's profile card but on no board, invisible to the Executive Boards page
    // forever. The E-Board tab surfaces the count so they can be reconciled rather
    // than silently accumulating.
    orphanTitles: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('brother_titles').select('id,brother_id,title,term,scope')
        .is('board_id', null)
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    brotherTitlesList: function (broId) {
      return client.from('brother_titles').select('*').eq('brother_id', broId)
        .order('sort', { ascending: true })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    brotherTitleAdd: function (row) {
      return client.from('brother_titles').insert(row).select()
        .then(function (r) { if (r.error) throw r.error; return (r.data || [])[0] || null; });
    },
    brotherTitleDelete: function (id) {
      return client.from('brother_titles').delete().eq('id', id);
    },

    /* ---- Executive boards (eboards; see upgrade50.sql) ----------------------
       A board is a TERM. Its seats are the brother_titles rows above carrying
       that board's id — the same rows the profile card renders as a brother's
       positions history, so a term fixed in one place is fixed in both.

       Read: any approved brother. Write: the admin, or an officer holding
       `eboard.manage`. RLS is the enforcement; the page only decides what
       buttons to draw.

       EVERY WRITE ENDS IN .select(). supabase-js v2 RESOLVES on a refusal
       rather than rejecting, so a policy that turns a write away comes back as
       {data: [], error: null} — indistinguishable from success unless you ask
       for the rows back and find none. Callers throw on an empty return. */
    eboardsList: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('eboards').select('*').order('rank', { ascending: false })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    // Every seat on every board in one request — the page holds few enough
    // boards that per-board fetching would only add round-trips.
    eboardSeats: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('brother_titles').select('*').not('board_id', 'is', null)
        .order('sort', { ascending: true })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    eboardCreate: function (row) {
      return client.from('eboards').insert(row).select()
        .then(function (r) {
          if (r.error) throw r.error;
          var made = (r.data || [])[0];
          if (!made) throw new Error('The board was not created — you may not have permission.');
          return made;
        });
    },
    eboardUpdate: function (id, row) {
      return client.from('eboards').update(row).eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('The board was not saved — you may not have permission.');
          return r.data[0];
        });
    },
    eboardDelete: function (id) {
      return client.from('eboards').delete().eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('The board was not deleted — you may not have permission.');
          return true;
        });
    },
    /* Re-parent a seat. This is what "absorb another board" is made of: move
       every seat across, then delete the emptied board. The seat row itself —
       who held which office, in which term — is never touched. */
    eboardSeatMove: function (id, boardId) {
      return client.from('brother_titles').update({ board_id: boardId }).eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('That seat was not moved — you may not have permission.');
          return r.data[0];
        });
    },
    eboardSeatUpdate: function (id, row) {
      return client.from('brother_titles').update(row).eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('That seat was not saved — you may not have permission.');
          return r.data[0];
        });
    },
    eboardSeatRemove: function (id) {
      return client.from('brother_titles').delete().eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data || []).length) throw new Error('That seat was not removed — you may not have permission.');
          return true;
        });
    },

    /* ---- Officer permissions (Officer Console; see upgrade17.sql) ----------
       officer_grants is the Admin-controlled toggle matrix. Everyone signed in
       may READ it; only the admin may WRITE it (RLS). The real enforcement is
       server-side: officer_can() is added to the safe-table policies, so these
       client helpers only decide what UI to show. */
    officerGrantsList: function () {
      return client.from('officer_grants').select('*')
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    // Admin upsert of one toggle. RLS rejects this for anyone but the admin.
    officerGrantSet: function (seat, permission, enabled) {
      return client.auth.getUser().then(function (r) {
        var uid = r.data && r.data.user && r.data.user.id;
        return client.from('officer_grants').upsert(
          { seat: seat, permission: permission, enabled: enabled,
            updated_at: new Date().toISOString(), updated_by: uid },
          { onConflict: 'seat,permission' });
      });
    },
    /* ---- Every section under the Brothers / Brothers Only menus -----------------
       Defined once, as data, and rendered by BOTH consoles — the same reason
       OPEN_TO lives here. The point is coverage you can check at a glance: if a
       section exists on the site it appears in this list, and the list says where
       it is managed. `tab` = the console tab that owns it; `page` = the editor
       lives on the page itself (the Executive Boards pattern), which is a
       deliberate choice, not a gap — a second editor in the console would be two
       screens writing the same rows. */
    SECTIONS: [
      { name: 'Active Brothers',   href: 'active.html',    tab: 'approved',   note: 'Roster of brothers still at Geneseo. Managed through the brother records.' },
      { name: 'Alumni Brothers',   href: 'alumni.html',    tab: 'approved',   note: 'Same records — a brother chooses his side on his own profile.' },
      { name: 'Executive Boards',  href: 'eboards.html',   tab: 'eboard',     note: 'Today\'s seats are set in the console; past boards are edited on the page.' },
      { name: 'Alumni Fund',       href: 'donations.html', tab: 'fund',       note: 'The Venmo handle and whether the page is visible at all.' },
      { name: 'Gallery',           href: 'gallery.html',   tab: 'gallery',    note: 'Sections and storage here; photos and comments are moderated on the page.' },
      { name: 'Board',             href: 'board.html',     tab: 'committees', note: 'Committees and private spaces here; threads are moderated on the page.' },
      { name: 'Mentoring',         href: 'mentoring.html', tab: 'mentoring',  note: 'Who is on the Mentors and Mentees lists.' },
      { name: 'Worldwide Map',     href: 'map.html',       tab: null,         note: 'Draws itself from the city on each brother\'s profile — nothing to manage.' },
      { name: 'Family Tree',       href: 'family-tree.html', tab: 'tree',     note: 'Bigs and littles. Fixing a big here redraws the tree.' },
      { name: 'Events',            href: 'events.html',    tab: 'events',     note: 'The calendar, RSVPs and the announcement banner.' }
    ],
    // Which roster row is the webmaster's (upgrade54). family_public carries no email,
    // so the console cannot work this out locally. Cached: it never changes in a session.
    // UI only — the real refusal is in officer_update_brother and the bt_officer_* policies.
    adminBrotherId: function () {
      var self = this;
      if (!self._adminBidP) {
        self._adminBidP = client.rpc('admin_brother_id')
          .then(function (r) { if (r.error) throw r.error; return r.data || null; })
          .catch(function () { return null; });
      }
      return self._adminBidP;
    },
    // Set which Mentoring lists a brother appears on (upgrade56). ONE verb for both
    // consoles: the function itself accepts `is_admin() OR officer_can('members.edit')`,
    // so the admin does not need a separate path and both get the same validation.
    // Returns the stored array, sorted and de-duplicated by the server.
    officerSetOpenTo: function (id, arr) {
      return client.rpc('officer_set_open_to', { p_id: id, p_open_to: arr || [] })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    // The caller's seat, derived server-side from his own pinned role/scope.
    myOfficerSeat: function () {
      return client.rpc('my_officer_seat')
        .then(function (r) { if (r.error) throw r.error; return r.data || null; });
    },
    // Cached local check (seat + grants loaded once) for UI gating only.
    officerCan: function (perm) {
      var self = this;
      if (!self._officerP) {
        self._officerP = Promise.all([self.myOfficerSeat(), self.officerGrantsList()])
          .then(function (res) { return { seat: res[0], grants: res[1] || [] }; })
          .catch(function () { return { seat: null, grants: [] }; });
      }
      return self._officerP.then(function (st) {
        if (!st.seat) return false;
        return st.grants.some(function (g) {
          return g.seat === st.seat && g.permission === perm && g.enabled;
        });
      });
    },

    /* ---- the signup queue, for whoever may clear it (upgrade44) --------------
       Both go through SECURITY DEFINER functions rather than the brothers table:
       an officer cannot READ a pending brother (brothers_brother_read was dropped
       in upgrade26) and cannot WRITE his status (tg_guard_status pins it, without
       an error). The functions re-check is_admin() OR officer_can('members.approve')
       server-side, so these are UI convenience, not the gate. */
    pendingQueue: function () {
      return client.rpc('pending_queue')
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    // decision: 'verified' | 'rejected'. RAISES server-side if the caller may not
    // decide, or if the brother is no longer waiting — so a failure is visible
    // rather than a button that quietly does nothing.
    decidePending: function (id, decision) {
      return client.rpc('decide_pending_brother', { p_id: id, p_decision: decision })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },

    /* ---- correcting a decision, and the roster (upgrade46) -------------------
       Same shape and the same reasoning as the two above: narrow SECURITY
       DEFINER verbs, never a widened policy on `brothers`. */
    // What the Undo button lists. d_locked = carries a chapter title, so Undo is
    // not offered on it (the server refuses too — this only avoids the dead press).
    myRecentDecisions: function () {
      return client.rpc('my_recent_decisions')
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },
    // Reverses a decision back to 'pending'. RAISES unless the caller made that
    // decision himself — decided_by is stamped by a trigger and cannot be spoofed.
    undoMyDecision: function (id) {
      return client.rpc('undo_my_decision', { p_id: id })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    // Roster facts only. There is deliberately no parameter for role, status,
    // user_id or roster_name, so no argument can reach them.
    // _bust because this writes the roster: the family tree and the Records list
    // both serve from the 30-min sessionStorage cache, and without this an
    // officer's own correction would keep reading back the old name.
    officerUpdateBrother: function (id, f) {
      return this._bust(client.rpc('officer_update_brother', {
        p_id: id,
        p_full_name: f.full_name,
        p_pledge_class: f.pledge_class || null,
        p_grad_year: f.grad_year == null || f.grad_year === '' ? null : parseInt(f.grad_year, 10),
        p_big_id: f.big_id || null
      })).then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    // Officers read invites through a function, NOT the table. invitesList()
    // above is select('*'), and the table carries `token` -- a credential that
    // mints an already-confirmed account for that email (zbxi-claim.ts). RLS is
    // row-level and cannot hide a column, so the officer path has to be a verb
    // that never selects it. The admin keeps the table read (invites_admin_all).
    // Shaped to match invitesList() so the Invite tab renders either the same.
    officerInvitesList: function () {
      return client.rpc('officer_invites_list').then(function (r) {
        if (r.error) throw r.error;
        return (r.data || []).map(function (x) {
          return { email: x.i_email, sent_at: x.i_sent_at, accepted_at: x.i_accepted,
                   error: x.i_error, created_at: x.i_created };
        });
      });
    },
    // The serious half of the audit log (deletions, approvals, permission and
    // title changes). Everyday activity is filtered out server-side.
    activityFeed: function () {
      return client.rpc('activity_feed')
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },

    /* ---- email: digest + invites (Edge Functions; see supabase/functions/) ---- */
    _fn: function (slug) { return (window.ZBXI_CONFIG.SUPABASE_URL) + '/functions/v1/' + slug; },
    _token: function () {
      return client.auth.getSession().then(function (r) {
        return (r.data && r.data.session && r.data.session.access_token) || null;
      });
    },
    // Gallery/board photos live in Cloudflare R2. The zbxi-gallery edge fn checks the
    // caller's permission IN THE DB, then mints a short-lived presigned URL. Returns
    // the raw fetch Response; callers decide how to read it.
    _gallery: function (body) {
      var Z = this;
      return Z._token().then(function (t) {
        return fetch(Z._fn('zbxi-gallery'), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      });
    },
    // Renders the digest without sending it (admin only).
    digestPreview: function () {
      var Z = this;
      return Z._token().then(function (t) {
        return fetch(Z._fn('zbxi-digest') + '?dry=1', { headers: { Authorization: 'Bearer ' + t } });
      }).then(function (r) { return r.text(); });
    },
    // test=true -> sends only to the admin's own inbox.
    digestSend: function (test) {
      var Z = this;
      return Z._token().then(function (t) {
        return fetch(Z._fn('zbxi-digest') + (test ? '?test=1' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
      }).then(function (r) { return r.json(); });
    },
    inviteBrothers: function (emails, brotherId) {
      var Z = this;
      return Z._token().then(function (t) {
        return fetch(Z._fn('zbxi-invite'), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: emails, brother_id: brotherId || null })
        });
      }).then(function (r) { return r.json(); });
    },
    // Token-gated lookup used by the invite link: does this invited email
    // already have an account? Decides Log in vs Create account.
    inviteStatus: function (token) {
      return client.rpc('invite_status', { t: token })
        .then(function (r) { return (r.error || !r.data) ? null : r.data; })
        .catch(function () { return null; });
    },
    // An invited brother sets his password via his invite token. Creates his
    // account ALREADY CONFIRMED (no confirmation email ever sent) — see
    // supabase/functions/zbxi-claim.ts. Resolves { status, body }.
    claimInvite: function (token, password) {
      var Z = this;
      return fetch(Z._fn('zbxi-claim'), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (window.ZBXI_CONFIG.SUPABASE_ANON_KEY || ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, password: password })
      }).then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: {} }; });
      });
    },
    invitesList: function () {
      return client.from('invites').select('*').order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },
    // Console email composer (admin / granted officers) -> zbxi-email fn.
    // Returns the raw fetch Response: ?dry=1 reads text, everything else json.
    sendEmail: function (payload, qs) {
      var Z = this;
      return Z._token().then(function (t) {
        return fetch(Z._fn('zbxi-email') + (qs || ''), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      });
    },
    // One-time "you're approved" welcome email (admin console, right after an
    // approve). Fire-and-forget at the call site — an email hiccup must never
    // block the approval itself.
    notifyApproved: function (brotherId) {
      var Z = this;
      return Z._token().then(function (t) {
        return fetch(Z._fn('zbxi-approved'), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: JSON.stringify({ brother_id: brotherId })
        });
      }).then(function (r) { return r.json(); });
    },
    setEmailOptOut: function (userId, optOut) {
      return client.from('brothers').update({ email_opt_out: optOut }).eq('user_id', userId);
    },

    /* ---- notifications ----
       Every one of these is scoped server-side to `recipient = auth.uid()` by
       the notif_own_* policies; none of them takes a user id to filter on. */
    notifList: function () {
      return client.from('notifications').select('*')
        .order('created_at', { ascending: false }).limit(30)
        .then(function (r) { return r.data || []; });
    },
    // The full history page. The weekly prune drops anything past 90 days, so
    // 200 is far more than a real feed holds — one round-trip, no pagination.
    notifListAll: function () {
      return client.from('notifications').select('*')
        .order('created_at', { ascending: false }).limit(200)
        .then(function (r) { return r.data || []; });
    },
    notifMarkRead: function (id) {
      return client.from('notifications').update({ read: true }).eq('id', id);
    },
    notifMarkAllRead: function () {
      return client.from('notifications').update({ read: true }).eq('read', false);
    },
    notifDelete: function (id) { return client.from('notifications').delete().eq('id', id); },
    // RLS already confines this to the caller's own rows, but an unfiltered
    // DELETE is one loosened policy away from wiping the table. Name the
    // recipient so the filter never depends on the policy alone.
    notifClearAll: function (uid) {
      return client.from('notifications').delete().eq('recipient', uid);
    },

    /* ---- leadership stats (admin only) ---- */
    adminStats: function () {
      return client.rpc('admin_stats').then(function (r) { return r.data || null; });
    },
    activityList: function (limit) {
      return client.from('activity_log').select('*')
        .order('created_at', { ascending: false }).limit(limit || 50)
        .then(function (r) { return r.data || []; });
    },

    /* ---- storage: profile photos ---- */
    /* Returns the storage PATH (not a URL) — the bucket is private since
       upgrade16, so a public URL would 404. `_signPhotos` turns this back into a
       viewable signed URL whenever the row is read. */
    uploadPhoto: function (userId, file) {
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      var path = userId + '/' + Date.now() + '.' + ext;
      return client.storage.from('brother-photos').upload(path, file, { upsert: true })
        .then(function (r) {
          if (r.error) throw r.error;
          return path;
        });
    }
  };

  window.ZBXI = Z;
})();
