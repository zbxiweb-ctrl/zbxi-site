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
    getUser: function () {
      if (!configured) return Promise.resolve(null);
      return client.auth.getUser().then(function (r) { return r.data ? r.data.user : null; });
    },
    signUp: function (email, password) {
      return client.auth.signUp({ email: email, password: password });
    },
    signIn: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function () { return client.auth.signOut(); },
    onAuth: function (cb) { if (configured) client.auth.onAuthStateChange(cb); },
    // Send a password-reset email (link returns to the portal).
    resetPassword: function (email) {
      return client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/index.html#brothers-portal'
      });
    },
    // Set a new password for the signed-in (or recovery-session) user.
    updatePassword: function (pw) { return client.auth.updateUser({ password: pw }); },
    /* Supabase's updateUser({password}) does NOT require the current password — so
       anyone with a borrowed/left-open session could silently change it and lock the
       brother out. Prove the old password first by re-authenticating with it; this
       returns { error } on a wrong password and refreshes the same session on success. */
    verifyPassword: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    /* Change the SIGN-IN email. Supabase sends a confirmation link and does not
       switch the address until it's clicked, so an account can't be hijacked by a
       typo. (Separate from `brothers.email`, the contact address on the profile.) */
    updateEmail: function (email) { return client.auth.updateUser({ email: email }); },
    // Disconnect my account from its family-tree row (row becomes claimable again).
    releaseProfile: function () { return client.rpc('release_profile'); },

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
      return client.auth.getSession().then(function (r) {
        if (!r.data || !r.data.session) return [];
        return client.from('family_public').select('*')
          .then(function (x) { return x.data || []; });
      });
    },
    // Full detail of ALL verified brothers — RLS only returns data to an
    // approved brother / admin. Used to hydrate the roster for signed-in brothers.
    listVerifiedDetail: function () {
      if (!configured) return Promise.resolve([]);
      var self = this;
      return client.from('brothers').select('*').eq('status', 'verified')
        .then(function (r) { return self._signPhotos(r.data || []); });
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
      return client.rpc('claim_profile', { target_id: targetId });
    },
    // One brother's full detail (RLS-gated: approved brother / admin / owner).
    brotherDetail: function (id) {
      if (!configured) return Promise.resolve(null);
      var self = this;
      return client.from('brothers').select('*, brother_titles(title,term,scope,sort)').eq('id', id).maybeSingle()
        .then(function (r) { return r.data ? self._signPhotos(r.data) : null; });
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
      return client.from('brothers').select('*').eq('user_id', userId).maybeSingle()
        .then(function (r) { return r.data ? self._signPhotos(r.data) : null; });
    },
    upsertProfile: function (row) {
      return client.from('brothers').upsert(row, { onConflict: 'user_id' }).select().maybeSingle();
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
    setStatus: function (id, status) {
      return client.from('brothers').update({ status: status }).eq('id', id);
    },
    updateBrother: function (id, fields) {
      return client.from('brothers').update(fields).eq('id', id);
    },
    deleteBrother: function (id) {
      return client.from('brothers').delete().eq('id', id);
    },
    // Admin: add roster rows directly (single object or array). Unclaimed
    // (user_id null) + verified so they appear in the tree immediately.
    addBrothers: function (rows) {
      return client.from('brothers').insert(rows).select();
    },

    /* ---- member directory (author chips; approved brothers only) ---- */
    memberDirectory: function () {
      if (!configured) return Promise.resolve({});
      if (this._dirCache) return Promise.resolve(this._dirCache);
      var self = this;
      return client.from('member_directory').select('*').then(function (r) {
        return self._signPhotos(r.data || []);   // author chips show avatars
      }).then(function (rows) {
        var map = {};
        (rows || []).forEach(function (m) { map[m.user_id] = m; });
        self._dirCache = map;
        return map;
      });
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
    galleryComments: function (postId) {
      return client.from('gallery_comments').select('*').eq('post_id', postId)
        .order('created_at').then(function (r) { return r.data || []; });
    },
    galleryUpload: function (userId, blob, ext) {
      var path = userId + '/' + Date.now() + '.' + ext;
      return client.storage.from('gallery').upload(path, blob, { contentType: 'image/jpeg' })
        .then(function (r) { if (r.error) throw r.error; return path; });
    },
    gallerySignedUrls: function (paths) {
      if (!paths.length) return Promise.resolve({});
      return client.storage.from('gallery').createSignedUrls(paths, 3600).then(function (r) {
        var map = {};
        (r.data || []).forEach(function (row, i) { if (row.signedUrl) map[paths[i]] = row.signedUrl; });
        return map;
      });
    },
    galleryCreate: function (row) { return client.from('gallery_posts').insert(row).select().single(); },
    galleryDeletePost: function (id, imagePath) {
      var p = client.from('gallery_posts').delete().eq('id', id);
      if (!imagePath) return p;
      return p.then(function (r) {
        return client.storage.from('gallery').remove([imagePath]).then(function () { return r; });
      });
    },
    likePost: function (postId, userId) {
      return client.from('gallery_likes').insert({ post_id: postId, user_id: userId });
    },
    unlikePost: function (postId, userId) {
      return client.from('gallery_likes').delete().eq('post_id', postId).eq('user_id', userId);
    },
    addComment: function (postId, userId, body) {
      return client.from('gallery_comments').insert({ post_id: postId, author_user: userId, body: body });
    },
    deleteComment: function (id) { return client.from('gallery_comments').delete().eq('id', id); },

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
      return client.from('event_rsvps').select('event_id, user_id')
        .then(function (r) { return r.data || []; });
    },
    rsvp: function (eventId, userId) {
      return client.from('event_rsvps').insert({ event_id: eventId, user_id: userId });
    },
    unrsvp: function (eventId, userId) {
      return client.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', userId);
    },

    /* ---- site settings (announcement banner) ---- */
    getSetting: function (key) {
      if (!configured) return Promise.resolve(null);
      return client.from('site_settings').select('value').eq('key', key).maybeSingle()
        .then(function (r) { return r.data ? r.data.value : null; });
    },
    setSetting: function (key, value) {
      return client.from('site_settings').upsert({ key: key, value: value, updated_at: new Date().toISOString() });
    },

    /* ---- polls (admin-created; members vote) ---- */
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
    committeeRename: function (id, name) { return client.from('committees').update({ name: name }).eq('id', id); },
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

    /* ---- networking: intro request (SECURITY DEFINER RPC; see upgrade9.sql) ---- */
    connectRequest: function (targetUserId) {
      return client.rpc('connect_request', { target: targetUserId })
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

    /* ---- email: digest + invites (Edge Functions; see supabase/functions/) ---- */
    _fn: function (slug) { return (window.ZBXI_CONFIG.SUPABASE_URL) + '/functions/v1/' + slug; },
    _token: function () {
      return client.auth.getSession().then(function (r) {
        return (r.data && r.data.session && r.data.session.access_token) || null;
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
    invitesList: function () {
      return client.from('invites').select('*').order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },
    setEmailOptOut: function (userId, optOut) {
      return client.from('brothers').update({ email_opt_out: optOut }).eq('user_id', userId);
    },

    /* ---- notifications ---- */
    notifList: function () {
      return client.from('notifications').select('*')
        .order('created_at', { ascending: false }).limit(30)
        .then(function (r) { return r.data || []; });
    },
    notifMarkAllRead: function () {
      return client.from('notifications').update({ read: true }).eq('read', false);
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
