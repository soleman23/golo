# Cursor task: wire course photos into the GoLo UI

You are working in the GoLo repo (React + Vite frontend, Supabase backend, Netlify hosting).
The backend for course photos is already built on this branch. Your job is the UI wiring.
Do not redesign anything — follow `CLAUDE.md` ("glass over turf": course photo under a
180° dark scrim, frosted glass surfaces, lime `#d4f23a` accent).

## What already exists (do not rebuild)

- `supabase/migrations/0032_course_images.sql` — adds `image_url`, `image_source`,
  `image_attribution`, `image_fetched_at` to `public.courses`; creates the public
  `course-images` Storage bucket (admin-only writes); recreates `admin_list_courses()`
  with the image columns; adds `admin_set_course_image(p_id, p_image_url, p_source, p_attribution)`.
- `supabase/functions/course-image/index.ts` — POST `{ courseId, name?, location? }`.
  Returns `{ imageUrl, source, attribution, cached }`. Caches the photo in the bucket and
  stamps the courses row. Never overwrites `image_source = 'curated'`.
- `src/lib/courseImages.js` — `getCourseImage()` now prefers `image_url` / `imageUrl`
  over the legacy static `bg`. Any code already calling `getCourseImage(course)` will
  show the real photo automatically once the course object carries `image_url`.
- `src/lib/courseImageFetch.js` — `fetchCourseImage(course)` → `{ imageUrl, ... } | null`.
  Use this; do not call the edge function directly.
- `scripts/backfill-course-images.mjs` — one-off backfill (already run by maintainer).

## Tasks

### 1. Setup Wizard — fetch a photo when an NCRDB course is selected
File: `src/pages/SetupWizard.jsx`, function `selectNcrdbCourse` (around line 1275).
The imported course is added to the local catalogue with a generic `bg`. After the
`importedCourse` object is built:

```js
fetchCourseImage({ id: importedCourse.id, name: importedCourse.name, location: importedCourse.loc })
  .then((img) => {
    if (!img?.imageUrl) return
    setCatalog((items) => items.map((item) =>
      item.id === importedCourse.id ? { ...item, image_url: img.imageUrl } : item))
  })
```

Fire-and-forget: never block selection on the fetch, never surface its errors.
The hero background (around line 1653) and `commit()`'s `courseBg` (around line 1443)
already use `getCourseImage(course)`, so they pick the photo up as soon as the
catalogue item carries `image_url`. Verify that `course` at line 1443/1653 is the
catalogue item (so the state update above flows through); if it's a stale snapshot,
read it from `catalog` by `st.courseId` instead.

### 2. Setup Wizard — thumbnails in the course picker
The catalogue list rows (the `<button key={c.id}>` around line 1796) and the NCRDB
search-result rows should each show a 48×48 rounded-12 thumbnail:
`getCourseImage(c)` as a CSS `backgroundImage`, `backgroundSize: 'cover'`, with the
existing glass styling. For NCRDB result rows (not yet in the catalogue) just use
the default image — do NOT fetch photos for unselected search results (API quota).

### 3. DB catalogue courses — ensure `image_url` reaches the client
Check `fetchCourses()` (used around line 843, likely in `src/lib/db/`): make sure the
PostgREST `select` includes `image_url` (or uses `select=*`). If it lists columns
explicitly, add `image_url`.

### 4. Scoring page background
Confirm the Scoring page background resolves through `getCourseImage(round)` or
`getCourseImage(course)`. The round payload stores `courseBg` at commit time; if a
photo was fetched AFTER commit, the stored `courseBg` is stale. Fix: on the scoring
page, resolve the image as `getCourseImage({ image_url: courseFromDb?.image_url, courseId, course: courseName, courseBg })`
— i.e. prefer a fresh `image_url` looked up from `public.courses` by `round.courseId`
(fetch once on mount), falling back to the stored `courseBg`. Keep the existing scrim.

### 5. Admin desk — curated image upload
In the admin course editor (uses `admin_list_courses` / `admin_upsert_course`):
- Show the course's current image (`image_url` else `bg`).
- Add an "Upload photo" button: upload to the `course-images` bucket at
  `<course_id>.jpg` via `supabase.storage.from('course-images').upload(path, file, { upsert: true, contentType })`,
  then call `supabase.rpc('admin_set_course_image', { p_id, p_image_url: publicUrl, p_source: 'curated', p_attribution: null })`.
- Add a "Remove photo" button: `admin_set_course_image` with `p_image_url: null`.
- The bucket RLS already gates writes to `is_app_admin()`; surface upload errors as-is.

### 6. Home + History cards (small)
Wherever a round card shows a course name with a background/thumbnail, pass the
course's `image_url` when available via `getCourseImage({ image_url, courseId, course: name, courseBg })`.
Do not add per-card edge-function calls — only use already-stored URLs.

## Acceptance checks
- Select an NCRDB course with no photo: within ~2s the wizard hero shows a real
  photo; starting the round carries it to the Scoring background.
- `courses.image_url` is set and the file exists in the `course-images` bucket.
- A course with `image_source='curated'` keeps its photo after re-selecting it.
- With Supabase env vars unset (local-only mode), everything degrades to the
  current static images with no console errors.
- `npm run build` passes; no new dependencies were added.

## Deploy checklist (for the human, not Cursor)
1. `supabase db push` (applies 0032)
2. `supabase secrets set UNSPLASH_ACCESS_KEY=...`
3. `supabase functions deploy course-image`
4. `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-course-images.mjs`
5. Merge branch; Netlify rebuilds from `main`.
