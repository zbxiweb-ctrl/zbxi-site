# Zeta Beta Xi Website — Ownership & Handoff

This document is the "keys to the kingdom" map for the ΖΒΞ website. Keep it current. When an officer graduates or the site changes hands, this file is all the next person needs.

> **Golden rule:** the chapter should control the domain and one central account. Nothing critical should live *only* on a personal login. Update the "Controlled by" column whenever that changes.

## Accounts & assets

| Asset | What it is | Where | Controlled by | Cost |
|---|---|---|---|---|
| **Chapter account** | The central Google account that owns everything below | `zbxi.web@gmail.com` (example) | _fill in_ | Free |
| **Domain** | The web address (e.g. `zbxigeneseo.org`) | Cloudflare Registrar (or Namecheap) | Chapter account | ~$10–12 / yr |
| **Code** | This website's source | GitHub repo `github.com/<org>/zbxi-site` | Chapter GitHub org | Free |
| **Hosting** | Runs & serves the site | Vercel project `2026-07-07-zbxi-fraternity` | _current maintainer_ + chapter account as member | Free (Hobby) |
| **Members backend** | Brother accounts, profiles, family tree | Supabase project (see `supabase/schema.sql`) | Chapter account | Free tier |
| **Contact form** | Delivers messages to an inbox | Formspree | Chapter account | Free tier |

## Where the config lives

- `assets/js/config.js` — Supabase URL + anon key + admin email. **The anon key is safe to publish** (that's its purpose). Never put a Supabase `service_role` key here.
- `index.html` — the Formspree endpoint on `#contactForm` (search `YOUR_FORM_ID`).
- No other secrets exist in this project. Nothing here should ever contain a private/service key.

## How to edit the site

The whole site is plain HTML/CSS/JS in this repo — no build step.
- **Content/text:** edit `index.html`.
- **Brother roster / family tree placeholders:** `assets/js/main.js` and `assets/js/family-tree.js` (or, once live, the data comes from Supabase).
- **Colors/design:** `assets/css/styles.css`.
- **Photos & crest:** `assets/img/` (all placeholders are labeled). See `README.md` for the full swap-in checklist.

## How to deploy

- **Auto-deploy (preferred):** once the GitHub repo is connected to Vercel, every `git push` to the `main` branch redeploys automatically. Workflow: edit → `git add -A && git commit -m "…" && git push`.
- **Manual (fallback):** from this folder, `npx vercel --prod`.

## How to transfer to a future officer (5-minute version)

1. **Chapter account:** change the password of the central Google account and give it to the new maintainer/e-board. This alone conveys most control.
2. **Domain:** it's already under the chapter account at the registrar — just ensure the new person has the account login. (Registrar transfers between accounts have ICANN timing rules; keeping it in the chapter account avoids that.)
3. **GitHub:** add the new maintainer to the chapter GitHub org, or transfer the repo (GitHub → repo Settings → Transfer).
4. **Vercel:** add them as a member of the Vercel project (Project → Settings → Members), or re-import the GitHub repo into their Vercel.
5. **Supabase / Formspree:** both are under the chapter account — hand over the login; optionally add them as project members.

## Cost reality (for the chapter)

Build $0 · Vercel $0 (Hobby tier — fine for a non-revenue club) · Supabase $0 · Formspree $0 · **Domain ≈ $10–12/yr** — the only recurring cost. Compare to vendor quotes of $2,500–4,000. Only upgrade Vercel to Pro ($20/mo) if the site ever sells something.

## Maintainers log

| Date | Maintainer | Notes |
|---|---|---|
| 2026-07 | _(founding alum)_ | Built + deployed the site; setting up chapter ownership. |
