# Zeta Beta Xi (ΖΒΞ) — Website

A single-page collegiate site for Zeta Beta Xi at SUNY Geneseo. Blue & gold, crest-forward, built as plain HTML/CSS/JS — no build step, no framework. Open `index.html` in any browser.

## File map

```
index.html            All 8 sections (nav, hero, about, badges, brotherhood,
                      rush, alumni, events, gallery, contact, footer)
assets/css/styles.css Design system (navy + gold, responsive)
assets/js/main.js     Nav, brother cards, gallery lightbox, form handling + roster DATA
assets/img/           crest.svg, hero.svg, portrait.svg, tile.svg  (all PLACEHOLDERS)
```

## What to replace (all placeholders are clearly marked)

1. **Crest** — swap `assets/img/crest.svg` with the chapter's official crest (keep the filename, or update the `<img src>` references in `index.html`).
2. **Hero photo** — replace `assets/img/hero.svg` with a wide chapter photo (`hero.jpg` → update the `<img>` in the `.hero__bg`). Text stays readable via text-shadow (no dark overlay — chapter house style rule).
3. **Brother roster** — edit the `eboard` and `brothers` arrays near the top of `assets/js/main.js` (name, role, year, major, quote). Put real portrait photos in `assets/img/` and point each card's `<img src>` at them (or extend the data to include a `photo` field).
4. **Gallery photos** — replace the `tile.svg` entries in the `galleryImgs` array in `main.js` with real photo paths.
5. **Events** — edit the three `<article class="event">` blocks in `index.html` with real traditions.
6. **Links** — search `index.html` for `data-placeholder`:
   - `donation-link` → your real giving/donation URL
   - `instagram`, `tiktok` → your real social URLs/handles
   - Verify the Facebook and `zbxi.org` links are correct/live.

## Contact form (Formspree — 2 minutes, free)

The Contact form needs a free Formspree endpoint:

1. Go to **https://formspree.io** → sign up with the chapter email.
2. Create a form → copy its endpoint, e.g. `https://formspree.io/f/abcdwxyz`.
3. In `index.html`, replace `https://formspree.io/f/YOUR_FORM_ID` on `#contactForm` with your endpoint.
4. Submit a test — the first submission asks you to confirm the email once.

Until connected, the form shows a clear "not connected yet" message instead of pretending to send.

## Brother accounts + Family Tree (Supabase — ~10 minutes, free)

The "Are you a brother?" portal, admin approval (`admin.html`), and live family-tree/roster data all run on **Supabase**. Until it's configured, the portal shows a friendly "coming soon" state and the family tree uses placeholder lineage — the public site works either way.

1. Create a free project at **https://supabase.com** (name it e.g. `zbxi`).
2. Open **SQL Editor** → paste all of `supabase/schema.sql` → **Run**. Before running, replace `admin@example.com` (appears twice) with the email that will approve brothers.
3. **Storage** → confirm a public bucket named `brother-photos` exists (the SQL creates it; if not, make it, Public = ON).
4. **Authentication → Sign In / Up → Email**: for the smoothest experience you can turn **"Confirm email" OFF** (optional).
5. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.
6. Paste all three values into `assets/js/config.js`:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'sb_publishable_…',
   ADMIN_EMAIL: 'president@yourchapter.com'   // must match the email in schema.sql
   ```
7. Redeploy. Now: a brother signs up at `#brothers-portal` → creates a profile → it's **pending** → you log into **`/admin.html`** with the admin email and click **Approve** → they appear in the roster and family tree.

**How the family tree fills in:** each brother picks their **big** when creating a profile, which draws the lineage automatically. For older alumni who won't sign up, you can add rows directly in the Supabase table editor (set `status = verified` and their `big_id`).

**Security:** all access is enforced by Postgres Row-Level Security — the public can only read verified brothers, brothers can only edit their own row, and only the admin email can approve. The anon key in `config.js` is safe to ship publicly (that's its purpose).

## Deploy

From inside this folder: `vercel --prod` (or drag it into Netlify). It's fully static. To use `zbxi.org`, point the domain at the host after deploying.
