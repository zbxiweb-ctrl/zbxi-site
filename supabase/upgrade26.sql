-- ============================================================================
-- upgrade26.sql — contact-info privacy view + Active/Alumni self-select.
-- Applied live via the Management API (2026-07-17); kept here for the record.
--
-- Part A (privacy — applied first): peer roster reads moved off the raw
-- brothers table onto the self-gating roster_detail view. The view omits
-- unsubscribe_token entirely and returns email/phone ONLY when that brother's
-- own contact_prefs opts in — the "share my email/phone" promise is now
-- enforced by the database, not just by what the page draws. After the client
-- was repointed (commit 44df714), the brothers_brother_read policy was
-- DROPPED: peers can no longer read raw rows at all. brothers_own_read (the
-- profile edit form) and brothers_admin_read (the console) are untouched.
--
-- Part B (standing): brothers pick Active vs Alumni themselves. Nullable —
-- rows without it keep the computed split (grad_year / pledge-class year + 4,
-- brothers-page.js). The tg_guard_status trigger pins only
-- status/user_id/role/role_scope, so a brother may write his own standing.
-- ============================================================================

-- Part B — the self-select column
alter table public.brothers
  add column if not exists standing text check (standing in ('active','alumni'));

-- Parts A+B — the peer-read view (current live definition, standing appended)
create or replace view public.roster_detail as
  select
    id, user_id, full_name, pledge_class, grad_year, major, big_id,
    hometown, bio, quote, linkedin, photo_url, role, status, created_at,
    occupation,
    case when 'email' = any(string_to_array(contact_prefs, ',')) then email end as email,
    city,
    case when 'phone' = any(string_to_array(contact_prefs, ',')) then phone end as phone,
    contact_prefs, skills, role_term, roster_name, role_scope, company,
    industry, open_to, email_opt_out, decided_at,
    (user_id is not null) as registered,
    standing
  from public.brothers
  where status = 'verified'
    and (public.is_approved_brother() or public.is_admin());
grant select on public.roster_detail to authenticated;

-- Part A — the policy drop (ONLY after the client reads roster_detail;
-- dropping it first blanks the live roster for every brother).
drop policy if exists brothers_brother_read on public.brothers;

-- A new view is invisible to PostgREST until its schema cache reloads:
notify pgrst, 'reload schema';

-- Rollback for Part A lives in
-- output/2026-07-17-zbxi-security-review-admin-portal/contact-privacy-rollback.sql
