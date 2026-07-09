-- ============================================================================
-- upgrade10.sql — Phase B: request-a-mentor matching
-- Applied via Supabase Management API (agent-run). Documented here for record.
-- Turns the mentor finder from a search box into an actual handshake: an active
-- states a field + goal, and up to 5 matching alumni who flagged
-- open_to:'mentor' get a notification carrying his name + email so they can
-- simply reply. Same closed loop as connect_request (upgrade9.sql).
-- ============================================================================

create or replace function public.mentor_request(field text, note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  my_name  text;
  my_email text;
  q        text;
  sent     int := 0;
begin
  if not public.is_approved_brother() then
    return 'error: members only';
  end if;
  if field is null or length(btrim(field)) = 0 then
    return 'error: pick a field';
  end if;

  my_email := coalesce(auth.jwt() ->> 'email', '');
  select full_name into my_name from public.brothers
   where user_id = auth.uid() and status = 'verified' limit 1;

  -- gentle anti-spam: one mentor request per requester per 7 days
  if exists (
    select 1 from public.notifications
     where kind = 'mentor_request'
       and payload->>'email' = my_email
       and created_at > now() - interval '7 days'
  ) then
    return 'already';
  end if;

  q := '%' || lower(btrim(field)) || '%';

  with matches as (
    select b.user_id
      from public.brothers b
     where b.user_id is not null
       and b.user_id <> auth.uid()
       and b.status = 'verified'
       and 'mentor' = any(b.open_to)
       and ( lower(coalesce(b.industry, ''))   = lower(btrim(field))
          or lower(coalesce(b.skills, ''))     like q
          or lower(coalesce(b.occupation, '')) like q
          or lower(coalesce(b.company, ''))    like q )
     limit 5                                  -- cap the fan-out; never spam the roster
  ), ins as (
    insert into public.notifications (recipient, kind, payload)
    select m.user_id, 'mentor_request',
           jsonb_build_object('actor', coalesce(my_name, 'A brother'),
                              'email', my_email,
                              'field', btrim(field),
                              'note',  left(coalesce(note, ''), 160))
      from matches m
    returning 1
  )
  select count(*) into sent from ins;

  if sent = 0 then
    return 'none';   -- no alumni have raised the "open to mentoring" flag in that field yet
  end if;
  return sent::text;
end;
$$;

grant execute on function public.mentor_request(text, text) to authenticated;
