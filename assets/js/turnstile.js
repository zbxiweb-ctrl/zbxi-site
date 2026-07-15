/* Cloudflare Turnstile — bot protection on the auth forms.
   Loads the API once (explicit-render mode) and lets any dynamically-built form
   drop in a widget, then read or reset its token.

   Why a helper: the portal + admin build their forms as HTML strings and swap
   them in at render time, so a widget has to be mounted after each form appears.

   SAFE BY DEFAULT: if no TURNSTILE_SITEKEY is configured, every call no-ops and
   token() returns '' — forms keep working, they just aren't captcha-gated. And a
   form should PASS whatever token() gives it (even '') and let Supabase decide:
   that way a widget that fails to load can't hard-lock anyone out of logging in. */
(function () {
  'use strict';
  var cfg = window.ZBXI_CONFIG || {};
  var KEY = cfg.TURNSTILE_SITEKEY || '';
  var API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  var loadP = null;
  function load() {
    if (!KEY) return Promise.resolve(false);
    if (loadP) return loadP;
    loadP = new Promise(function (res) {
      if (window.turnstile) return res(true);
      var s = document.createElement('script');
      s.src = API; s.async = true; s.defer = true;
      s.onload = function () { res(!!window.turnstile); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
    return loadP;
  }

  window.ZBXITurnstile = {
    enabled: !!KEY,
    /* Mount a widget inside `host` (an element). Returns a handle:
         token() -> current response token, or '' if not solved / disabled
         reset() -> clear + re-challenge (call after a failed submit so the
                    single-use token is replaced before the next attempt)
       `onSolve(token)` fires when a token first becomes available (optional). */
    render: function (host, onSolve) {
      var handle = {
        _id: null,
        token: function () {
          return (handle._id !== null && window.turnstile) ? (window.turnstile.getResponse(handle._id) || '') : '';
        },
        reset: function () {
          if (handle._id !== null && window.turnstile) { try { window.turnstile.reset(handle._id); } catch (e) {} }
        }
      };
      if (!KEY || !host) return handle;
      load().then(function (ok) {
        if (!ok || !window.turnstile) return;
        try {
          handle._id = window.turnstile.render(host, {
            sitekey: KEY,
            callback: function (t) { if (onSolve) onSolve(t); }
          });
        } catch (e) { /* double-render or torn-down host — ignore */ }
      });
      return handle;
    }
  };

  load();   // warm the loader so the first widget appears promptly
})();
