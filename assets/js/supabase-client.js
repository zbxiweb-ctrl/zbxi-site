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
