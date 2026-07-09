-- ============================================================================
-- upgrade9.sql — Phase A networking: profile fields, directory view, Connect
-- Applied via Supabase Management API (agent-run). Documented here for record.
-- Note: `linkedin` + `contact_prefs` already exist (schema.sql/upgrade3) and
-- already power the contact-reveal; this adds discovery + intro requests.
-- ============================================================================

-- 1) Networking profile fields
alter table public.brothers add column if not exists company       text;
alter table public.brothers add column if not exists industry      text;   -- picklist in the UI
alter table public.brothers add column if not exists open_to       text[] not null default '{}'; -- mentor | hire | connect
alter table public.brothers add column if not exists email_opt_out boolean not null default false; -- Phase C digest

-- 2) member_directory: expose networking fields to approved brothers
drop view if exists public.member_directory;
create view public.member_directory as
  select user_id, full_name, photo_url, role, role_term, pledge_class,
         occupation, company, industry, city, open_to
  from public.brothers
  where user_id is not null
    and status in ('verified', 'pending')
    and public.is_approved_brother();
grant select on public.member_directory to authenticated;

-- 3) release_profile(): also wipe the new networking fields on disconnect
create or replace function public.release_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.brothers%rowtype;
begin
  if auth.uid() is null then
    return 'error: not signed in';
  end if;
  select * into r from public.brothers where user_id = auth.uid();
  if not found then
    return 'error: no profile linked to this account';
  end if;

  if r.roster_name is not null then
    update public.brothers
       set user_id = null,
           full_name = r.roster_name,
           status = 'verified',
           grad_year = null, major = null, hometown = null, city = null,
           occupation = null, phone = null, email = null, contact_prefs = null,
           skills = null, linkedin = null, quote = null, bio = null,
           photo_url = null, role = null, role_term = null,
           company = null, industry = null, open_to = '{}', email_opt_out = false
     where id = r.id;
  else
    delete from public.brothers where id = r.id;
  end if;

  return 'ok';
end;
$$;
grant execute on function public.release_profile() to authenticated;

-- 4) Connect / request-intro RPC. Notifications only accept inserts through
--    SECURITY DEFINER paths, so the intro request goes through this function.
--    The payload carries the requester's name + email — that closes the loop:
--    the recipient can reply directly (the requester consents by asking).
create or replace function public.connect_request(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  my_name  text;
  my_email text;
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
                             'email', my_email));
  return 'ok';
end;
$$;
grant execute on function public.connect_request(uuid) to authenticated;
