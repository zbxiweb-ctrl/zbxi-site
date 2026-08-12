-- upgrade56.sql — the Mentoring lists become manageable from the consoles.
--
-- THE GAP. Until now `open_to` had exactly ONE writer in the entire codebase: the
-- brother's own profile form. So if a brother ticked the wrong box, or asked to be taken
-- off the Mentors list, or never found the checkbox at all, nobody could do anything about
-- it — not the webmaster, not the alumni president. The Mentoring page had no management
-- surface anywhere.
--
-- THE ADMIN NEEDS NOTHING NEW. brothers_admin_update is a bare is_admin(), and
-- `authenticated` already holds UPDATE on the open_to column, so the console can write it
-- directly. This file exists ONLY for the officer.
--
-- ── WHY A FUNCTION AND NOT A POLICY ──────────────────────────────────────────────────
-- Widening brothers RLS for officers would hand them the whole row. The existing pattern
-- on this site is a narrow SECURITY DEFINER verb per capability (officer_update_brother
-- writes exactly four columns); this writes exactly one. An officer still cannot SELECT a
-- brothers row he does not own — he works from family_public — so a verb is also the only
-- shape that can work.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────
-- It does NOT open zbxi.bypass. tg_guard_status pins status, user_id, role, role_scope,
-- unsubscribe_token and roster_name — none of which this touches — so the trigger can stay
-- armed as a second lock. Opening the bypass here would disarm it for the whole
-- transaction to write a column it was never guarding.
--
-- It inherits the admin-supremacy boundary from upgrade54 by calling is_admin_brother().

create or replace function public.officer_set_open_to(p_id uuid, p_open_to text[])
returns text[]
language plpgsql
volatile
security definer
-- `public, pg_temp` to match is_admin_brother (upgrade54). Every reference inside is
-- schema-qualified so this is belt-and-braces, but a SECURITY DEFINER function on this
-- site pins both, and consistency is what makes an odd one out worth looking at.
set search_path = public, pg_temp
as $$
declare
  n   int;
  out_arr text[];
begin
  if not (public.is_admin() or public.officer_can('members.edit')) then
    raise exception 'not allowed';
  end if;

  -- upgrade54 boundary: the webmaster's own record is his alone.
  if not public.is_admin() and public.is_admin_brother(p_id) then
    raise exception 'that record belongs to the site administrator and only he can edit it';
  end if;

  -- Mirror brothers_open_to_valid so a bad value reads as a sentence rather than as a
  -- constraint violation. The constraint is still the real guard; this is the manners.
  if not (coalesce(p_open_to, '{}'::text[]) <@ array['mentor', 'mentee', 'connect']::text[]) then
    raise exception 'that is not one of the three options';
  end if;

  -- Stored sorted and de-duplicated, the same shape upgrade55 left the column in.
  select coalesce(array_agg(distinct v order by v), '{}'::text[]) into out_arr
    from unnest(coalesce(p_open_to, '{}'::text[])) v;

  update public.brothers
     set open_to = out_arr
   where id = p_id
     and status = 'verified';       -- only a live brother appears on the page at all
  get diagnostics n = row_count;

  if n = 0 then
    raise exception 'no such brother, or his record is not editable';
  end if;

  -- Logged for the officer only, same rule as officer_update_brother: the admin's own
  -- edits already have their own line and nothing should double-log.
  if not public.is_admin() then
    insert into public.activity_log (user_id, action, detail, target)
    values (auth.uid(), 'record_edited',
            (select coalesce(b.roster_name, b.full_name) from public.brothers b where b.id = p_id)
              || ' — mentoring: ' || coalesce(array_to_string(out_arr, ', '), 'none'),
            p_id);
  end if;

  return out_arr;
end;
$$;

revoke all on function public.officer_set_open_to(uuid, text[]) from public, anon;
grant execute on function public.officer_set_open_to(uuid, text[]) to authenticated;

-- ═══ Assertions ══════════════════════════════════════════════════════════════════════
do $$
declare
  bad text;
begin
  -- (a) anon cannot call it at all.
  if has_function_privilege('anon', 'public.officer_set_open_to(uuid, text[])', 'execute') then
    raise exception 'anon can execute officer_set_open_to';
  end if;

  -- (b) It consults the admin boundary. Catches a later edit that drops the guard —
  --     which would silently re-open the exact hole upgrade54 closed.
  select pg_get_functiondef(oid) into bad
    from pg_proc where oid = 'public.officer_set_open_to(uuid, text[])'::regprocedure;
  if bad not like '%is_admin_brother%' then
    raise exception 'officer_set_open_to no longer guards the webmaster''s record';
  end if;

  -- (c) It does NOT open the status/role guard. This function has no business touching
  --     those columns, and a bypass here would disarm the trigger transaction-wide.
  if bad like '%zbxi.bypass%' then
    raise exception 'officer_set_open_to opens zbxi.bypass — it must not';
  end if;

  -- (d) The constraint it mirrors still exists, so the two cannot drift apart unnoticed.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.brothers'::regclass and conname = 'brothers_open_to_valid'
  ) then
    raise exception 'brothers_open_to_valid is gone — officer_set_open_to is mirroring nothing';
  end if;
end $$;

notify pgrst, 'reload schema';
