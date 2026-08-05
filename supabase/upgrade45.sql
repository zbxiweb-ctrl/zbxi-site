-- ============================================================================
-- upgrade45 — close the two holes the upgrade44 security review found.
--
-- upgrade44 handed the signup queue to the Alumni Presidents. Neither hole below
-- was CREATED by it — both were dormant while the webmaster, who knows every
-- brother personally, was the only approver. upgrade44 is what made them
-- reachable, because it built an officer's entire vetting UI on top of data the
-- applicant can write, and handed the approve verb to someone who has nothing
-- else to go on.
--
-- Both were reproduced against the live database with throwaway fixtures before
-- being fixed, and neither is theoretical:
--
-- 1) 🟠 THE "✓ CLAIMED AN EXISTING ROSTER ENTRY" TICK WAS FORGEABLE.
--    tg_guard_status (upgrade37) pins status, user_id, role, role_scope and
--    unsubscribe_token on a brother's own row — but NOT roster_name. authenticated
--    holds a column UPDATE grant on it, and brothers_own_update (schema.sql) lets
--    a brother PATCH his own row. So a pending applicant could set
--    roster_name = 'Some Real Brother' with one request, and the Approvals screen
--    would swap his red "🚩 Name not found on the chapter roster" for a green
--    "✓ Claimed an existing roster entry". The full list of real names is public
--    (family_public is granted to anon), so picking a convincing one is trivial.
--    PROVEN: a fixture pending brother PATCHed his own roster_name to a real
--    brother's name (HTTP 200, value stored) and pending_queue() then reported
--    b_claimed = true, b_flag = null — the reassuring case.
--
-- 2) 🟡 APPROVING A TITLED ROW MINTED AN ALUMNI PRESIDENT.
--    status is not an inert flag: my_officer_seat() reads role + role_scope +
--    status='verified'. claim_profile() (upgrade12) attaches an account to a
--    roster row and sets status='pending' WITHOUT clearing role/role_scope. So a
--    roster row already titled 'President'/'alumni' with no account attached is a
--    dormant officer seat, and an officer's single status flip fills it — handing
--    out the Officer Console with no admin action.
--    PROVEN: a fixture pending row carrying President/alumni was approved by an
--    officer (HTTP 200) and came out verified WITH the title intact.
--    No such row exists on the live database today. It is one ordinary admin
--    action away — naming an alum who has never made an account to the board.
--
-- Rollback: re-apply the upgrade44 bodies of tg_guard_status, pending_queue and
--           decide_pending_brother (they are quoted in full in upgrade44.sql).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Pin roster_name, exactly as upgrade37 pinned unsubscribe_token.
--
--    Checked before writing this, not assumed: every legitimate write to this
--    column is either the ADMIN (admin.js — roster additions, CSV import, the
--    edit modal's keep-in-sync line) or claim_profile() (upgrade12), which runs
--    under zbxi.bypass and is therefore unaffected by this pin. portal.js only
--    READS it. Nothing legitimate breaks.
-- ---------------------------------------------------------------------------
create or replace function public.tg_guard_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Admin, or a SECURITY DEFINER routine that opted in, may do anything.
  if public.is_admin() or coalesce(current_setting('zbxi.bypass', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status      := 'pending';   -- every new brother starts unverified
    new.role        := null;        -- titles are assigned by the webmaster only
    new.role_scope  := null;
    new.roster_name := null;        -- claiming a roster name is claim_profile()'s job
  else
    new.status     := old.status;      -- edits never change verification state
    new.user_id    := old.user_id;     -- and never re-point a row at another account
    new.role       := old.role;        -- brothers can't grant themselves a title
    new.role_scope := old.role_scope;  -- (current OR previous board)
    new.unsubscribe_token := old.unsubscribe_token;  -- ends up in a mail header
    new.roster_name := old.roster_name;  -- the officer's vetting signal; see header
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) An officer may not approve a profile that carries a chapter title.
--    The admin still can — this narrows the officer's verb, it does not remove
--    a power from the webmaster.
-- ---------------------------------------------------------------------------
create or replace function public.decide_pending_brother(p_id uuid, p_decision text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'decision must be verified or rejected';
  end if;
  if not (public.is_admin() or public.officer_can('members.approve')) then
    raise exception 'not allowed';
  end if;

  -- status is NOT an inert flag: my_officer_seat() = role + role_scope + verified.
  -- Approving a titled row is therefore an officer appointment, which is the
  -- webmaster's call, not an officer's. Rejecting one is still fine — that grants
  -- nothing. See the header for how such a row comes to exist.
  if p_decision = 'verified' and not public.is_admin() and exists (
       select 1 from public.brothers
        where id = p_id and role is not null and role_scope in ('active', 'alumni')
     ) then
    raise exception 'that profile carries a chapter title — only the webmaster can approve it';
  end if;

  -- Mandatory, not belt-and-braces: without it tg_guard_status pins status back
  -- to its old value and this function "succeeds" while doing nothing.
  -- set_config(..., true) is TRANSACTION-local, and PostgREST gives each RPC its
  -- own transaction, so it cannot leak to another request.
  perform set_config('zbxi.bypass', '1', true);

  update public.brothers
     set status = p_decision
   where id = p_id
     and status = 'pending';
  get diagnostics n = row_count;

  perform set_config('zbxi.bypass', '', true);

  if n = 0 then
    raise exception 'that brother is no longer waiting for a decision';
  end if;
  return p_decision;
end;
$$;

revoke all on function public.decide_pending_brother(uuid, text) from public, anon;
grant execute on function public.decide_pending_brother(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Show the officer WHY, rather than letting him hit a refusal he can't read.
--    'titled' takes priority over the roster branches: it is the one flag that
--    changes what he is able to do, not just what he should think about.
-- ---------------------------------------------------------------------------
create or replace function public.pending_queue()
returns table (
  b_id        uuid,
  b_name      text,
  b_class     text,
  b_claimed   boolean,
  b_email     text,
  b_signed_up timestamptz,
  b_flag      text       -- null | 'titled' | 'duplicate' | 'unknown'
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.officer_can('members.approve')) then
    return;
  end if;
  return query
    select b.id,
           b.full_name,
           b.pledge_class,
           (b.roster_name is not null),
           u.email::text,
           coalesce(u.created_at, b.created_at),
           case
             when b.role is not null and b.role_scope in ('active', 'alumni') then 'titled'
             when b.roster_name is not null then null
             when exists (
               select 1 from public.brothers x
               where x.id <> b.id
                 and public.name_key(coalesce(x.roster_name, x.full_name))
                   = public.name_key(b.full_name)
             ) then 'duplicate'
             else 'unknown'
           end
    from public.brothers b
    left join auth.users u on u.id = b.user_id
    where b.status = 'pending'
    order by b.full_name;
end;
$$;

revoke all on function public.pending_queue() from public, anon;
grant execute on function public.pending_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Assertions. The upgrade44 version inspected pg_policies.qual only — an
--    INSERT policy has no qual, it has with_check, so a future
--    `create policy ... for insert with check (officer_can(...))` on brothers
--    would have sailed straight past it.
-- ---------------------------------------------------------------------------
do $$
declare
  bid uuid;
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'brothers'
                and (coalesce(qual, '') like '%officer_can%'
                  or coalesce(with_check, '') like '%officer_can%')) then
    raise exception 'a brothers policy now references officer_can; that is deliberately not how this works';
  end if;

  -- NOT asserted here: that anon holds no UPDATE column grant on brothers. It
  -- does (Supabase's default privileges hand them out), and an earlier draft of
  -- this file failed on exactly that. It is not a hole and not this migration's
  -- business: both UPDATE policies on brothers are is_admin() / auth.uid() =
  -- user_id, so an anon PATCH matches no row. Checked, not assumed — an anon
  -- PATCH against a fixture row returned 200 with an empty body and changed
  -- nothing. Widening this file to revoke it would be unrelated surgery on the
  -- dangerous table.

  -- The pin must actually hold. Prove it on a throwaway row rather than trusting
  -- the function body: insert as if a brother had self-created a profile with a
  -- roster_name already set, and confirm the trigger nulled it.
  -- (is_admin() is false here — no JWT over the Management API — so the guard runs.)
  bid := gen_random_uuid();
  insert into public.brothers (id, full_name, status, roster_name)
  values (bid, '~upgrade45 selftest', 'verified', 'Somebody Real');
  if (select roster_name from public.brothers where id = bid) is not null then
    delete from public.brothers where id = bid;
    raise exception 'roster_name is still self-settable on INSERT';
  end if;
  update public.brothers set roster_name = 'Somebody Real' where id = bid;
  if (select roster_name from public.brothers where id = bid) is not null then
    delete from public.brothers where id = bid;
    raise exception 'roster_name is still self-settable on UPDATE';
  end if;
  delete from public.brothers where id = bid;
end $$;

-- Clear the self-test's noise: it is a fixture, not chapter history. The INSERT
-- lands as 'pending' (no JWT over the Management API, so tg_guard_status pins it),
-- which fires tg_notify_status and would otherwise put a phantom "~upgrade45
-- selftest is awaiting verification" bell in front of the webmaster AND both
-- Alumni Presidents.
delete from public.activity_log  where detail = '~upgrade45 selftest';
delete from public.notifications where payload->>'name' = '~upgrade45 selftest';

notify pgrst, 'reload schema';

commit;
