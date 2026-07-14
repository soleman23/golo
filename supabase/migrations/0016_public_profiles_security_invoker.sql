-- Resolve Supabase advisor 0010_security_definer_view for public.public_profiles.
-- The view must not bypass the RLS policies on public.profiles.

alter view if exists public.public_profiles
  set (security_invoker = true);

comment on view public.public_profiles is
  'Limited profile projection; security_invoker keeps public.profiles RLS in force.';

grant select on public.public_profiles to anon, authenticated;
