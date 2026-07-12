# Officer Console — design + build handoff

**Status:** designed, not built. Resume on **desktop** (Supabase must be reachable to
apply + verify the migration — the remote web session's network policy blocks Supabase).
**Branch:** `claude/resume-zbxi-website-3r9n76`.

## Context / why

To give the site longevity, the two chapter **Presidents** should be able to run
day-to-day site tasks without needing the Admin (webmaster). We add an **Officer
Console** (`officer.html`, styled like the Admin Console) exposing only the tasks the
Admin has granted. Every officer permission is an **Admin-controlled toggle, OFF by
default**. The Admin keeps total control; nothing here lets an officer touch the Admin
identity or escalate.

Two officer seats (per user decision — build the grants table keyed by seat so more
seats can be added later without a rewrite):

- **Active President** — `brothers.role='President'` AND `role_scope='active'`
- **Alumni President** — `brothers.role='President'` AND `role_scope='alumni'`

## The security invariant we must NOT break

Admin identity is **not a flippable column** — it is `auth.jwt() email == admin_email()`
(see `supabase/upgrade14.sql`). There is no `is_admin` boolean to set, which is exactly
why admin can't be escalated to. The officer layer must preserve this:

1. **Officers can never write their own grants.** The grants table is admin-write-only
   (RLS `is_admin()`); officers may only *read* it.
2. **Officers can never write `role` / `role_scope` / `status` / `user_id`.** These are
   already pinned for non-admins by `tg_guard_status` (`supabase/upgrade13.sql`) — leave
   that trigger untouched. This is what stops an officer assigning themselves/anyone an
   E-Board title (the escalation vector) or self-approving.
3. **The `brothers` admin policies stay untouched** — no officer path is added to them.
4. Officer powers are granted only by adding `or public.officer_can('<key>')` to the RLS
   of **safe** tables (events, committees, awards, polls, suggestions, gallery). Dangerous
   tables never reference `officer_can`, so there is no code path to them.

## Permission matrix (the brainstorm)

Each cell is an independent Admin toggle (OFF by default). Admin decides which seat gets what.

| Permission key         | What it allows                                              | Active Pres | Alumni Pres | Notes |
|------------------------|-------------------------------------------------------------|:-----------:|:-----------:|-------|
| `events.manage`        | Create / edit / delete calendar events                      | ✅ | ✅ | Alumni pres for reunions/alumni events |
| `committees.manage`    | Create/rename committees, add/remove members                | ✅ | – | Chapter operations |
| `awards.manage`        | Manage Greek-Excellence / awards                            | ✅ | ✅ | Alumni pres for alumni recognition |
| `announcements.manage` | Create/close polls & announcements                          | ✅ | – | |
| `suggestions.respond`  | Read + **respond** to member suggestions (NOT delete)       | ✅ | ✅ | Delete stays admin-only |
| `gallery.moderate`     | Delete inappropriate gallery posts/comments **(boundary — ENABLED)** | ✅ | ✅ | User approved as a toggle |
| `giving.manage`        | Edit giving/donation blurbs (settings-backed, see below)    | – | ✅ | Optional scope — see "Giving note" |
| `digest.preview`       | Preview/draft the alumni email digest                       | – | ✅ | Read-only, safe |
| `digest.send`          | **Actually send** the alumni email blast **(boundary — ENABLED)** | – | ✅ | User approved; edge-function change |

The "–" cells simply mean don't surface that toggle for that seat in the Admin UI (or
show it disabled). The table/function are seat-agnostic; the UI curates.

### Permanently Admin-only — NEVER a toggle, hard-walled in RLS

- Changing `admin_email()` / the admin identity
- Writing `officer_grants` (granting/revoking any officer permission)
- **Approving / rejecting / revoking / deleting brothers; editing any other brother's
  account** — per user decision, *Approve pending brothers stays admin-only*
- **Assigning or changing E-Board titles** (`role` / `role_scope` / `role_term`) — the
  escalation vector
- **Semester rollover** (destructive board wipe)
- Invite emails (`inviteBrothers`) and security/site settings

## Build plan (desktop)

### 1) DB migration — `supabase/upgrade17.sql` (new)

```sql
-- officer_grants: which permission is enabled for which seat. Admin-write-only.
create table if not exists public.officer_grants (
  seat        text not null check (seat in ('active_president','alumni_president')),
  permission  text not null,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  primary key (seat, permission)
);
alter table public.officer_grants enable row level security;

-- Everyone signed in may READ (console + account-menu gating need to know what's on)…
create policy og_read   on public.officer_grants for select using (auth.uid() is not null);
-- …but ONLY the admin may write. Officers cannot grant themselves anything.
create policy og_admin_write on public.officer_grants
  for all using (public.is_admin()) with check (public.is_admin());
grant select on public.officer_grants to authenticated;

-- Caller's seat, derived from their OWN (trigger-pinned) role/role_scope. Cannot be spoofed.
create or replace function public.my_officer_seat()
returns text language sql stable security definer set search_path = public as $$
  select case
    when b.role = 'President' and b.role_scope = 'active' then 'active_president'
    when b.role = 'President' and b.role_scope = 'alumni' then 'alumni_president'
    else null end
  from public.brothers b
  where b.user_id = auth.uid() and b.status = 'verified'
  limit 1;
$$;

-- The single gate every safe-table policy consults.
create or replace function public.officer_can(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.officer_grants g
    where g.seat = public.my_officer_seat()
      and g.permission = perm
      and g.enabled
  );
$$;
grant execute on function public.my_officer_seat(), public.officer_can(text) to authenticated;
```

Then **amend safe-table policies** (find them in `supabase/upgrade3.sql` /
`upgrade6.sql`) by adding an officer clause — e.g. events:

```sql
drop policy if exists events_admin_write on public.events;
create policy events_write on public.events
  for all using (public.is_admin() or public.officer_can('events.manage'))
  with check (public.is_admin() or public.officer_can('events.manage'));
```

Repeat the same shape for `committees` / `committee_members` (`committees.manage`),
`awards` (`awards.manage`), `polls` (`announcements.manage`), gallery delete policies
(`gallery.moderate`), and suggestion **update** (`suggestions.respond`) — but NOT
suggestion delete. **Do not touch** the `brothers`, `title_requests`, or admin policies.

Apply via the Supabase Management API (same agent-run path as upgrade13–16), and keep
this file committed as the record.

### 2) Data API — `assets/js/supabase-client.js`

Add: `officerGrantsList()` (select *), `officerGrantSet(seat, permission, enabled)`
(admin upsert), `myOfficerSeat()` (rpc), `officerCan(perm)` (local check off a cached
grants+seat load). Mirror the existing method style in that file.

### 3) Officer Console — `officer.html` + `assets/js/officer.js` (new)

- `officer.html` mirrors `admin.html`'s shell (same topbar/crest, loads config →
  supabase-client → officer.js). Reuse the `.admin-*` CSS classes so it looks identical.
- `officer.js`: on load, resolve `my_officer_seat()` + enabled grants, then render **only
  the permitted tabs**. Each tab reuses the same editors the Admin Console already has
  (events, committees, awards, suggestions, gallery moderation). **Design decision for
  desktop:** either extract the shared editors from `admin.js` into a small module both
  consoles import, or carefully duplicate. Extracting is cleaner given how much overlaps.
- If the signed-in user has no seat or no enabled grants, show a friendly "no officer
  tools enabled" state (never a blank/broken page).

### 4) Admin Console "Officers" tab — `assets/js/admin.js`

Add one tab under the **Site** group (`TAB_GROUPS`, ~line 63): a grid — rows = permission
keys, columns = the two seats — of checkboxes wired to `officerGrantSet(...)`. Flipping a
box is the entire admin workflow. Show who currently holds each seat (from
`state.data.verified` where `role='President'`).

### 5) Account-menu gating — `assets/js/header-account.js`

Next to the existing `isAdmin` "Admin Console" link (~line 125), add an "Officer Console"
link shown when the user is a current President **and** has ≥1 enabled grant. Mirror the
`isAdmin` pattern exactly.

### 6) Alumni digest send — `supabase/functions/zbxi-digest.ts`

Currently admin-gated. Allow send when the caller is the Alumni President AND
`officer_grants('alumni_president','digest.send')` is enabled. Verify the JWT, look up the
seat + grant server-side (never trust the client). Preview stays available to
`digest.preview`.

### Giving note (`giving.manage`)

Donation links live in `assets/js/config.js` (`DONATION_LINKS`) — that's **code**, not DB,
so an officer can't edit it without a repo push. To make `giving.manage` real, move those
blurbs into the existing settings table (`getSetting`/`setSetting`, see the settings
migration) and read them at render. Treat this as optional follow-up scope, not blocking.

## Verification (must run against the live DB on desktop)

**Escalation blocked (each must FAIL):**
1. As Active President, attempt to `update brothers set role='President'` on own row → pinned by `tg_guard_status`.
2. As either President, `insert/update officer_grants` → RLS denies (admin-write-only).
3. As Active President, attempt to assign an E-Board title to anyone → denied.
4. As Active President, approve/reject/delete a pending brother → denied (admin-only).
5. As a plain verified brother (no seat), confirm `officer_can(...)` is false for everything.

**Grants work (each must SUCCEED only when toggled on):**
6. Admin enables `events.manage` for `active_president` → that President can add/edit/delete an event; toggle OFF → the ability disappears immediately (re-test the same call → denied).
7. Admin enables `gallery.moderate` for a seat → that President can delete a flagged post; comments too.
8. Admin enables `digest.send` for `alumni_president` → the edge function accepts the send; with it OFF → 403.

**No regressions:** Admin still has every capability; public site + normal brother flows unchanged.
