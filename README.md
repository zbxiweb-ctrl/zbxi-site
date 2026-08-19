# Zeta Beta Xi (ΖΒΞ) — zetabetaxi.com

The chapter site for Zeta Beta Xi, a local fraternity at SUNY Geneseo (est. 1993):
a public face for the chapter, and behind sign-in a members' area — roster, family
tree, gallery, discussion board, calendar, mentoring and a worldwide map — plus an
admin console and an officer console.

Plain HTML, CSS and JavaScript. **No build step and no framework**: what is in this
repo is exactly what ships. Open any page directly, or serve the folder (see below).

## Running it locally

```
python ../../../.claude/tools/serve-nocache.py 8899 .     # then http://localhost:8899
```

Use a no-cache server rather than `python -m http.server`: without `Cache-Control`,
Chrome guesses freshness and will happily replay a stale `.js` for hours, which has
twice made local testing exercise old code.

Note that sign-in does **not** work on localhost — the bot check (Turnstile) is
domain-locked, so anything behind the members' gate has to be tested on the live site.

## Layout

```
*.html                 21 pages. index is the public homepage; the rest are either
                       members-only (roster, tree, gallery, board, events, map,
                       mentoring, donations, class, notifications, welcome) or
                       public (privacy, terms, accessibility, 404). mentor.html is
                       a redirect stub kept alive for links in already-sent emails.
assets/css/styles.css  The whole design system: navy + gold, light and dark themes.
                       Theme tokens live near the bottom; dark mode is a
                       [data-theme="dark"] attribute on <html>.
assets/css/fonts.css   Self-hosted Playfair Display / Inter / Cormorant Garamond,
                       mirrored locally so no visitor IP goes to Google.
assets/js/             ~36 modules, one per surface. See the map below.
assets/img/            Crest variants and the social banner.
supabase/              schema.sql plus the numbered upgrade files that built the
                       database, and the edge functions under supabase/functions/.
_headers               Security headers (CSP, frame-ancestors, permissions) and
                       cache policy for Cloudflare.
wrangler.jsonc         Cloudflare Workers static-asset config.
```

### The JavaScript, roughly in load order

| File | What it does |
|---|---|
| `config.js` | Supabase URL + anon key, admin email, Turnstile site key |
| `zbxi-util.js` | `ZBXIUtil`: `esc`, `pledgeYear`, `loadError`, `signInHref`. Loaded before everything else; other modules assume it exists |
| `supabase-client.js` | The entire data layer — every query and RPC lives here as `window.ZBXI` |
| `page-shell.js` / `main.js` | Footer year + mobile nav (`main.js` also drives the homepage) |
| `header-account.js` | The account chip and its dropdown, and the signed-in chrome |
| `notify.js` / `notifications-page.js` | The bell, and the full history page |
| `portal.js` | Sign in / create account / account settings / profile editing |
| `brothers-page.js`, `class-page.js`, `eboards.js` | Roster, pledge-class pages, board archive |
| `family-tree.js` | The pan/zoom lineage tree |
| `gallery.js`, `board.js`, `events-page.js` | Photos, discussion, calendar |
| `mentor-page.js`, `map-page.js`, `worldwide-map.js`, `donations.js` | Mentoring, the alumni map, the fund |
| `admin.js`, `officer.js` | The two consoles; `email-tab.js`, `botm-tab.js`, `mentoring-tab.js` are tabs shared by both |
| `ask-modal.js` | `ZBXIAsk` — the site's own confirm/alert. Use it; never the browser's |
| `a11y.js`, `theme-toggle.js`, `scroll-fx.js`, `turnstile.js`, `mfa-guard.js`, `password-peek.js`, `profile-card.js`, `brother-edit.js`, `event-when.js` | Cross-cutting behaviour |

## Backend

Supabase: Postgres with row-level security on every table, Auth (with optional
two-step verification), and Storage for photos. The database was built by the
numbered files in `supabase/` applied in order — they are a history, not a
rebuild script. Edge functions live in `supabase/functions/`.

**No secret belongs in this repo.** Treat it as public, because it is. The anon
key in `config.js` is meant to be public; service-role keys, management tokens and
email keys live only in the provider's secret store.

## Deploying

Cloudflare Workers serves the folder as static assets. **`git push` to `main`
deploys.** There is no staging environment, so verify locally first.

## House rules worth knowing

- Anything painted on a navy background must use the theme tokens
  (`--on-navy`, `--console-*`), never literal navy or cream hex — the navy family
  turns black in dark mode and a literal will not follow it.
- Escape user data with `ZBXIUtil.esc()` before it goes anywhere near `innerHTML`.
- Use `ZBXIAsk` for confirms and alerts so dialogs match the site.
- Use `ZBXI.approvalState()` (not `amApprovedBrother()`) wherever a failure would
  otherwise be shown to a brother as "you are not a member".
