-- upgrade67.sql — Brother of the Month becomes a choice instead of a hash.
--
-- WHAT IT REPLACES. main.js hashed the string "2026-8", sorted the eligible brothers
-- alphabetically and took hash % count, in the visitor's browser. Nothing was stored and
-- nobody chose. Two flaws made it worth replacing rather than extending:
--   • It changed MID-MONTH. Eligibility was "has a photo AND a bio" — 10 men out of 359 —
--     so an 11th brother writing a bio moved the count 10 -> 11 and hash % 11 landed on
--     someone else. The Brother of the Month silently swapped halfway through.
--   • No history and no fairness: the same few recurred, 349 could never be chosen.
--
-- ── WHO CAN SEE WHAT, AND WHY IT IS SPLIT ────────────────────────────────────────────
-- Same shape as the alumni fund (fund_gifts admin-only + fund_totals readable), for the
-- same reason: the rows that NAME A VOTER are privileged, the aggregate is not.
--   • botm_votes  (who voted for whom) — the voter himself, the admin, and an officer
--     holding 'spotlight.manage'. Nobody else, ever.
--   • botm_tally  (a view: counts and percentages) — any approved brother.
-- The owner chose LIVE percentages knowing that in a quiet race a brother watching the
-- bar can infer who just voted. That is a recorded decision, not an oversight; the
-- individual rows stay locked regardless.
--
-- ── BROTHERS NEVER WRITE THIS TABLE DIRECTLY ─────────────────────────────────────────
-- A vote has four rules (approved brother, cycle open, one per cycle, not yourself) and
-- the last one needs to look up whether a brothers row belongs to you. An RLS subquery
-- cannot do that safely — a policy's subquery runs with the CALLER's privileges, and this
-- project has already shipped a policy that refused everyone for exactly that reason. So
-- authenticated gets NO insert/update on botm_votes at all; one narrow SECURITY DEFINER
-- verb owns the write. Same pattern as the officer approval verbs in upgrade44.
--
-- ── TIMING ───────────────────────────────────────────────────────────────────────────
-- Voting during August decides September's brother:
--   cycle.period = 2026-09-01  (the month he is FEATURED)
--   opens_at     = 2026-08-01
--   closes_at    = 2026-09-01  (midnight, i.e. the end of August)
-- The cron runs 1st of the month 13:00 UTC — an hour before the digest — resolving the
-- cycle that just closed and opening the next one.
--
-- Idempotent: safe to re-run.

-- ═══ 1) The cycles ═══════════════════════════════════════════════════════════════════
create table if not exists public.botm_cycles (
  id             uuid primary key default gen_random_uuid(),
  period         date not null unique,          -- first day of the month this crowns FOR
  opens_at       timestamptz not null default now(),
  closes_at      timestamptz not null,
  winner_brother uuid references public.brothers(id) on delete set null,
  winner_source  text,
  crowned_at     timestamptz,
  crowned_by     uuid,
  created_at     timestamptz not null default now()
);

comment on table public.botm_cycles is
  'One row per month of Brother of the Month. period is the month he is FEATURED; voting '
  'runs the month before. winner_source records WHO decided: admin, auto (clear leader), '
  'or auto_tiebreak (coin flip) — upgrade67.';

do $$ begin
  -- A bare `winner_source in (...)` would pass on NULL and quietly allow anything before
  -- crowning; pairing the two columns is the constraint that actually means something.
  -- (upgrade-note: a CHECK passes on NULL, which disabled a constraint in MatRun once.)
  if not exists (select 1 from pg_constraint where conname = 'botm_cycles_winner_pair') then
    alter table public.botm_cycles add constraint botm_cycles_winner_pair
      check ((winner_brother is null) = (winner_source is null));
  end if;
  -- Dropped and re-added rather than guarded by `if not exists`: the allowed set GREW
  -- (an officer's crown is now recorded as his own, not as the webmaster's), and a
  -- create-if-absent guard would silently keep the old narrower list on a re-run.
  alter table public.botm_cycles drop constraint if exists botm_cycles_source_vals;
  alter table public.botm_cycles add constraint botm_cycles_source_vals
    check (winner_source is null or winner_source in ('admin', 'officer', 'auto', 'auto_tiebreak'));
  if not exists (select 1 from pg_constraint where conname = 'botm_cycles_window') then
    alter table public.botm_cycles add constraint botm_cycles_window check (closes_at > opens_at);
  end if;
end $$;

create index if not exists botm_cycles_period_idx on public.botm_cycles (period desc);

alter table public.botm_cycles enable row level security;

-- Grants BEFORE policies: a new table is born with `grant all` to anon AND authenticated,
-- so a narrow grant written afterwards is an additive no-op. This project has been bitten
-- by that four times. Revoke by NAME — revoking from `public` does not touch a grant made
-- to anon/authenticated.
revoke all on public.botm_cycles from public, anon, authenticated;
grant select on public.botm_cycles to authenticated;

drop policy if exists botm_cycles_member_read on public.botm_cycles;
create policy botm_cycles_member_read on public.botm_cycles
  for select using (public.is_approved_brother() or public.is_admin());

-- No INSERT/UPDATE/DELETE policy and no grant: cycles are opened by the cron and settled
-- by crown_botm(). Nothing signed in writes this table directly.

-- ═══ 2) The votes ════════════════════════════════════════════════════════════════════
create table if not exists public.botm_votes (
  cycle_id   uuid not null references public.botm_cycles(id) on delete cascade,
  voter_user uuid not null,
  brother_id uuid not null references public.brothers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cycle_id, voter_user)          -- one vote each; changing it is an UPDATE
);

comment on table public.botm_votes is
  'Who voted for whom. PRIVILEGED: the voter sees his own row, the admin and an officer '
  'holding spotlight.manage see all, nobody else sees any. Brothers read percentages from '
  'the botm_tally view instead (upgrade67).';

create index if not exists botm_votes_cycle_idx on public.botm_votes (cycle_id, brother_id);

-- brother_id cascades but voter_user did not, so deleting an account left an orphan ballot
-- that still counted toward the result. Guarded because ADD CONSTRAINT has no IF NOT EXISTS.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'botm_votes_voter_fk') then
    alter table public.botm_votes
      add constraint botm_votes_voter_fk
      foreign key (voter_user) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table public.botm_votes enable row level security;

revoke all on public.botm_votes from public, anon, authenticated;
-- SELECT only. The write path is cast_botm_vote() and nothing else.
grant select on public.botm_votes to authenticated;

drop policy if exists botm_votes_read on public.botm_votes;
create policy botm_votes_read on public.botm_votes
  for select using (
    voter_user = auth.uid()
    or public.is_admin()
    or public.officer_can('spotlight.manage')
  );

-- ═══ 3) The tally a brother may see ══════════════════════════════════════════════════
-- Aggregates only. There is no shape of query against this view that names a voter.
drop view if exists public.botm_tally;
create view public.botm_tally as
  select v.cycle_id,
         v.brother_id,
         count(*)::int as votes,
         round(100.0 * count(*) / nullif(sum(count(*)) over (partition by v.cycle_id), 0), 1) as pct
    from public.botm_votes v
   -- The view runs with its OWNER's rights, so THIS is the only gate on it. Same shape as
   -- fund_totals and the roster views.
   where public.is_approved_brother() or public.is_admin()
   group by v.cycle_id, v.brother_id;

-- A view is a relation, so it was just granted `all` to both roles by Supabase's defaults
-- — the exact hole upgrade62 closed on the roster views, and drop+create re-applies those
-- defaults on every run of this file.
revoke all on public.botm_tally from public, anon, authenticated;
grant select on public.botm_tally to authenticated;

-- ═══ 4) Casting a vote ═══════════════════════════════════════════════════════════════
create or replace function public.cast_botm_vote(p_brother uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c        record;
  is_self  boolean;
begin
  if not public.is_approved_brother() then
    raise exception 'only an approved brother can vote';
  end if;

  select * into c from public.botm_cycles
   where winner_brother is null and now() >= opens_at and now() < closes_at
   order by period asc limit 1;
  if c.id is null then
    raise exception 'voting is not open';
  end if;

  -- The candidate must be a real, verified brother WITH an account — the owner's chosen
  -- pool. A man with no account cannot be told he won or shown as a card.
  if not exists (
    select 1 from public.brothers b
     where b.id = p_brother and b.status = 'verified' and b.user_id is not null
  ) then
    raise exception 'that brother is not eligible';
  end if;

  -- No voting for yourself. Deliberate: in a three-vote race self-nomination decides it.
  select (b.user_id = auth.uid()) into is_self from public.brothers b where b.id = p_brother;
  if coalesce(is_self, false) then
    raise exception 'you cannot vote for yourself';
  end if;

  insert into public.botm_votes (cycle_id, voter_user, brother_id)
  values (c.id, auth.uid(), p_brother)
  on conflict (cycle_id, voter_user)
  do update set brother_id = excluded.brother_id, updated_at = now();

  return 'ok';
end $$;

revoke all on function public.cast_botm_vote(uuid) from public, anon;
grant execute on function public.cast_botm_vote(uuid) to authenticated;

-- ═══ 5) Crowning by hand ═════════════════════════════════════════════════════════════
-- WHICH month may be crowned is as much a permission as who may crown. The first cut
-- checked only the caller and then updated by id, which allowed two things the permission
-- description never promised, both reproduced against the live database before this fix:
--   • crowning a month that was still OPEN — cast_botm_vote() selects on
--     `winner_brother is null`, so the instant a winner exists every brother gets
--     "voting is not open" and the homepage panel simply vanishes mid-month; and
--   • silently re-crowning a settled month, overwriting who won with no record of what it
--     used to say.
-- So: a month must be CLOSED and UNSETTLED to be crowned. Overturning a settled month is
-- still possible, but it is p_force and it is the webmaster's alone.
drop function if exists public.crown_botm(uuid, uuid);
create or replace function public.crown_botm(p_cycle uuid, p_brother uuid, p_force boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare is_adm boolean := public.is_admin();
begin
  if not (is_adm or public.officer_can('spotlight.manage')) then
    raise exception 'not allowed';
  end if;
  if p_force and not is_adm then
    raise exception 'only the webmaster can overturn a settled month';
  end if;
  if not exists (
    select 1 from public.brothers b
     where b.id = p_brother and b.status = 'verified' and b.user_id is not null
  ) then
    raise exception 'that brother is not eligible';
  end if;

  update public.botm_cycles
     set winner_brother = p_brother,
         -- Recorded as the OFFICER's decision when it is his. Hardcoding 'admin' made his
         -- crown indistinguishable from the webmaster's in the Past winners table.
         winner_source  = case when is_adm then 'admin' else 'officer' end,
         crowned_at     = now(),
         crowned_by     = auth.uid()
   where id = p_cycle
     and (p_force or (winner_brother is null and closes_at <= now()));
  if not found then
    raise exception 'that month is either still open for voting or already settled';
  end if;

  return 'ok';
end $$;

revoke all on function public.crown_botm(uuid, uuid, boolean) from public, anon;
grant execute on function public.crown_botm(uuid, uuid, boolean) to authenticated;

-- ═══ 6) Resolving a closed cycle nobody got round to ═════════════════════════════════
-- Claim-and-stamp with a RE-CHECK UNDER THE ROW LOCK. Without the re-check, a retry (or
-- two cron runs racing) crowns twice, or worse, overwrites a winner the owner chose in the
-- gap between the scan and the write. This is the identical bug that had to be fixed in
-- claim_event_reminders, so it is written correctly the first time here.
-- NOTE ON THE OUT PARAMETER NAMES. They are prefixed out_* on purpose. plpgsql substitutes
-- declared names into SQL text, so an OUT parameter called `period` would be spliced into
-- `order by period` below and shadow the COLUMN — Postgres raises "column reference is
-- ambiguous" and the function dies at runtime, not at create time. Any name here that
-- matches a botm_cycles column is a landmine.
create or replace function public.resolve_botm_cycles()
returns table (out_cycle uuid, out_period date, out_winner uuid, out_source text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c        record;
  top      int;
  tied     uuid[];
  n_tied   int;
  pick     uuid;
  src      text;
begin
  for c in
    select id from public.botm_cycles
     where closes_at <= now() and winner_brother is null
     order by period asc
     for update
  loop
    -- THE RE-CHECK. Re-read under the lock we now hold: the owner may have crowned this
    -- cycle by hand a moment ago, and an automatic pick must never override a human one.
    perform 1 from public.botm_cycles
      where id = c.id and winner_brother is null;
    if not found then continue; end if;

    -- Count only votes for brothers who are STILL verified and still have an account —
    -- crowning a deleted or demoted man would put a broken card on the homepage. One pass:
    -- the top score and everyone holding it.
    with counted as (
      select v.brother_id, count(*)::int as n
        from public.botm_votes v
        join public.brothers b  on b.id = v.brother_id       -- the CANDIDATE still counts
        join public.brothers vb on vb.user_id = v.voter_user -- …and so must the VOTER
       where v.cycle_id = c.id
         and b.status = 'verified' and b.user_id is not null
         and vb.status = 'verified'
       group by v.brother_id
    ), best as (
      select max(n) as top from counted
    )
    select best.top, array_agg(counted.brother_id)
      into top, tied
      from counted, best
     where counted.n = best.top
     group by best.top;

    if top is null then
      continue;                       -- nobody voted: crown nobody, last month's man stays
    end if;

    -- The coin flip. Indexing a random position is uniform however array_agg ordered them.
    -- Decided ONCE and written down: because the winner is stored, a later re-run reads the
    -- stored value and cannot re-flip.
    n_tied := coalesce(array_length(tied, 1), 0);
    pick   := tied[1 + floor(random() * n_tied)::int];
    src    := case when n_tied > 1 then 'auto_tiebreak' else 'auto' end;

    update public.botm_cycles
       set winner_brother = pick, winner_source = src, crowned_at = now()
     where id = c.id;

    out_cycle  := c.id;
    out_winner := pick;
    out_source := src;
    select bc.period into out_period from public.botm_cycles bc where bc.id = c.id;
    return next;
  end loop;
end $$;

-- Service role only: this settles a chapter-wide award without a human in the loop.
-- Nothing signed in as a brother — or as the admin in a browser — should reach it.
revoke all on function public.resolve_botm_cycles() from public, anon, authenticated;
grant execute on function public.resolve_botm_cycles() to service_role;

-- ═══ 7) Opening the next cycle ═══════════════════════════════════════════════════════
create or replace function public.ensure_botm_cycle()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p_open  timestamptz := date_trunc('month', now());
  p_close timestamptz := date_trunc('month', now()) + interval '1 month';
  p_per   date        := (date_trunc('month', now()) + interval '1 month')::date;
  v_id    uuid;
begin
  insert into public.botm_cycles (period, opens_at, closes_at)
  values (p_per, p_open, p_close)
  on conflict (period) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.botm_cycles where period = p_per;
  end if;
  return v_id;
end $$;

revoke all on function public.ensure_botm_cycle() from public, anon, authenticated;
grant execute on function public.ensure_botm_cycle() to service_role;

-- ═══ 8) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare bad text; n int;
begin
  -- (a) anon holds nothing anywhere. These rows are a popularity vote among named men.
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad from (
    select table_name, privilege_type from information_schema.table_privileges
     where table_schema = 'public' and grantee = 'anon'
       and table_name in ('botm_cycles', 'botm_votes', 'botm_tally')
    union all
    select table_name, privilege_type from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'anon'
       and table_name in ('botm_cycles', 'botm_votes', 'botm_tally')
  ) x;
  if bad is not null then
    raise exception 'anon holds % — the vote is members-only', bad;
  end if;

  -- (b) A brother cannot write votes directly. The whole self-vote / one-per-cycle /
  --     cycle-open ruleset lives in cast_botm_vote(); a direct grant would bypass all of it.
  select string_agg(distinct privilege_type, ', ') into bad from (
    select privilege_type from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'botm_votes' and grantee = 'authenticated'
    union all
    -- Column grants live in a DIFFERENT catalog. Omitting this let a future
    -- `grant insert (brother_id) on botm_votes to authenticated` pass every check here.
    select privilege_type from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'botm_votes' and grantee = 'authenticated'
  ) x where privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'botm_votes: authenticated holds % — votes must go through cast_botm_vote()', bad;
  end if;

  -- (c) …and cannot write cycles either, or he could reopen a settled month.
  select string_agg(distinct privilege_type, ', ') into bad from (
    select privilege_type from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'botm_cycles' and grantee = 'authenticated'
    union all
    -- Column grants live in a DIFFERENT catalog. Omitting this let a future
    -- `grant insert (brother_id) on botm_votes to authenticated` pass every check here.
    select privilege_type from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'botm_cycles' and grantee = 'authenticated'
  ) x where privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'botm_cycles: authenticated holds % — a brother could crown himself', bad;
  end if;

  -- (d) The tally view is READ-ONLY and still readable. upgrade62's lesson: a view is
  --     granted `all` on creation and drop+create re-applies it every run.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'botm_tally'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'botm_tally is writeable (%) — a projection view must be read-only', bad;
  end if;
  if not has_table_privilege('authenticated', 'public.botm_tally', 'SELECT') then
    raise exception 'authenticated lost SELECT on botm_tally — the vote panel would go blank';
  end if;

  -- (e) The view names no voter, now or after a later edit. This is the privacy promise.
  select string_agg(column_name, ', ') into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'botm_tally'
     and column_name not in ('cycle_id', 'brother_id', 'votes', 'pct');
  if bad is not null then
    raise exception 'botm_tally grew column(s) % — it must never identify a voter', bad;
  end if;

  -- (f) The read policy on the votes actually restricts. If someone widens it to
  --     is_approved_brother(), every brother sees the whole ballot.
  select qual into bad from pg_policies
   where tablename = 'botm_votes' and policyname = 'botm_votes_read';
  if bad is null or bad not like '%auth.uid()%' then
    raise exception 'botm_votes_read no longer restricts by voter — the ballot would be public';
  end if;

  -- (g) The auto-resolver keeps its re-check. Losing this line is how a retry overrides a
  --     winner the owner picked by hand — silently, and only in production.
  if pg_get_functiondef('public.resolve_botm_cycles()'::regprocedure) not like '%and winner_brother is null%' then
    raise exception 'resolve_botm_cycles lost its re-check under the lock — it could override a human crown';
  end if;

  -- (h) Only service_role may settle an award unattended.
  if has_function_privilege('authenticated', 'public.resolve_botm_cycles()', 'EXECUTE') then
    raise exception 'authenticated can execute resolve_botm_cycles — a brother could settle the month';
  end if;

  -- (i) The winner columns move together. A winner with no source (or the reverse) makes
  --     "who decided this" unanswerable, which is the whole point of recording it.
  begin
    insert into public.botm_cycles (period, closes_at, winner_brother)
    values ('1900-01-01', now() + interval '1 day', gen_random_uuid());
    raise exception 'a winner with no winner_source was accepted — the pairing CHECK is not working';
  exception
    when check_violation then null;      -- expected
    when foreign_key_violation then null; -- also fine: the FK caught it first
  end;
end $$;

notify pgrst, 'reload schema';
