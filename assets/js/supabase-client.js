/* Supabase bootstrap + shared data helpers for Zeta Beta Xi.
   Depends on the @supabase/supabase-js UMD bundle (loaded via CDN before this)
   and window.ZBXI_CONFIG (config.js). Exposes window.ZBXI. */
(function () {
  'use strict';

  var cfg = window.ZBXI_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    window.supabase && typeof window.supabase.createClient === 'function');

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
    // Disconnect my account from its family-tree row (row becomes claimable again).
    releaseProfile: function () { return client.rpc('release_profile'); },

    /* ---- brothers ---- */
    // PUBLIC: names + lineage only (via the family_public view — no details).
    listFamilyPublic: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('family_public').select('*')
        .then(function (r) { return r.data || []; });
    },
    // Full detail of ALL verified brothers — RLS only returns data to an
    // approved brother / admin. Used to hydrate the roster for signed-in brothers.
    listVerifiedDetail: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('brothers').select('*').eq('status', 'verified')
        .then(function (r) { return r.data || []; });
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
      return client.from('brothers').select('*').eq('id', id).maybeSingle()
        .then(function (r) { return r.data || null; });
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
      return client.from('brothers').select('*').eq('user_id', userId).maybeSingle()
        .then(function (r) { return r.data || null; });
    },
    upsertProfile: function (row) {
      return client.from('brothers').upsert(row, { onConflict: 'user_id' }).select().maybeSingle();
    },
    // Admin: list by status (alphabetical by name)
    listByStatus: function (status) {
      return client.from('brothers').select('*').eq('status', status)
        .order('full_name', { ascending: true });
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

    /* ---- member directory (author chips; approved brothers only) ---- */
    memberDirectory: function () {
      if (!configured) return Promise.resolve({});
      if (this._dirCache) return Promise.resolve(this._dirCache);
      var self = this;
      return client.from('member_directory').select('*').then(function (r) {
        var map = {};
        (r.data || []).forEach(function (m) { map[m.user_id] = m; });
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
    replyCounts: function () {
      return client.from('forum_replies').select('thread_id').then(function (r) {
        var map = {};
        (r.data || []).forEach(function (x) { map[x.thread_id] = (map[x.thread_id] || 0) + 1; });
        return map;
      });
    },
    threadReplies: function (threadId) {
      return client.from('forum_replies').select('*').eq('thread_id', threadId)
        .order('created_at').then(function (r) { return r.data || []; });
    },
    threadCreate: function (row) { return client.from('forum_threads').insert(row).select().single(); },
    threadDelete: function (id) { return client.from('forum_threads').delete().eq('id', id); },
    replyCreate: function (row) { return client.from('forum_replies').insert(row); },
    replyDelete: function (id) { return client.from('forum_replies').delete().eq('id', id); },

    /* ---- events ---- */
    eventsList: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('events').select('*').order('starts_at')
        .then(function (r) { return r.data || []; });
    },
    eventCreate: function (row) { return client.from('events').insert(row); },
    eventUpdate: function (id, row) { return client.from('events').update(row).eq('id', id); },
    eventDelete: function (id) { return client.from('events').delete().eq('id', id); },

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
    uploadPhoto: function (userId, file) {
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      var path = userId + '/' + Date.now() + '.' + ext;
      return client.storage.from('brother-photos').upload(path, file, { upsert: true })
        .then(function (r) {
          if (r.error) throw r.error;
          return client.storage.from('brother-photos').getPublicUrl(path).data.publicUrl;
        });
    }
  };

  window.ZBXI = Z;
})();
