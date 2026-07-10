-- ============================================================================
-- upgrade14.sql — centralize the admin identity to ONE place (handoff)
-- Applied via Supabase Management API (agent-run). Documented here for record.
--
-- Before: the admin email 'zbxi.web@gmail.com' was hard-coded in is_admin(),
-- three brothers_admin_* policies, and two notify triggers. To change the admin
-- you had to edit all of them. Now everything in the database derives from a
-- single function, public.admin_email(). Changing the admin = ONE statement:
--     create or replace function public.admin_email()
--       returns text language sql immutable as $$ select 'new@email'::text $$;
-- Edge Functions read this same function (see zbxi-*.ts). The only remaining
-- copy is assets/js/config.js ADMIN_EMAIL, which is cosmetic-only (controls the
-- ADMIN badge / console link in the browser) and grants no access.
-- ============================================================================

-- THE single source of truth.
create or replace function public.admin_email()
returns text
language sql
immutable
set search_path = public
as $$ select 'zbxi.web@gmail.com'::text $$;

grant execute on function public.admin_email() to anon, authenticated, service_role;

-- Everything else derives from it.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$ select coalesce(auth.jwt() ->> 'email', '') = public.admin_email(); $$;

-- brothers admin policies: use is_admin() instead of the inline literal.
drop policy if exists brothers_admin_read on public.brothers;
create policy brothers_admin_read on public.brothers for select using (public.is_admin());

drop policy if exists brothers_admin_update on public.brothers;
create policy brothers_admin_update on public.brothers for update using (public.is_admin());

drop policy if exists brothers_admin_delete on public.brothers;
create policy brothers_admin_delete on public.brothers for delete using (public.is_admin());

-- Notify triggers: look up the admin user via admin_email().
create or replace function public.tg_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select id into admin_uid from auth.users where email = public.admin_email();
    if admin_uid is not null then
      insert into public.notifications (recipient, kind, payload)
      values (admin_uid, 'new_pending', jsonb_build_object('name', new.full_name));
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'verified' and old.status = 'pending'
     and new.user_id is not null then
    insert into public.notifications (recipient, kind, payload)
    values (new.user_id, 'approved', jsonb_build_object('name', new.full_name));
  end if;
  return new;
end;
$$;

create or replace function public.tg_notify_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid;
begin
  if tg_op = 'INSERT' then
    select id into admin_uid from auth.users where email = public.admin_email();
    if admin_uid is not null then
      insert into public.notifications (recipient, kind, payload)
      values (admin_uid, 'suggestion',
              jsonb_build_object('actor', public.member_name(new.author_user), 'text', left(new.body, 90)));
    end if;
  elsif tg_op = 'UPDATE' and new.response is not null
        and (old.response is distinct from new.response) then
    insert into public.notifications (recipient, kind, payload)
    values (new.author_user, 'suggestion_reply',
            jsonb_build_object('text', left(new.response, 90)));
  end if;
  return new;
end;
$$;
