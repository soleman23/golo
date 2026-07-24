-- 0036 — Drop the dead anon grant on public_profiles, and correct two claims
-- 0034 made about itself.
--
-- WHY THIS EXISTS
-- 0034 said, of the view it deliberately left alone:
--
--     "The public_profiles VIEW keeps the anon SELECT that 0001/0018
--      deliberately gave it; that grant is out of scope here."
--
-- The grant is still there, but it stopped doing anything the moment 0034 ran.
-- 0018 made the view `security_invoker = true`, so reading it checks the
-- CALLER's privileges on the underlying public.profiles — not the view owner's.
-- 0034 then revoked anon's SELECT on public.profiles. Net effect: anon holds
-- SELECT on the view and still cannot read a single row.
--
-- Verified against production after 0034 was applied:
--     GET /rest/v1/public_profiles  (anon key)
--     -> 42501  "permission denied for table profiles"
--
-- So the grant reads as intentional while being inert. That is worse than no
-- grant at all: the next person to touch this will reasonably assume anon
-- access works and design around it. Removing it makes the real posture — the
-- one 0034 actually wanted, "anon gets nothing" — visible in the schema.
--
-- SAFE TO DROP
-- public_profiles has exactly one consumer, src/lib/db/betting.js, and it runs
-- authenticated. Every route in App.jsx is behind a verified session, so no
-- client call is ever made signed-out. `authenticated` keeps SELECT on
-- public.profiles, so that path is untouched.
--
-- IF ANON READ IS EVER WANTED HERE
-- A table grant is the wrong tool. Because the view is security_invoker, anon
-- would need SELECT on public.profiles itself — which would hand anon the whole
-- table, defeating the point of the view. Set `security_invoker = false` on the
-- view instead, so it runs with its owner's privileges and exposes only the
-- columns it selects.
--
-- ALSO, FOR THE RECORD: 0034 called itself "a no-op" on the hosted project, on
-- the grounds that the project predates Supabase's hardened default privileges.
-- That was too modest. Production now refuses anon with 42501 on every table in
-- 0034's revoke list, and 0020 only ever revoked FUNCTION execute, never table
-- privileges — so the legacy anon table grants were live until 0034 removed
-- them. 0034 tightened production security; it did not merely write down what
-- was already true. (The pre-0034 grants can no longer be observed directly,
-- so this is inference from the migration chain, not a measurement.)
--
-- Re-runnable: REVOKE is idempotent.

revoke all on table public.public_profiles from anon;

do $$
begin
  raise notice 'DONE — dead anon grant on public_profiles removed (0036).';
end $$;
