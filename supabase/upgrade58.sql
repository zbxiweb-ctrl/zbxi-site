-- upgrade58.sql — separate "holds the seat" from "can use the officer console".
--
-- THE ASK: take Johnathan Conway off the Alumni President seat — he is a second one, and
-- the end-of-term screen would archive the term with two Presidents — while keeping his
-- officer access so the console can still be tested from a real session.
--
-- WHY THIS NEEDED A MIGRATION AND NOT AN UPDATE. Those are the same two columns.
-- my_officer_seat() derives the seat from brothers.role = 'President' AND
-- brothers.role_scope = 'alumni', and the E-Board tab, eboards.html and the end-of-term
-- screen all read exactly those columns to decide who is sitting. Clearing them removes
-- him from the board AND from the console in one stroke; leaving them keeps him on both.
-- There is no data-only answer.
--
-- ── THE SECURITY QUESTION, answered before it is asked ────────────────────────────────
-- This adds a SECOND way to hold an officer seat, in the one function that decides who is
-- an officer. So: can anyone grant themselves a seat now?
--
--   No. officer_seat_overrides has NO grants for anon or authenticated — not select, not
--   write — and an admin-only RLS policy underneath in case a future migration adds one.
--   No client can read or write it by any path. my_officer_seat() reaches it only because
--   SECURITY DEFINER runs as the owner. The only way a row appears is a superuser
--   statement like the one in section 3 of this file.
--
--   The override also still requires a VERIFIED brothers row (section 2). "Officer powers
--   require being a verified brother" stays true; this changes which brothers row, not
--   whether one is needed.
--
--   upgrade50's assertion — my_officer_seat() must never read brother_titles — still
--   holds and is re-asserted below, because eboard.manage would become a self-promotion
--   button if it ever did.
--
-- ── THE TRAP THIS FILE HAS TO AVOID ──────────────────────────────────────────────────
-- Section 3 clears role/role_scope on a brothers row. tg_guard_status PINS both for any
-- caller that is not is_admin() — and the Management API has no JWT, so is_admin() is
-- FALSE here. Without `set local zbxi.bypass = '1'` the UPDATE reports success and
-- changes nothing. Section 4 asserts the change actually landed rather than trusting it.

-- ═══ 1) Where an explicitly granted seat lives ════════════════════════════════════════
create table if not exists public.officer_seat_overrides (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  seat       text not null check (seat in ('alumni_president')),
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.officer_seat_overrides is
  'Officer seats granted explicitly rather than derived from brothers.role/role_scope. '
  'Exists so a test account can use the officer console without appearing as a sitting '
  'officer on the Executive Boards. NO client grants by design — superuser only.';

alter table public.officer_seat_overrides enable row level security;

-- Revoke FIRST. A table created here is born with Supabase's default `all` for anon and
-- authenticated; a narrow grant written afterwards is an additive no-op. Same trap as
-- upgrade49/50/52/57. Nothing is granted back: no client needs to see this table.
revoke all on public.officer_seat_overrides from anon, authenticated;

drop policy if exists oso_admin_all on public.officer_seat_overrides;
create policy oso_admin_all on public.officer_seat_overrides
  for all using (public.is_admin()) with check (public.is_admin());

-- ═══ 2) The seat: derived first, explicit second ═════════════════════════════════════
create or replace function public.my_officer_seat()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- (a) the real thing, unchanged: a sitting Alumni President
    (select case when b.role = 'President' and b.role_scope = 'alumni'
                 then 'alumni_president' else null end
       from public.brothers b
      where b.user_id = auth.uid() and b.status = 'verified'
      limit 1),
    -- (b) an explicitly granted seat — still only for a VERIFIED brother, so officer
    --     powers continue to require being one. Admin-writable only.
    (select o.seat
       from public.officer_seat_overrides o
       join public.brothers b2 on b2.user_id = o.user_id and b2.status = 'verified'
      where o.user_id = auth.uid()
      limit 1)
  );
$$;

revoke all on function public.my_officer_seat() from public, anon;
grant execute on function public.my_officer_seat() to authenticated;

-- ═══ 3) Johnathan off the seat, onto an override ═════════════════════════════════════
do $$
declare
  uid uuid;
  bid uuid;
begin
  select b.id, b.user_id into bid, uid
    from public.brothers b
   where lower(b.email) = 'johnathan76101@gmail.com' and b.status = 'verified'
   limit 1;
  if bid is null then
    raise exception 'no verified brothers row for johnathan76101@gmail.com';
  end if;
  if uid is null then
    raise exception 'that brothers row has no account attached — an override keys on user_id';
  end if;

  -- the override first, so his console access never lapses
  insert into public.officer_seat_overrides (user_id, seat, note)
  values (uid, 'alumni_president', 'Owner test seat — console access without holding the real seat (upgrade58)')
  on conflict (user_id) do update set seat = excluded.seat, note = excluded.note;

  -- then take the real seat away. THE BYPASS IS LOAD-BEARING: without it tg_guard_status
  -- pins role/role_scope and this UPDATE silently does nothing.
  perform set_config('zbxi.bypass', '1', true);
  update public.brothers
     set role = null, role_scope = null, role_term = null
   where id = bid;
  perform set_config('zbxi.bypass', '', true);
end $$;

-- ═══ 4) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare
  n int;
  bad text;
  uid uuid;
begin
  -- (a) He is no longer a sitting officer. Asserted because the UPDATE above fails
  --     SILENTLY if the bypass is ever removed — no error, just nothing changed.
  select count(*) into n from public.brothers
   where lower(email) = 'johnathan76101@gmail.com'
     and (role is not null or role_scope is not null);
  if n <> 0 then
    raise exception 'Johnathan still holds a role/role_scope — the guard trigger ate the update';
  end if;

  -- (b) Exactly one Alumni President remains.
  select count(*) into n from public.brothers
   where role = 'President' and role_scope = 'alumni' and status = 'verified';
  if n <> 1 then
    raise exception 'expected exactly 1 sitting Alumni President, found %', n;
  end if;

  -- (c) …and his override exists, so his console access survived.
  select o.user_id into uid from public.officer_seat_overrides o
    join public.brothers b on b.user_id = o.user_id
   where lower(b.email) = 'johnathan76101@gmail.com';
  if uid is null then
    raise exception 'the override row is missing — his officer access would be gone';
  end if;

  -- (d) NO client can touch the override table. This is the whole security argument.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'officer_seat_overrides'
     and grantee in ('anon', 'authenticated');
  if bad is not null then
    raise exception 'officer_seat_overrides is reachable by a client (%) — it must be superuser-only', bad;
  end if;

  -- (e) RLS is on underneath, so a future grant still would not open it.
  if not (select relrowsecurity from pg_class where oid = 'public.officer_seat_overrides'::regclass) then
    raise exception 'RLS is off on officer_seat_overrides';
  end if;

  -- (f) upgrade50's rule still holds: the seat must never be derivable from a table an
  --     officer can write. brother_titles is the one that would turn eboard.manage into
  --     a self-promotion button.
  if pg_get_functiondef('public.my_officer_seat()'::regprocedure) ilike '%brother_titles%' then
    raise exception 'my_officer_seat() now reads brother_titles — that is a privilege-escalation path';
  end if;

  -- (g) The derived path is intact — this migration adds a branch, it does not replace one.
  bad := pg_get_functiondef('public.my_officer_seat()'::regprocedure);
  if bad not like '%role_scope%' or bad not like '%''verified''%' then
    raise exception 'my_officer_seat() lost the derived seat or its verified check';
  end if;
end $$;

notify pgrst, 'reload schema';
