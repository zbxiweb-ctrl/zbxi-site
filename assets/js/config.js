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

  // Giving campaigns: paste the chapter's Stripe Payment Link / PayPal / Venmo
  // URLs here when ready — the "Give now" buttons appear automatically.
  DONATION_LINKS: {
    annual_fund:  '',   // e.g. 'https://buy.stripe.com/…'
    scholarship:  '',
    philanthropy: ''
  }
};
