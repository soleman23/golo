-- 0030 — Invalidate the scorecard cache after the course-matching fix.
--
-- Rows cached before golfcourseapi-holes' bestCourseMatch was tightened could
-- hold a wrong-course payload (fuzzy search used to fall back to the first
-- result, e.g. "Harbor Dunes" -> "Wild Dunes"). Clear the cache once so every
-- course re-fetches through the corrected matcher on next load. The cache is
-- derived data that repopulates on demand, so this is safe.

delete from public.course_scorecard_cache;
