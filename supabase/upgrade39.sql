-- upgrade39.sql — Connect carries a note
--
-- This is the direct-messaging replacement. DMs were considered and declined:
-- every non-auth email on this site goes through one FIFO queue capped at
-- 60/day, so DM notifications would push the monthly digest and invite links
-- behind them; and the Admin Console currently promises the incoming buyer
-- "there's no inbox or chat" — nothing to moderate. Usage agreed: 100 accounts,
-- but the group board has 5 threads total and Connect has fired 12 times ever.
--
-- What Connect actually lacked was context. Every one of those 12 arrived as a
-- bare "X wants to connect" with no reason attached, which puts the whole
-- burden of starting the conversation on the recipient. One optional line fixes
-- that without opening an inbox.
--
-- The old one-arg function is DROPPED, not left beside the new one: PostgREST
-- resolves RPCs by argument name, and two candidates both satisfying {target}
-- is an ambiguity error (PGRST203). Dropping it is safe to run before the
-- front-end ships — the currently-live client calls with {target} only, and
-- that still resolves here because `note` has a default.

drop function if exists public.connect_request(uuid);

create or replace function public.connect_request(target uuid, note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  my_name  text;
  my_email text;
  my_note  text;
begin
  if not public.is_approved_brother() then
    return 'error: members only';
  end if;
  if target is null or target = auth.uid() then
    return 'error: invalid target';
  end if;
  my_email := coalesce(auth.jwt() ->> 'email', '');
  select full_name into my_name from public.brothers
   where user_id = auth.uid() and status = 'verified' limit 1;

  -- Trimmed and capped HERE. The textarea's maxlength is a courtesy to whoever
  -- is typing, not a control — this function is reachable directly over REST.
  -- Whitespace-only collapses to null so it can't render an empty quote.
  -- NOT btrim(): bare btrim strips SPACES only, so a note of newlines survived
  -- it and rendered as an empty “” in the recipient's bell. Caught by the test.
  my_note := regexp_replace(coalesce(note, ''), '^\s+|\s+$', '', 'g');
  -- Re-trim after the cut, in case 200 chars landed in the middle of a space run.
  my_note := nullif(regexp_replace(left(my_note, 200), '\s+$', ''), '');

  -- gentle anti-spam: one request per requester->recipient per 7 days
  if exists (
    select 1 from public.notifications
     where recipient = target
       and kind = 'connect_request'
       and payload->>'email' = my_email
       and created_at > now() - interval '7 days'
  ) then
    return 'already';
  end if;

  insert into public.notifications (recipient, kind, payload)
  values (target, 'connect_request',
          jsonb_build_object('actor', coalesce(my_name, 'A brother'),
                             'email', my_email)
          || case when my_note is null then '{}'::jsonb
                  else jsonb_build_object('note', my_note) end);
  return 'ok';
end;
$$;

grant execute on function public.connect_request(uuid, text) to authenticated;

-- PostgREST caches the schema; without this the new signature 404s until the
-- next reload.
notify pgrst, 'reload schema';
