-- 0018 — Close EXECUTE on our RPCs to `anon`, and to `authenticated` where the
-- function is internal.
--
-- Supabase linter 0028/0029 (anon/authenticated_security_definer_function_executable).
--
-- Root cause: Supabase ships default privileges that grant EXECUTE on every new
-- function in `public` to anon + authenticated. Earlier migrations only ever
-- `grant execute ... to authenticated`, which was additive noise — anon already
-- had it, and could reach every SECURITY DEFINER RPC via /rest/v1/rpc/*. Nothing
-- ever revoked it. App.jsx gates all routes behind a verified session and no RPC
-- is called signed-out, so anon needs none of these.
--
-- Functions are listed explicitly rather than using `revoke ... on all functions
-- in schema public`: a blanket revoke would also strip extension functions that
-- live in `public` and can break internal roles (supabase_storage_admin et al).
--
-- `postgres` (owner) and `service_role` keep EXECUTE throughout — edge functions
-- run as service_role.
--
-- Re-runnable.

-- ---------------------------------------------------------------- hard reset
-- Drop every caller grant first, then hand back only what is actually needed.
revoke all on function
  public.set_updated_at(),
  public.protect_profile_is_admin(),
  public.gen_invite_code(),
  public.player_key_from_player_json(jsonb),
  public.mask_email(text),
  public.mask_phone(text),
  public.purge_expired_ghin_oauth_states(),
  public.is_live_scorer(uuid),
  public.is_app_admin(),
  public.course_ready_for_setup(text, text, integer, jsonb, jsonb, jsonb),
  public.owns_round(uuid),
  public.in_round(uuid),
  public.is_live_member(uuid),
  public.link_round_participants(uuid),
  public.admin_me(),
  public.admin_desk_stats(),
  public.admin_list_profiles(text, integer, integer),
  public.admin_get_profile(uuid),
  public.admin_update_profile(uuid, jsonb),
  public.admin_list_live_rounds(text),
  public.admin_force_complete_live_round(uuid),
  public.admin_list_courses(),
  public.admin_upsert_course(jsonb),
  public.admin_set_course_visibility(text, boolean),
  public.start_live_round(uuid, jsonb, jsonb, text),
  public.join_live_round(text, text),
  public.patch_live_round(uuid, jsonb, text, jsonb),
  public.complete_live_round(uuid),
  public.peek_live_round(text),
  public.fetch_claimable_live_rounds(),
  public.search_verified_players(text, integer),
  public.get_player_contact(uuid)
from public, anon, authenticated;

-- --------------------------------------------- RLS helpers → authenticated
-- RLS policy expressions are evaluated as the *calling* role, so authenticated
-- must hold EXECUTE on any function a policy invokes or users get locked out of
-- their own rows. These five are each referenced from a policy:
--   is_app_admin, course_ready_for_setup  → courses_insert_auth / courses_update_own
--   owns_round, in_round                  → rounds / round_players policies
--   is_live_member                        → live_rounds / live_round_slots policies
grant execute on function
  public.is_app_admin(),
  public.course_ready_for_setup(text, text, integer, jsonb, jsonb, jsonb),
  public.owns_round(uuid),
  public.in_round(uuid),
  public.is_live_member(uuid)
to authenticated;

-- --------------------------------------------- client RPCs → authenticated
-- Everything the app calls over PostgREST from src/lib/db/*. These stay SECURITY
-- DEFINER by design (they bypass RLS on tables like live_round_slots, which has
-- RLS on with no policy) and gate internally on is_app_admin() / membership.
grant execute on function
  public.admin_me(),
  public.admin_desk_stats(),
  public.admin_list_profiles(text, integer, integer),
  public.admin_get_profile(uuid),
  public.admin_update_profile(uuid, jsonb),
  public.admin_list_live_rounds(text),
  public.admin_force_complete_live_round(uuid),
  public.admin_list_courses(),
  public.admin_upsert_course(jsonb),
  public.admin_set_course_visibility(text, boolean),
  public.start_live_round(uuid, jsonb, jsonb, text),
  public.join_live_round(text, text),
  public.patch_live_round(uuid, jsonb, text, jsonb),
  public.complete_live_round(uuid),
  public.peek_live_round(text),
  public.fetch_claimable_live_rounds(),
  public.search_verified_players(text, integer),
  public.get_player_contact(uuid),
  public.link_round_participants(uuid)
to authenticated;

-- ------------------------------------------------------- internal functions
-- Deliberately left with NO caller grant:
--   set_updated_at, protect_profile_is_admin  — trigger functions. Postgres checks
--     EXECUTE at CREATE TRIGGER time, not when the trigger fires, so the triggers
--     keep working with no grant to the writing role.
--   gen_invite_code, player_key_from_player_json, mask_email, mask_phone,
--   is_live_scorer                            — only ever called from inside other
--     SECURITY DEFINER bodies, so they run as the definer (postgres), not the
--     caller. Verified: no column defaults, generated columns, or policies use them.
--   purge_expired_ghin_oauth_states           — maintenance; call as service_role.

-- ------------------------------------------------------------ stop the leak
-- Without this, the next `create function` in public silently re-grants EXECUTE
-- to anon via Supabase's default privileges and the lint comes straight back.
alter default privileges in schema public
  revoke execute on functions from anon;
