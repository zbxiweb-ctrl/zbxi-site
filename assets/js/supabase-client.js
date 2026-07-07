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
