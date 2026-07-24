-- upgrade33.sql — Defense-in-depth: strip grants the public roles never need.
--
-- Supabase's default GRANTs hand anon + authenticated the full table privilege set,
-- including TRUNCATE / REFERENCES / TRIGGER. The app never uses those (PostgREST only
-- does SELECT/INSERT/UPDATE/DELETE, and RLS gates those; DDL runs as postgres). None
-- of them are reachable through the REST API, so this is not a live risk — but a
-- clean, minimal grant set is what a buyer's security reviewer wants to see, and
-- TRUNCATE in particular is NOT governed by RLS, so best to not hand it out at all.
--
-- SELECT/INSERT/UPDATE/DELETE are intentionally KEPT — RLS is the real gate on those.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Keep it true for tables added later, too.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
