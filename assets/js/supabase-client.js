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
    // Public verified roster / tree data
    listVerified: function () {
      if (!configured) return Promise.resolve([]);
      return client.from('brothers').select('*').eq('status', 'verified')
        .then(function (r) { return r.data || []; });
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
    // Admin: pending queue + approve/reject
    listPending: function () {
      return client.from('brothers').select('*').eq('status', 'pending')
        .order('created_at', { ascending: true });
    },
    setStatus: function (id, status) {
      return client.from('brothers').update({ status: status }).eq('id', id);
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
