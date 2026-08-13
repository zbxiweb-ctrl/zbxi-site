-- upgrade66.sql — the Alumni Fund gets a goal, a progress bar and a thank-you.
--
-- THE PROBLEM. The fund page is a Venmo handle and a well-written case for giving, with no
-- target, no progress and no acknowledgment — the three things that actually make people
-- give, and give again next year. Nothing on this site has ever recorded that a single gift
-- was made.
--
-- ── MONEY DOES NOT MOVE THROUGH THIS SITE, AND MUST NOT START ────────────────────────
-- Venmo stays. The moment a card is processed here, the legal and security picture changes
-- completely — PCI scope, chargebacks, refunds, and a volunteer webmaster holding all of it.
-- The treasurer types gifts in by hand; at this chapter's size that is minutes a month.
-- Nothing below accepts a payment, stores a card, or talks to a payment processor.
--
-- ── WHO CAN SEE WHAT, AND WHY IT IS SPLIT ────────────────────────────────────────────
-- A progress bar must never become a list of who gave what. So:
--   • fund_gifts (the individual rows, with amounts) — ADMIN ONLY, at both layers.
--   • fund_totals (a view: the sum, the counts, and the names of men who OPTED IN) —
--     readable by any approved brother.
-- The page reads the view. It is not possible to get an amount out of it, for anybody.
--
-- ── AMOUNTS ARE INTEGER CENTS ────────────────────────────────────────────────────────
-- Never a float. $19.99 is not representable in binary floating point, and a fund that is
-- three cents out after a hundred gifts is a fund nobody trusts.
--
-- Idempotent: safe to re-run.

-- ═══ 1) The gifts ════════════════════════════════════════════════════════════════════
create table if not exists public.fund_gifts (
  id           uuid primary key default gen_random_uuid(),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  given_on     date    not null default current_date,
  brother_id   uuid references public.brothers(id) on delete set null,
  display_name text,                                  -- how he should appear, if he opted in
  show_name    boolean not null default false,        -- OPT-IN. Silence is not consent.
  note         text,                                  -- private to the console
  thanked_at   timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.fund_gifts is
  'Gifts to the Alumni Fund, entered by hand by the webmaster — money moves through Venmo, '
  'never through this site. ADMIN-ONLY: brothers see only the totals view (upgrade66).';
comment on column public.fund_gifts.show_name is
  'Did he agree to be named on the page? Defaults FALSE — an honour roll must be opt-in, and '
  'silence is not consent.';

create index if not exists fund_gifts_given_idx on public.fund_gifts (given_on desc);

alter table public.fund_gifts enable row level security;

-- Grants BEFORE policies: a new table is born with `grant all` to anon AND authenticated,
-- so a narrow grant written afterwards is an additive no-op. anon gets nothing at all —
-- not even SELECT, because these rows are amounts of money against named men.
revoke all on public.fund_gifts from public, anon, authenticated;
grant select, insert, update, delete on public.fund_gifts to authenticated;

-- The ADMIN is `authenticated` too (admin is a JWT-email check, not a Postgres role), so
-- the grant above is what lets his console work; these policies are what make it his alone.
drop policy if exists fund_gifts_admin_read on public.fund_gifts;
create policy fund_gifts_admin_read on public.fund_gifts
  for select using (public.is_admin());

drop policy if exists fund_gifts_admin_write on public.fund_gifts;
create policy fund_gifts_admin_write on public.fund_gifts
  for all using (public.is_admin()) with check (public.is_admin());

-- ═══ 2) The goal ═════════════════════════════════════════════════════════════════════
-- On the existing single-row donations config, so the page reads one thing.
alter table public.donations add column if not exists goal_cents     integer
  check (goal_cents is null or (goal_cents > 0 and goal_cents <= 100000000));
alter table public.donations add column if not exists goal_label     text;
alter table public.donations add column if not exists goal_starts_on date;

comment on column public.donations.goal_starts_on is
  'Gifts on or after this date count toward the current goal, so a new drive resets the bar '
  'without deleting last year''s record. NULL = count everything (upgrade66).';

-- THE LINE THAT WOULD ONLY FAIL ON THE LIVE SITE. donations has a COLUMN-LIST update grant
-- (upgrade52); a column added afterwards is not writable until it is named, so saving a goal
-- would 42501 for the admin and for nobody else — invisible in any migration test.
grant update (goal_cents, goal_label, goal_starts_on) on public.donations to authenticated;

-- ═══ 3) The totals a brother may see ═════════════════════════════════════════════════
-- Aggregates only. There is no shape of query against this view that yields one man's gift.
-- The names are those who opted in, and they carry NO amounts beside them.
--
-- ── AND WHY THE TOTAL IS ROUNDED ─────────────────────────────────────────────────────
-- Found by security review, and it is the interesting one. No single query gets a gift out
-- of this view — but a brother who reads it on Monday and again on Friday sees the total
-- rise by exactly one gift, and a new name in the honour roll in the same window tells him
-- whose it was. Gifts arrive a few a month, one at a time, which makes those windows
-- CLEANER, not noisier. The men exposed would be exactly the ones who agreed to be NAMED —
-- they did not agree to have their amount published.
--
-- So the published total is rounded to the nearest $100, turning an exact figure into a
-- band, and gift_count is gone (the page never used it — one more live counter is one more
-- way to difference the same event). This narrows the channel rather than sealing it:
-- sealing it means not publishing a live named roll beside a live total at all, which is
-- the feature. A ±$100 band on a progress bar costs the reader nothing.
drop view if exists public.fund_totals;
create view public.fund_totals as
  select
    (round(coalesce(sum(g.amount_cents), 0) / 10000.0) * 10000)::bigint as raised_cents,
    count(distinct coalesce(g.brother_id::text, nullif(btrim(g.display_name), ''), g.id::text))::int
                                             as giver_count,
    coalesce(
      array_agg(distinct btrim(g.display_name))
        filter (where g.show_name and coalesce(btrim(g.display_name), '') <> ''),
      '{}'::text[]
    ) as honour_roll
  from public.donations d
  left join public.fund_gifts g
    on (d.goal_starts_on is null or g.given_on >= d.goal_starts_on)
  where d.id = 1
    -- The view runs with its OWNER's rights, so THIS is the only gate on it. Same shape as
    -- roster_detail and member_directory.
    and (public.is_approved_brother() or public.is_admin());

-- A view is a relation, so it was just granted `all` to both roles by Supabase's defaults —
-- the exact hole upgrade62 closed on the three roster views. Revoke by NAME (revoking from
-- `public` is a no-op against a grant made to anon/authenticated), then grant only SELECT.
revoke all on public.fund_totals from public, anon, authenticated;
grant select on public.fund_totals to authenticated;

-- ═══ 4) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare bad text; n int;
begin
  -- (a) anon cannot touch the gifts in any way.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'fund_gifts' and grantee = 'anon';
  if bad is not null then
    raise exception 'fund_gifts: anon holds % — these rows are money against named men', bad;
  end if;

  -- (b) …nor read the totals view.
  if has_table_privilege('anon', 'public.fund_totals', 'SELECT') then
    raise exception 'anon can read fund_totals — the fund page is members-only';
  end if;

  -- (c) The totals view is READ-ONLY. upgrade62's lesson: a view is granted `all` on
  --     creation, and drop+create re-applies those defaults every time this file runs.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'fund_totals'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'fund_totals is writeable (%) — a projection view must be read-only', bad;
  end if;

  -- (d) …and still readable, or the fund page goes blank.
  if not has_table_privilege('authenticated', 'public.fund_totals', 'SELECT') then
    raise exception 'authenticated lost SELECT on fund_totals — the progress bar would vanish';
  end if;

  -- (e) The admin can actually save a goal. Adding a column to a table whose UPDATE grant
  --     is a column list does NOT make it writable (upgrade52 set that list).
  if not has_column_privilege('authenticated', 'public.donations', 'goal_cents', 'UPDATE') then
    raise exception 'the goal cannot be saved — goal_cents is missing from the donations UPDATE grant';
  end if;

  -- (f) Money is integer cents, and bounded. A float would drift; an unbounded value lets a
  --     typo render a progress bar in the billions.
  if (select data_type from information_schema.columns
       where table_schema='public' and table_name='fund_gifts' and column_name='amount_cents') <> 'integer' then
    raise exception 'fund_gifts.amount_cents is not an integer — money must never be a float';
  end if;
  begin
    insert into public.fund_gifts (amount_cents) values (0);
    raise exception 'a gift of zero was accepted — the amount CHECK is not doing its job';
  exception when check_violation then null;
  end;
  begin
    insert into public.fund_gifts (amount_cents) values (-500);
    raise exception 'a NEGATIVE gift was accepted — it would subtract from the total';
  exception when check_violation then null;
  end;

  -- (g) The honour roll is opt-in by default. This is a consent question, not a display one.
  if (select column_default from information_schema.columns
       where table_schema='public' and table_name='fund_gifts' and column_name='show_name') not ilike '%false%' then
    raise exception 'show_name does not default to false — being named must be opt-in';
  end if;

  -- (h) The view exposes no per-gift amount. If a later edit adds one, the page becomes a
  --     list of who gave what.
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='fund_totals'
     and column_name not in ('raised_cents', 'giver_count', 'honour_roll');
  if n <> 0 then
    raise exception 'fund_totals grew % unexpected column(s) — it must stay aggregates + opt-in names', n;
  end if;

  -- (i) The total stays ROUNDED. Publishing the exact figure beside a live named roll lets
  --     a brother difference two readings and learn one man's gift to the cent.
  if pg_get_viewdef('public.fund_totals'::regclass) not ilike '%round(%' then
    raise exception 'fund_totals publishes an exact total again — two readings would reveal one gift';
  end if;
  -- …and gift_count stays gone: it is a second live counter over the same event.
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='fund_totals' and column_name='gift_count') then
    raise exception 'fund_totals grew gift_count back — it makes the total differenceable';
  end if;
end $$;

notify pgrst, 'reload schema';
