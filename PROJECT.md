---
title: Zeta Beta Xi Fraternity Website
type: website
status: active
tags: [website, fraternity, zbxi, geneseo]
created: 2026-07-07
url: "https://zetabetaxi.com"
---

# Zeta Beta Xi (ΖΒΞ) — Fraternity Website

Chapter website for Zeta Beta Xi, a local fraternity at SUNY Geneseo (founded 1993). Navy & gold, crest-forward, static HTML/CSS/JS with a Supabase backend: 21 pages, a members' area behind sign-in, and admin + officer consoles. Live at zetabetaxi.com, deployed from `main` to Cloudflare Workers.

**Public:** homepage (history, Greek Excellence awards, teasers), privacy, terms, accessibility, 404 · contact via Formspree.

**Members-only** (sign in as an approved brother): active + alumni directories, pledge-class pages, executive-board archive, family tree, gallery, discussion board with polls and a suggestion box, chapter calendar with RSVPs, mentoring, the worldwide map, the alumni fund, notifications and orientation.

**Consoles:** `admin.html` for the webmaster (verification, events, awards, email, digests, gallery sections, suggestions and more) and `officer.html` for officers, scoped by seat.

**How membership works:** a brother signs up (or claims an invite) → his profile is `pending` → an admin or officer approves him → he appears in the roster and family tree and can reach the members' area. Each brother's `big_id` is what builds the tree. Supabase enforces all of this with row-level security; the browser only ever holds the public anon key.

**Status:** Live at zetabetaxi.com with the real roster (300+ brothers), Supabase and Formspree both wired, optional two-step verification, and a queued email system. Research brief: [[2026-07-07-zbxi-fraternity-research]].

**Deploying:** `git push` to `main` publishes to Cloudflare Workers — there is no staging, so verify locally first. Developer notes live in README.md.
