-- upgrade59.sql — a Connect request and a mentor request reach a brother by EMAIL,
-- not only by a bell he has to be logged in to see.
--
-- THE PROBLEM. Both features work and both are silent. Pressing 🤝 Connect on a brother's
-- card writes a notification; being matched to a mentor request writes a notification. If
-- that brother does not log in, he never learns anyone reached out — and 246 of the 359
-- brothers on the roster have no account at all, while most of the rest log in rarely. The
-- ask lands in a room nobody is standing in.
--
-- ── SHAPE, AND WHY IT IS NOT AN RPC CHANGE ───────────────────────────────────────────
-- The obvious move — make connect_request() send the mail itself — is wrong here. A
-- database function cannot render the chapter's email template, cannot reach the mail
-- provider, and would make a brother's click wait on a third party. Instead this adds a
-- CLAIM verb in the same shape as claim_pending_alerts/claim_email_batch: an edge function
-- asks for what still needs mailing, gets it stamped in the same statement, renders it in
-- TypeScript beside the other templates, and hands it to the existing queue.
--
-- ── STAMP-ON-CLAIM, NOT STAMP-ON-SEND ────────────────────────────────────────────────
-- emailed_at is set by the same UPDATE that returns the row. A crash after claiming loses
-- one notification's email; a crash between "send" and "mark sent" would send it again on
-- every run forever. Losing one is the better failure, and the bell still has it.
--
-- ── THE BACKFILL IS THE SAFETY ───────────────────────────────────────────────────────
-- Section 2 marks every notification that ALREADY EXISTS as emailed. Without it the first
-- run would mail out a backlog of requests from weeks ago — to people who have long since
-- seen the bell, about asks that may no longer stand. Nobody wants an inbox full of
-- history. Only requests made from now on are mailed.

-- ═══ 1) The column ═══════════════════════════════════════════════════════════════════
alter table public.notifications
  add column if not exists emailed_at timestamptz;

comment on column public.notifications.emailed_at is
  'When this notification was handed to the email queue. NULL = still to be mailed. '
  'Stamped by claim_notify_mail() at claim time, not at send time (upgrade59).';

-- Partial index: the claim only ever looks for the unstamped few, and this keeps that
-- lookup off the full notifications table as it grows.
create index if not exists notifications_unmailed_idx
  on public.notifications (created_at)
  where emailed_at is null;

-- ═══ 2) Everything that exists today counts as already handled ═══════════════════════
update public.notifications
   set emailed_at = now()
 where emailed_at is null;

-- ═══ 3) The claim verb ═══════════════════════════════════════════════════════════════
-- Returns only what should actually be mailed, and stamps it in the same statement.
--
-- WHO IS SKIPPED, and why each one:
--   • a brother who opted out of email      — his choice; the bell still tells him
--   • a brother with no address on file     — nothing to send to
--   • anything older than 2 days            — a queue backed up that long means something
--                                             was broken; mailing stale asks is worse than
--                                             dropping them, and the bell already has them
--   • kinds other than these two            — likes and comments are not worth an email
create or replace function public.claim_notify_mail(p_limit int default 50)
returns table (
  id           uuid,
  kind         text,
  payload      jsonb,
  to_email     text,
  unsub_token  text,
  to_name      text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select n.id
      from public.notifications n
      join public.brothers b
        on b.user_id = n.recipient
       and b.status = 'verified'
     where n.emailed_at is null
       and n.kind in ('connect_request', 'mentor_request')
       and n.created_at > now() - interval '2 days'
       and coalesce(b.email_opt_out, false) = false
       and coalesce(btrim(b.email), '') <> ''
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ),
  claimed as (
    update public.notifications n
       set emailed_at = now()
      from due
     where n.id = due.id
     returning n.id, n.kind, n.payload, n.recipient
  )
  select c.id, c.kind, c.payload,
         b.email::text,
         b.unsubscribe_token::text,
         coalesce(b.roster_name, b.full_name)::text
    from claimed c
    join public.brothers b on b.user_id = c.recipient;
end;
$$;

-- Service role only. This returns brothers' EMAIL ADDRESSES; nothing signed in as a
-- brother — or as the admin in a browser — has any business calling it.
revoke all on function public.claim_notify_mail(int) from public, anon, authenticated;
grant execute on function public.claim_notify_mail(int) to service_role;

-- ═══ 4) A new kind of email needs its own label ══════════════════════════════════════
-- email_batches.kind was CHECKed to ('digest','compose','invite'). The first end-to-end
-- run failed on it with a 23514, which is the constraint doing its job: this really is a
-- fourth kind of email, not one of those three wearing a different hat. Borrowing
-- 'compose' would have made every later count of "emails the webmaster sent" wrong.
alter table public.email_batches drop constraint if exists email_batches_kind_check;
alter table public.email_batches add constraint email_batches_kind_check
  check (kind = any (array['digest', 'compose', 'invite', 'notify']));

-- ═══ 5) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare n int; bad text;
begin
  -- (a) Nothing pre-existing is left unstamped — the backlog guard.
  select count(*) into n from public.notifications where emailed_at is null;
  if n <> 0 then
    raise exception '% notifications are unstamped after the backfill — the first run would mail a backlog', n;
  end if;

  -- (b) The address-returning verb is service_role only. This is the whole disclosure
  --     question: it hands out email addresses.
  select string_agg(g, ', ') into bad from (
    select unnest(array['anon','authenticated','public']) as g
  ) x where has_function_privilege(x.g, 'public.claim_notify_mail(int)', 'execute');
  if bad is not null then
    raise exception 'claim_notify_mail is executable by % — it returns email addresses', bad;
  end if;
  if not has_function_privilege('service_role', 'public.claim_notify_mail(int)', 'execute') then
    raise exception 'service_role cannot execute claim_notify_mail — the mailer would never send';
  end if;

  -- (c) It stamps at claim time. If a later edit moves the UPDATE out, a crash mid-send
  --     turns into the same email going out on every run forever.
  if pg_get_functiondef('public.claim_notify_mail(int)'::regprocedure) not ilike '%set emailed_at = now()%' then
    raise exception 'claim_notify_mail no longer stamps emailed_at as it claims';
  end if;

  -- (d) It honours the opt-out. A brother who turned email off must not be mailed
  --     because someone pressed a button at him.
  if pg_get_functiondef('public.claim_notify_mail(int)'::regprocedure) not ilike '%email_opt_out%' then
    raise exception 'claim_notify_mail no longer honours email_opt_out';
  end if;

  -- (e) The queue accepts this kind of email. Without it the mailer claims a
  --     notification, stamps it, then fails to enqueue — and because the stamp is
  --     already down, that request is silently lost. Found the hard way on the first
  --     end-to-end run.
  begin
    insert into public.email_batches (kind, subject, html, created_by)
    values ('notify', 'assertion probe', '<p>probe</p>', 'upgrade59-assert');
    delete from public.email_batches where created_by = 'upgrade59-assert';
  exception when check_violation then
    raise exception 'email_batches rejects kind=notify — the notification mailer cannot queue anything';
  end;
end $$;

notify pgrst, 'reload schema';
