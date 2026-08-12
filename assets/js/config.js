/* ---------------------------------------------------------------------------
   Zeta Beta Xi — site configuration.
   Fill these in after creating a free Supabase project (see README + supabase/schema.sql).
   Until they're set, the Brother Portal shows a friendly "coming soon" state and
   the Family Tree runs on bundled placeholder data — the public site works fine.
   --------------------------------------------------------------------------- */
window.ZBXI_CONFIG = {
  SUPABASE_URL:      'https://wqhhomzbeeveuaskirfl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BWpWxARZc4e4zATsDfMrMQ_w88RcFbJ',
  // COSMETIC ONLY — controls the ADMIN badge / console link in the browser.
  // It grants NO access: real admin power is enforced by the database's
  // admin_email() function (supabase/upgrade14.sql). To change the admin for
  // real, update admin_email() in the database (one SQL statement); update this
  // line too so the browser UI matches.
  ADMIN_EMAIL:       'zbxi.web@gmail.com',

  // Cloudflare Turnstile site key (PUBLIC — safe to expose). Bot protection on the
  // auth forms. The matching SECRET lives only in Supabase Auth config, never here.
  // Leave '' to disable the widgets entirely.
  TURNSTILE_SITEKEY: '0x4AAAAAAD2Mxx_Wd2cIu6R0',

  // NOTE: DONATION_LINKS used to live here — three campaign URLs that fed "Give now"
  // buttons on the home page. Nothing was ever pasted in, so the block hid itself for
  // months while donations.html did the job properly. Removed rather than left empty:
  // a config key that no longer feeds anything is worse than none, because the next
  // person pastes a link into it and wonders why nothing happens.
  // The Venmo handle brothers actually give to is set in Admin → 🎁 Alumni Fund.
};
