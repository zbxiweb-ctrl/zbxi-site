# Zeta Beta Xi Website — Ownership & Handoff

This document is the "keys to the kingdom" map for the ΖΒΞ website. Keep it current. When an officer graduates or the site changes hands, this file is all the next person needs.

> **Golden rule:** the chapter should control the domain and one central account. Nothing critical should live *only* on a personal login. Update the "Controlled by" column whenever that changes.

## Accounts & assets

| Asset | What it is | Where | Controlled by | Cost |
|---|---|---|---|---|
| **Chapter account** | The central Google account that owns everything below | `zbxi.web@gmail.com` (example) | _fill in_ | Free |
| **Domain** | The web address (e.g. `zbxigeneseo.org`) | Cloudflare Registrar (or Namecheap) | Chapter account | ~$10–12 / yr |
| **Code** | This website's source | GitHub repo `github.com/zbxiweb-ctrl/zbxi-site` (public) | Chapter GitHub account | Free |
| **Hosting** | Runs & serves the site | **Cloudflare Workers**, worker `zbxi-site` (config: `wrangler.jsonc`) | Chapter Cloudflare account | Free |
| **Members backend** | Brother accounts, profiles, family tree | Supabase project `zbxi-site` (see `supabase/schema.sql`) | Chapter account | Free tier |
| **Account email** | Password resets, sign-up confirmations | Resend, sending domain `send.zetabetaxi.com` | Chapter account | Free (100/day, 3,000/mo) |
| **Brotherhood email** | Monthly digest, chapter emails, invitations | Brevo, same sending domain, link domain `em.send.zetabetaxi.com` | Chapter account | Free (300/day) |
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

- **Push to deploy.** The GitHub repo is connected to Cloudflare, so every `git push` to `main` rebuilds
  and goes live in under a minute. Workflow: edit → `git add -A && git commit -m "…" && git push`.
  **A push IS a production deploy** — there is no staging step.
- **Headers/CSP** live in `_headers`; the not-found behaviour lives in `wrangler.jsonc`
  (`assets.not_found_handling: "404-page"`). Both are read from the repo at build time.
- **The database and the email functions deploy separately** from the website. SQL changes are applied to
  Supabase, and the `supabase/functions/*.ts` edge functions are deployed to Supabase — neither is part of
  the Cloudflare build, so pushing the site alone will not update them.

## How to transfer to a future officer (5-minute version)

1. **Chapter account:** change the password of the central Google account and give it to the new maintainer/e-board. This alone conveys most control.
2. **Domain:** it's already under the chapter account at the registrar — just ensure the new person has the account login. (Registrar transfers between accounts have ICANN timing rules; keeping it in the chapter account avoids that.)
3. **GitHub:** add the new maintainer to the chapter GitHub org, or transfer the repo (GitHub → repo Settings → Transfer).
4. **Cloudflare:** hand over the chapter Cloudflare login (it holds both the hosting and the DNS). If they'd rather use their own account, re-connect the GitHub repo to it and repoint the domain.
5. **Supabase / Resend / Formspree:** all under the chapter account — hand over the login; optionally add them as project members. **Rotate the Resend API key and the Supabase keys on handover**, and remove any GitHub deploy keys under repo Settings → Deploy keys.

## Cost reality (for the chapter)

Cloudflare $0 · Supabase $0 · Resend $0 · Formspree $0 · **Domain ≈ $10–12/yr** — the only recurring cost. Compare to vendor quotes of $2,500–4,000.

Where the free tiers actually bite, in the order you'll hit them:
1. **Brevo: 300 emails/day** for brotherhood mail. With 113 brothers holding accounts a full send uses about a third of it, so there is real headroom — and because account email sits on a *separate* provider, a newsletter can no longer stop anyone resetting their password. The two were on one 100/day account until 2026-08-11; if they are ever recombined, that fragility comes back.
2. **Supabase Free keeps no database backups.** Pro ($25/mo) adds point-in-time recovery.
3. Storage and bandwidth have years of headroom; ignore them.

## Maintainers log

| Date | Maintainer | Notes |
|---|---|---|
| 2026-07 | _(founding alum)_ | Built + deployed the site; setting up chapter ownership. |
