-- upgrade32.sql — Housekeeping (off-desktop review follow-ups, 2026-07-24).
--
-- (A) Log retention. notifications + activity_log grow unbounded. A weekly pg_cron
--     job prunes old rows: notifications after 90 days (ephemeral bell items),
--     activity_log after 365 days (kept a full year as an audit trail). The prune
--     fn is SECURITY DEFINER with a pinned search_path, and EXECUTE is revoked from
--     everyone but the owner, so ONLY the cron job (runs as postgres) can trigger it
--     — a brother can never call it to wipe the logs.
--
-- Two one-off DATA corrections were also applied out-of-band (data, not schema, so
-- not re-runnable from here) and are recorded here for the handoff log:
--   (B) Cleared the leftover placeholder site_settings 'announcement' (was
--       {text:'Test'}, already inactive) to empty + inactive.
--   (C) Scoped a former President (brothers.user_id f1408f2c-acc9-48c5-9222-ca5d87ff5cd5)
--       from role_scope NULL to 'previous', so he is not ambiguously near the
--       alumni-president seat and is correctly listed under "previous officers".

create or replace function public.prune_old_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications where created_at < now() - interval '90 days';
  delete from public.activity_log  where created_at < now() - interval '365 days';
$$;

-- Only the owner (postgres, which the cron job runs as) may execute it.
revoke all on function public.prune_old_logs() from public, anon, authenticated;

-- Weekly, Sundays 04:00 UTC. Idempotent: drop any prior copy of the job first.
select cron.unschedule(jobid) from cron.job where jobname = 'zbxi-prune-logs';
select cron.schedule('zbxi-prune-logs', '0 4 * * 0', $$select public.prune_old_logs()$$);
