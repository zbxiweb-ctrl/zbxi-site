/* ---------------------------------------------------------------------------
   Zeta Beta Xi — site configuration.
   Fill these in after creating a free Supabase project (see README + supabase/schema.sql).
   Until they're set, the Brother Portal shows a friendly "coming soon" state and
   the Family Tree runs on bundled placeholder data — the public site works fine.
   --------------------------------------------------------------------------- */
window.ZBXI_CONFIG = {
  SUPABASE_URL:      'https://wqhhomzbeeveuaskirfl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BWpWxARZc4e4zATsDfMrMQ_w88RcFbJ',
  ADMIN_EMAIL:       'zbxi.web@gmail.com',   // the email that can approve brothers

  // Giving campaigns: paste the chapter's Stripe Payment Link / PayPal / Venmo
  // URLs here when ready — the "Give now" buttons appear automatically.
  DONATION_LINKS: {
    annual_fund:  '',   // e.g. 'https://buy.stripe.com/…'
    scholarship:  '',
    philanthropy: ''
  }
};
