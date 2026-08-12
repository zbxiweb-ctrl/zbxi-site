-- upgrade55.sql — "I'm open to…" becomes Mentor / Mentee / Connecting.
--
-- THE CHANGE. Three flags, not three-plus-a-fourth-meaning: `hire` folds into `mentor`.
-- Both said the same thing from the volunteer's side — "I will help someone" — and splitting
-- them meant a brother had to decide whether an introduction counted as mentoring or as a
-- referral before he could raise his hand. 25 brothers hold mentor-or-hire today (not 42:
-- most who ticked one ticked both), so the fold loses nobody and duplicates nobody.
--
-- `mentee` is NEW and starts empty on purpose. It is the other half of a page that until now
-- only had volunteers on it and no way to say you were looking. Opt-in only — nobody is
-- enrolled by this migration, and the Mentees card ships as an invitation rather than a list.
--
-- ── WHY A CHECK CONSTRAINT NOW AND NOT BEFORE ────────────────────────────────────────
-- open_to is a bare text[] with no constraint, and its labels were being re-typed from
-- scratch in FIVE separate files (portal.js, profile-card.js, mentor-page.js,
-- brothers-page.js, main.js) plus the digest. That is exactly how a set of values drifts.
-- This push gives the browser one shared OPEN_TO list; the constraint is the same rule
-- written where it cannot be bypassed by a future writer. The admin console gains an
-- open_to writer in the next push, which is the second writer this protects.
--
-- ── THE NULL TRAP, AVOIDED DELIBERATELY ──────────────────────────────────────────────
-- `open_to <@ array[...]` would be NULL for a NULL open_to, and a CHECK that evaluates to
-- NULL PASSES. That is not theoretical here: it is the exact defect shipped once already in
-- MatRun, where the test suite written for it could not see it. coalesce() first, so the
-- constraint has an opinion about every row.

-- ═══ 1) Fold hire into mentor ════════════════════════════════════════════════════════
-- array_replace alone would leave {mentor,mentor} on anyone who ticked both, so the result
-- is rebuilt distinct. Sorted too, so the stored order stops depending on tick order and
-- two identical intents compare equal.
update public.brothers
   set open_to = coalesce((
         select array_agg(distinct v order by v)
           from unnest(array_replace(open_to, 'hire', 'mentor')) v
       ), '{}'::text[])
 where open_to @> array['hire'];

-- ═══ 2) The canonical set, enforced ══════════════════════════════════════════════════
alter table public.brothers drop constraint if exists brothers_open_to_valid;
alter table public.brothers add constraint brothers_open_to_valid
  check (coalesce(open_to, '{}'::text[]) <@ array['mentor', 'mentee', 'connect']::text[]);

comment on constraint brothers_open_to_valid on public.brothers is
  'open_to is the Mentoring page''s only filter, so a typo here silently hides a brother '
  'rather than erroring. The browser''s shared OPEN_TO list is the same three keys.';

-- ═══ 3) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare
  n int;
  bad text;
begin
  -- (a) No 'hire' survived anywhere.
  select count(*) into n from public.brothers where open_to @> array['hire'];
  if n <> 0 then
    raise exception '% brothers still hold the retired ''hire'' flag', n;
  end if;

  -- (b) The fold did not empty the page. Deliberately a floor, not an exact number: an
  --     exact count would make this migration fail the day the roster changes, and it is
  --     re-runnable by design.
  select count(*) into n from public.brothers
   where status = 'verified' and open_to @> array['mentor'];
  if n = 0 then
    raise exception 'no verified brother is open to mentoring — the fold lost everyone';
  end if;

  -- (c) No duplicates were created by the fold — {mentor,mentor} is what array_replace
  --     produces unguarded for anyone who ticked both.
  --     coalesce() on BOTH sides is required: array_length('{}', 1) is NULL, not 0, while
  --     count() over zero rows is 0 — so the naive form flags every brother with no flags
  --     at all as a duplicate. It did, on the first run: 328 false positives.
  select string_agg(id::text, ', ') into bad
    from public.brothers
   where coalesce(array_length(open_to, 1), 0) is distinct from (
         select count(distinct v)::int from unnest(coalesce(open_to, '{}'::text[])) v);
  if bad is not null then
    raise exception 'open_to holds duplicates on: %', bad;
  end if;

  -- (d) The constraint exists AND actually refuses a bad value. A constraint that is
  --     present but toothless is worse than none, because it invites trust.
  begin
    update public.brothers set open_to = array['not_a_real_flag']
     where id = (select id from public.brothers limit 1);
    raise exception 'brothers_open_to_valid did not reject an invalid flag';
  exception
    when check_violation then null;   -- expected
  end;

  -- (e) …and still admits all three keys the browser writes. Catches the failure where a
  --     later migration narrows the canon and silently makes one checkbox unsavable —
  --     which would surface as a brother's tick "not sticking", not as an error anyone sees.
  select pg_get_constraintdef(oid) into bad
    from pg_constraint
   where conrelid = 'public.brothers'::regclass and conname = 'brothers_open_to_valid';
  if bad is null then
    raise exception 'brothers_open_to_valid is missing';
  end if;
  if bad not like '%mentor%' or bad not like '%mentee%' or bad not like '%connect%' then
    raise exception 'the open_to canon lost a key: %', bad;
  end if;
  -- The coalesce is load-bearing, not stylistic: without it a NULL open_to makes the CHECK
  -- evaluate to NULL, and a NULL CHECK PASSES. Same defect already shipped once in MatRun.
  if bad not like '%COALESCE%' and bad not like '%coalesce%' then
    raise exception 'brothers_open_to_valid is not NULL-safe — a NULL open_to would bypass it: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
