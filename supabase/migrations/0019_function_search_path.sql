-- 0017 — Pin search_path on the five functions that were missing it.
--
-- Supabase linter 0011 (function_search_path_mutable): a function without a
-- pinned search_path resolves unqualified names against the *caller's* path, so
-- a caller can shadow `public` and make the body call their own table/operator.
-- Every other function in this schema already sets `search_path = public`; these
-- five were the gap.
--
-- ALTER (not CREATE OR REPLACE) on purpose: course_ready_for_setup is referenced
-- inside the RLS policies on public.courses (0012_admin_course_management.sql),
-- and set_updated_at / protect_profile_is_admin back triggers. ALTER changes only
-- the setting and never the body, so none of those dependencies are disturbed.
--
-- Re-runnable.

alter function public.set_updated_at()
  set search_path = public;

alter function public.player_key_from_player_json(jsonb)
  set search_path = public;

alter function public.mask_email(text)
  set search_path = public;

alter function public.mask_phone(text)
  set search_path = public;

alter function public.course_ready_for_setup(text, text, integer, jsonb, jsonb, jsonb)
  set search_path = public;
