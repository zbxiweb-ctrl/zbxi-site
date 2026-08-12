-- upgrade64.sql — one column, so "not now" means not now on every device.
--
-- THE PROBLEM THIS SERVES. Two finished features on this site are starving for data rather
-- than for code. The Worldwide Map plots only brothers who filled in a city — 305 of the 359
-- verified brothers have none. The Mentoring page lists 25 mentors out of 359. Nobody is
-- going to open the profile editor to fix that.
--
-- So the site asks ONE question, once, on whatever page he is already on, with one field and
-- one tap. The answer writes through the profile row that already exists — no second save
-- path, no second source of truth.
--
-- ── WHY THE DISMISSAL LIVES IN THE DATABASE ──────────────────────────────────────────
-- "Never asked twice" has to survive a second device, and a browser cannot do that: dismiss
-- it on a laptop and localStorage would ask again on the phone that evening. That is the
-- difference between a nudge and a nag, and it is worth one column.
--
-- Answering the question needs nothing here — filling in the city IS the dismissal, because
-- the nudge only ever asks about a field that is still empty.
--
-- Idempotent: safe to re-run.

alter table public.brothers
  add column if not exists nudge_dismissed_at timestamptz;

comment on column public.brothers.nudge_dismissed_at is
  'When this brother last pressed "not now" on the one-question profile nudge. NULL = never '
  'asked, or never dismissed. The nudge stays quiet for 60 days after it is set (upgrade64).';

-- ═══ Assertions ══════════════════════════════════════════════════════════════════════
do $$
declare n int;
begin
  -- (a) A brother can actually dismiss it. He writes his OWN row through the same policy
  --     that already lets him edit his profile; if a future migration narrows brothers'
  --     UPDATE to a column list, this one has to be on it or "not now" silently does
  --     nothing and the card comes back forever.
  if not has_column_privilege('authenticated', 'public.brothers', 'nudge_dismissed_at', 'UPDATE') then
    raise exception 'authenticated cannot write nudge_dismissed_at — "not now" would never stick';
  end if;

  -- (b) It is not a status column in disguise. tg_guard_status pins status/role/user_id for
  --     a non-admin; this column is deliberately NOT pinned, because the brother himself is
  --     the only one who ever sets it. Assert the guard was not extended to cover it, which
  --     would silently break the dismissal.
  select count(*) into n
    from pg_proc p
   where p.proname = 'tg_guard_status'
     and pg_get_functiondef(p.oid) ilike '%nudge_dismissed_at%';
  if n <> 0 then
    raise exception 'tg_guard_status now pins nudge_dismissed_at — a brother could not dismiss the nudge';
  end if;
end $$;

notify pgrst, 'reload schema';
