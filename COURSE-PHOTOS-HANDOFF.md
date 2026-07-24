# Course photos — current handoff

Branch: `feat/course-photos-clean` — the photo pipeline rebuilt on current
`main`. It replaces both earlier attempts: the original `feat/course-photos`
(which also carried three commits now on `main` plus a `LiveNotifications`
version predating the durable-inbox rewrite) and the abandoned
`feature/course-images` / PR #13 (a strictly smaller backend-only subset that
also granted public read on the storage bucket).

Nothing in this feature is deployed. The migration and Edge Function must be
deployed by the repository owner after review.

The `scripts/verify-nearby-ui.mjs` and `NEARBY_EXCLUDED_COURSE_*` edits that
earlier drafts of this doc asked you to preserve are now on `main` (PR #14), so
they need no special handling here.

## Current design

Automatic course photos come only from Unsplash. The app hotlinks the image URL
returned by the API and displays a visible link to the photographer's Unsplash
profile. It does not download, rehost, or indefinitely cache provider image
bytes. Google Places was removed because the previous rehosting design did not
meet Places content storage and attribution requirements.

Bundled course art still wins over curated and fetched photos, per the owner's
earlier product decision. The admin screen warns about this before accepting an
upload.

The `course-image` Edge Function now:

- requires a signed-in user (or the service role used by the backfill)
- validates the course slug and prefers authoritative database course details
- returns cached metadata without consuming quota
- limits each user to 20 provider lookups per UTC day
- fails closed if cache reads or writes fail
- uses a 30-day positive cache, 24-hour genuine-miss cache, and 15-minute
  provider-error cache
- returns the image URL, source, photographer credit, and attribution URL

The setup wizard, active scoring screen, leaderboard, and commissioner course
editor all carry and display the attribution metadata. Long credits wrap rather
than truncate. The scoring leaderboard exposes only one focusable attribution
link while its overlay is open.

## Database/API changes

`supabase/migrations/0035_course_images.sql` adds:

- photo attribution fields to `courses` and `course_image_cache`
- deny-all client RLS for the cache
- `course_image_daily_usage`
- atomic service-role-only `consume_course_image_quota(uuid, int)`
- authenticated `course_image_data(text)`, returning URL plus attribution
- the five-argument `admin_set_course_image(...)`

The `course-images` storage bucket remains for curated commissioner uploads;
automatic Unsplash images are not copied into it.

## Verification completed locally

- shared Deno tests pass
- the three Edge Functions type-check
- ESLint passes
- the production Vite build passes
- the repository test suite passes
- mobile and desktop visual checks pass for setup, scoring, leaderboard, and
  the commissioner course editor
- the local browser run had no runtime errors; its single warning was the
  expected local-only Supabase warning

The visual test used `VITE_LOCAL_ONLY=true`, a development-only override added
to `src/lib/supabaseClient.js`. It cannot disable Supabase in a production build.

## Owner deployment

Do not deploy until the diff and migration have been reviewed.

1. `npx --no-install supabase db push --linked`
2. `supabase secrets set UNSPLASH_ACCESS_KEY=...`
3. `supabase functions deploy course-image`
4. `npm run backfill:course-images -- --dry-run`
5. `npm run backfill:course-images`

The live backfill requires `SUPABASE_SERVICE_ROLE_KEY`; the browser-facing Vite
environment must never receive that key.

After deployment, verify an uncached NCRDB course end to end, confirm its credit
link opens the photographer profile, confirm curated-photo removal survives a
backfill, and inspect the quota table after intentionally exceeding the daily
limit with a test user.
