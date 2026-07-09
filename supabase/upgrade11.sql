-- ============================================================================
-- upgrade11.sql — Phase C: email digest + brother invites
-- Applied via Supabase Management API (agent-run). Documented here for record.
--
-- Context: only a handful of the 323 brothers have accounts, so a digest alone
-- would mail almost nobody. The loop is: admin INVITES known alumni emails ->
-- they claim their profile -> the monthly DIGEST keeps them coming back.
-- Sending happens in the `zbxi-digest` / `zbxi-invite` Edge Functions.
-- NOTE: no secrets live in this file. RESEND_API_KEY / CRON_SECRET are stored
-- as Supabase function secrets and never committed.
-- ============================================================================

-- 1) Per-brother unsubscribe token (tokenised link; no login required to opt out)
alter table public.brothers
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- 2) Invites: transactional "claim your profile" emails, one recipient at a time.
--    Not a marketing list — each row is an admin-initiated invite to a known brother.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  brother_id  uuid references public.brothers(id) on delete set null,
  token       uuid not null default gen_random_uuid(),
  invited_by  uuid references auth.users(id) on delete set null,
  sent_at     timestamptz,
  error       text,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
-- Plain unique constraint (not an expression index) so PostgREST upserts can
-- use on_conflict=email. Emails are lower-cased by the invite function.
alter table public.invites drop constraint if exists invites_email_key;
alter table public.invites add constraint invites_email_key unique (email);

alter table public.invites enable row level security;
drop policy if exists invites_admin_all on public.invites;
create policy invites_admin_all on public.invites
  for all using (public.is_admin()) with check (public.is_admin());

-- 3) Digest log: what was sent, when, to how many. Drives the "since" window
--    so each digest only reports what's new since the last real send.
create table if not exists public.digest_log (
  id         uuid primary key default gen_random_uuid(),
  sent_at    timestamptz not null default now(),
  recipients int  not null default 0,
  test       boolean not null default false,
  note       text
);

alter table public.digest_log enable row level security;
drop policy if exists digest_log_admin_read on public.digest_log;
create policy digest_log_admin_read on public.digest_log
  for select using (public.is_admin());

-- 4) Accepting an invite: when a brother links an account with an invited email,
--    stamp the invite so the admin can see who has come aboard.
create or replace function public.tg_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update public.invites i
       set accepted_at = coalesce(i.accepted_at, now())
      from auth.users u
     where u.id = new.user_id
       and lower(i.email) = lower(u.email)
       and i.accepted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists invite_accepted on public.brothers;
create trigger invite_accepted after insert or update of user_id on public.brothers
  for each row execute function public.tg_invite_accepted();
