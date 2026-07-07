---
title: Zeta Beta Xi Fraternity Website
type: website
status: active
tags: [website, fraternity, zbxi, geneseo]
created: 2026-07-07
url: "https://2026-07-07-zbxi-fraternity.vercel.app"
---

# Zeta Beta Xi (ΖΒΞ) — Fraternity Website

Single-page collegiate marketing site for Zeta Beta Xi, a local fraternity at SUNY Geneseo (founded 1993). Blue & gold, crest-forward, static HTML/CSS/JS.

**Sections:** Home · About/History · Greek Excellence badges · Brotherhood (flip-card roster) · **Family Tree** (interactive pan/zoom lineage) · **Brother Portal** (Supabase accounts, admin-verified profiles) · Alumni & Giving · Events & Philanthropy · Gallery (lightbox) · Contact (Formspree).

**Members system (v2):** static site + Supabase (auth + Postgres + Storage) via the browser JS client with Row-Level Security. Brothers self-signup → pending → admin approves in `admin.html` → appear in roster + family tree. Each brother's `big_id` builds the tree. Graceful placeholder mode until `assets/js/config.js` is filled. Schema in `supabase/schema.sql`.

**Status:** Live with placeholder content; Formspree (contact) + Supabase (members) not yet wired — see README.md. Research brief: [[2026-07-07-zbxi-fraternity-research]].

**Next:** user creates the Supabase project + runs schema, I drop keys into config.js and redeploy; then real assets/roster.
