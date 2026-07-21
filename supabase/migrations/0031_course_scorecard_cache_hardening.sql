-- 0031 - Harden the shared GolfCourseAPI scorecard cache.
--
-- Existing rows were written by the first, name-only matcher. Version them as
-- legacy so the consolidated resolver rematches once before trusting them.
-- The table remains service-role-only through the deny-all RLS posture added
-- in 0029.

alter table public.course_scorecard_cache
  add column if not exists payload_version integer not null default 1,
  add column if not exists match_status text not null default 'matched',
  add column if not exists match_score real,
  add column if not exists provider_meta jsonb,
  add column if not exists retry_after timestamptz;

alter table public.course_scorecard_cache
  drop constraint if exists course_scorecard_cache_match_status_check;

alter table public.course_scorecard_cache
  add constraint course_scorecard_cache_match_status_check
  check (match_status in ('matched', 'no_match'));

comment on column public.course_scorecard_cache.payload_version is
  'Resolver payload version. Rows older than the current resolver are rematched.';
comment on column public.course_scorecard_cache.match_status is
  'matched for a provider payload, no_match for a short-lived negative cache entry.';
comment on column public.course_scorecard_cache.provider_meta is
  'Non-secret provider course metadata used to validate and describe cached matches.';
comment on column public.course_scorecard_cache.retry_after is
  'Earliest time a negative match should be searched again.';
