-- 0029 — Per-hole scorecard cache (GolfCourseAPI yardage).
--
-- NCRDB gives us par + stroke index per hole but no yardage. The
-- golfcourseapi-holes edge function fills that gap from GolfCourseAPI.com and
-- caches the raw tee/hole payload here so repeat course loads are instant and we
-- don't burn the free-tier quota re-fetching the same course.
--
-- Access model: the edge function reaches this table with the SERVICE ROLE key,
-- which bypasses RLS. RLS is enabled with NO policies so anon/authenticated
-- clients get a clean deny-all — nothing reads or writes the cache except the
-- function. This keeps the GolfCourseAPI key and cache writes server-side, in
-- line with the app's hardening posture (see 0020_revoke_anon_execute). Idempotent.

create table if not exists public.course_scorecard_cache (
  -- The app's own course id (e.g. "ncrdb-12345", "tetherow"), so the cache key
  -- matches whatever the client is holding — no dependency on GolfCourseAPI ids.
  course_id  text primary key,
  gcapi_id   integer,
  gcapi_name text,
  -- The GolfCourseAPI `course.tees` object as returned: { male: [...], female: [...] },
  -- each tee carrying its per-hole { par, yardage, handicap } array.
  holes_data jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_course_scorecard_cache_gcapi_id
  on public.course_scorecard_cache (gcapi_id);

-- Deny-all for anon/authenticated; the service-role edge function bypasses RLS.
alter table public.course_scorecard_cache enable row level security;
