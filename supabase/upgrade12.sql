-- ============================================================================
-- upgrade12.sql — approve-once profiles + smart invite links
-- Applied via Supabase Management API (agent-run). Documented here for record.
--
-- 1) APPROVE ONCE. Brothers may edit their own profile freely after they've
--    been verified; only the FIRST submission needs admin approval.
--    This means the browser must stop deciding `status` — otherwise anyone
--    could PATCH their own row to status='verified' and self-approve.
--    (brothers_own_update/insert have no WITH CHECK, so that hole is real
--     today; the only guard was the client politely sending 'pending'.)
--    A BEFORE trigger now pins `status` and `user_id` for non-admins.
--
-- 2) SMART INVITE LINKS. invite_status(token) tells the portal whether the
--    invited email already has an account, so the link lands on Log in vs
--    Create account. The token is the credential; it reveals only its own
--    invite's email.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Status guard
-- ---------------------------------------------------------------------------
create or replace function public.tg_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admin, or a SECURITY DEFINER routine that opted in, may do anything.
  if public.is_admin() or coalesce(current_setting('zbxi.bypass', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';        -- every new brother starts unverified
  else
    new.status  := old.status;      -- edits never change verification state
    new.user_id := old.user_id;     -- and never re-point a row at another account
  end if;
  return new;
end;
$$;

drop trigger if exists guard_status on public.brothers;
create trigger guard_status before insert or update on public.brothers
  for each row execute function public.tg_guard_status();

-- claim_profile() and release_profile() legitimately move status/user_id, so
-- they opt out of the guard for their own transaction.
create or replace function public.claim_profile(target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return 'error: not signed in';
  end if;
  if exists (select 1 from public.brothers where user_id = auth.uid()) then
    return 'error: this account already has a profile';
  end if;
  if not exists (select 1 from public.brothers where id = target_id and user_id is null) then
    return 'error: that name has already been claimed';
  end if;

  perform set_config('zbxi.bypass', '1', true);

  update public.brothers
     set user_id     = auth.uid(),
         status      = 'pending',
         roster_name = coalesce(roster_name, full_name)
   where id = target_id;

  return 'ok';
end;
$$;
grant execute on function public.claim_profile(uuid) to authenticated;

create or replace function public.release_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.brothers%rowtype;
begin
  if auth.uid() is null then
    return 'error: not signed in';
  end if;
  select * into r from public.brothers where user_id = auth.uid();
  if not found then
    return 'error: no profile linked to this account';
  end if;

  perform set_config('zbxi.bypass', '1', true);

  if r.roster_name is not null then
    update public.brothers
       set user_id = null,
           full_name = r.roster_name,
           status = 'verified',
           grad_year = null, major = null, hometown = null, city = null,
           occupation = null, phone = null, email = null, contact_prefs = null,
           skills = null, linkedin = null, quote = null, bio = null,
           photo_url = null, role = null, role_term = null,
           company = null, industry = null, open_to = '{}', email_opt_out = false
     where id = r.id;
  else
    delete from public.brothers where id = r.id;
  end if;

  return 'ok';
end;
$$;
grant execute on function public.release_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Invite link routing
-- ---------------------------------------------------------------------------
create or replace function public.invite_status(t uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv      public.invites%rowtype;
  has_acct boolean;
begin
  select * into inv from public.invites where token = t;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  select exists (select 1 from auth.users u where lower(u.email) = lower(inv.email))
    into has_acct;
  return jsonb_build_object('ok', true, 'email', inv.email, 'has_account', has_acct);
end;
$$;

grant execute on function public.invite_status(uuid) to anon, authenticated;
