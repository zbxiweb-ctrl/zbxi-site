-- upgrade63.sql — an event three days out gets one reminder, so the calendar becomes a
-- turnout tool instead of a noticeboard.
--
-- THE PROBLEM. An event that appeared in the monthly digest three weeks early gets no second
-- mention before it happens. The brothers who said they were coming hear nothing; the
-- brothers who meant to RSVP and forgot hear nothing.
--
-- ── SAME SHAPE AS THE NOTIFICATION MAILER (upgrade59) ────────────────────────────────
-- A CLAIM verb here, rendering in TypeScript beside the other templates, and the existing
-- queue + drain doing the sending at the pace they already enforce. A database function
-- cannot render the chapter's email shell and must not make anyone wait on a mail provider.
--
-- ── STAMP-ON-CLAIM ───────────────────────────────────────────────────────────────────
-- reminded_at is set by the same UPDATE that returns the rows. A crash after claiming costs
-- one event's reminder; a crash between "send" and "mark sent" would re-send it on every run
-- for three days. Losing one is the better failure.
--
-- ── WHY A WINDOW, NOT "EXACTLY 3 DAYS" ───────────────────────────────────────────────
-- A daily cron with a narrow window silently drops an event that falls between two runs. A
-- WIDE window plus a permanent stamp can neither double-send nor miss. The cost is that an
-- event created two days before it happens gets its reminder two days out rather than three
-- — which is still the reminder doing its job.
--
-- ── THE BACKFILL IS THE SAFETY ───────────────────────────────────────────────────────
-- Everything already on the calendar and starting inside the window is stamped as handled,
-- so the first run cannot surprise anybody with a send. (Today the calendar is empty, but
-- the guard belongs in the migration rather than in my memory of a query I ran once.)
--
-- Idempotent: safe to re-run.

-- ═══ 1) Two columns ══════════════════════════════════════════════════════════════════
alter table public.events add column if not exists reminded_at timestamptz;
alter table public.events add column if not exists remind_all  boolean not null default false;

comment on column public.events.reminded_at is
  'When this event''s reminder was handed to the email queue. NULL = still to send. Stamped '
  'by claim_event_reminders() at claim time (upgrade63). Editing an event does NOT clear it: '
  'one reminder per event, on purpose.';
comment on column public.events.remind_all is
  'false (default) = remind only the brothers who RSVP''d. true = also remind everyone we can '
  'email. For a Reunion, not for a chapter meeting (upgrade63).';

create index if not exists events_unreminded_idx
  on public.events (starts_at) where reminded_at is null;

-- ═══ 2) Nothing already in the window goes out unannounced ═══════════════════════════
update public.events
   set reminded_at = now()
 where reminded_at is null
   and starts_at <= now() + interval '4 days';

-- ═══ 3) The claim verb ═══════════════════════════════════════════════════════════════
-- One row per RECIPIENT, stamping the event as it goes. `rsvped` tells the mailer which of
-- the two bodies to send: telling a man to RSVP for something he already RSVP'd to is the
-- fastest way to teach him to ignore these.
--
-- WHO IS SKIPPED, and why each one:
--   • a brother who opted out of email      — his choice
--   • a brother with no address on file     — nothing to send to
--   • an event already stamped              — one reminder per event, ever
--   • everyone who did not RSVP             — UNLESS the event has remind_all ticked
create or replace function public.claim_event_reminders()
returns table (
  event_id    uuid,
  title       text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  all_day     boolean,
  location    text,
  description text,
  to_email    text,
  to_name     text,
  unsub_token text,
  rsvped      boolean
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select e.id
      from public.events e
     where e.reminded_at is null
       and e.starts_at > now()
       and e.starts_at <= now() + interval '3 days 12 hours'
     order by e.starts_at
     limit 5                       -- a runaway backstop; the chapter runs ~2 events a month
  ),
  claimed as (
    update public.events e
       set reminded_at = now()
      from due
     where e.id = due.id
    returning e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.description, e.remind_all
  )
  -- the brothers who said they are coming
  select c.id, c.title, c.starts_at, c.ends_at, c.all_day, c.location, c.description,
         b.email::text,
         coalesce(b.roster_name, b.full_name)::text,
         b.unsubscribe_token::text,
         true
    from claimed c
    join public.event_rsvps r on r.event_id = c.id
    join public.brothers b
      on b.user_id = r.user_id
     and b.status = 'verified'
     and coalesce(b.email_opt_out, false) = false
     and coalesce(btrim(b.email), '') <> ''
  union all
  -- and, only when the event asks for it, everyone else we can reach
  select c.id, c.title, c.starts_at, c.ends_at, c.all_day, c.location, c.description,
         b.email::text,
         coalesce(b.roster_name, b.full_name)::text,
         b.unsubscribe_token::text,
         false
    from claimed c
    join public.brothers b
      on b.status = 'verified'
     and coalesce(b.email_opt_out, false) = false
     and coalesce(btrim(b.email), '') <> ''
   where c.remind_all
     and not exists (
       select 1
         from public.event_rsvps r2
         join public.brothers b2 on b2.user_id = r2.user_id
        where r2.event_id = c.id and b2.id = b.id
     );
end;
$$;

-- Service role only: this returns brothers' EMAIL ADDRESSES. Nothing signed in as a brother
-- — or as the admin in a browser — has any business calling it.
revoke all on function public.claim_event_reminders() from public, anon, authenticated;
grant execute on function public.claim_event_reminders() to service_role;

-- ═══ 4) A fifth kind of email needs its own label ════════════════════════════════════
-- Borrowing 'notify' would make every later count of "what did this site send" wrong — the
-- same reasoning that gave the notification mailer its own kind in upgrade59.
alter table public.email_batches drop constraint if exists email_batches_kind_check;
alter table public.email_batches add constraint email_batches_kind_check
  check (kind = any (array['digest', 'compose', 'invite', 'notify', 'reminder']));

-- ═══ 5) reminded_at must not be writable from a browser ══════════════════════════════
-- Checked against information_schema rather than assumed: `events` still carries Supabase's
-- default `grant all`, column for column, to BOTH anon and authenticated. anon has no policy
-- so it changes nothing today — but `authenticated` does, and the officer who may edit an
-- event could therefore clear reminded_at and make the reminder fire again. Up to 60 emails
-- per clear, and it would quietly falsify the one guarantee this whole feature rests on:
-- one reminder per event, ever.
--
-- So the write surface becomes exactly the columns the three event forms send. id and
-- created_at go back to being server-set — the same class of bug upgrade43 closed on
-- gallery_posts, where a client-supplied created_at pinned a photo to the top of the grid
-- forever. is_public is left out because nothing in the site has ever written it.
revoke insert, update, delete on public.events from anon;
revoke insert, update on public.events from authenticated;
grant  insert (title, all_day, starts_at, ends_at, location, category, description, remind_all)
  on public.events to authenticated;
grant  update (title, all_day, starts_at, ends_at, location, category, description, remind_all)
  on public.events to authenticated;

-- ═══ 6) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare n int; bad text; def text;
begin
  -- (a) Nothing already inside the window is left unstamped — the no-surprises guard.
  select count(*) into n from public.events
   where reminded_at is null and starts_at <= now() + interval '4 days';
  if n <> 0 then
    raise exception '% events inside the reminder window are unstamped — the first run would mail them', n;
  end if;

  -- (b) The address-returning verb is service_role only.
  select string_agg(g, ', ') into bad from (
    select unnest(array['anon','authenticated','public']) as g
  ) x where has_function_privilege(x.g, 'public.claim_event_reminders()', 'execute');
  if bad is not null then
    raise exception 'claim_event_reminders is executable by % — it returns email addresses', bad;
  end if;
  if not has_function_privilege('service_role', 'public.claim_event_reminders()', 'execute') then
    raise exception 'service_role cannot execute claim_event_reminders — no reminder would ever send';
  end if;

  def := pg_get_functiondef('public.claim_event_reminders()'::regprocedure);

  -- (c) It stamps as it claims. If a later edit moves the UPDATE out, one crash turns into
  --     the same reminder going out every day until the event happens.
  if def not ilike '%set reminded_at = now()%' then
    raise exception 'claim_event_reminders no longer stamps reminded_at as it claims';
  end if;

  -- (d) It honours the opt-out.
  if def not ilike '%email_opt_out%' then
    raise exception 'claim_event_reminders no longer honours email_opt_out';
  end if;

  -- (e) The all-hands branch is still GATED on remind_all. Losing this line turns every
  --     chapter meeting into an email to all 60 reachable brothers.
  if def not ilike '%where c.remind_all%' then
    raise exception 'claim_event_reminders no longer gates the all-hands branch on remind_all';
  end if;

  -- (f) reminded_at is server-only. If a browser can write it, "one reminder per event"
  --     stops being true and the guard in (c) protects nothing.
  if has_column_privilege('authenticated', 'public.events', 'reminded_at', 'UPDATE') then
    raise exception 'authenticated can write events.reminded_at — a reminder could be re-fired at will';
  end if;
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'events'
     and privilege_type = 'UPDATE' and grantee = 'authenticated'
     and column_name not in ('title','all_day','starts_at','ends_at','location','category','description','remind_all');
  if bad is not null then
    raise exception 'events: authenticated can UPDATE %; id/created_at/reminded_at must stay server-set', bad;
  end if;
  -- ...and the officers who run the calendar can still run it.
  if not has_column_privilege('authenticated', 'public.events', 'remind_all', 'UPDATE')
  or not has_column_privilege('authenticated', 'public.events', 'title', 'UPDATE')
  or not has_column_privilege('authenticated', 'public.events', 'starts_at', 'INSERT') then
    raise exception 'the event form can no longer save — the grant was over-narrowed';
  end if;

  -- (g) The queue accepts this kind. Without it the mailer claims an event, stamps it, then
  --     fails to enqueue — and because the stamp is down, that reminder is silently lost.
  --     upgrade59 found this exact failure the hard way on its first end-to-end run.
  begin
    insert into public.email_batches (kind, subject, html, created_by)
    values ('reminder', 'assertion probe', '<p>probe</p>', 'upgrade63-assert');
    delete from public.email_batches where created_by = 'upgrade63-assert';
  exception when check_violation then
    raise exception 'email_batches rejects kind=reminder — the event mailer cannot queue anything';
  end;
end $$;

notify pgrst, 'reload schema';
