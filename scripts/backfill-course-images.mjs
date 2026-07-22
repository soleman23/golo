#!/usr/bin/env node
/**
 * Backfill course photos for every catalogue row that doesn't have one yet.
 * Calls the deployed course-image edge function once per course (which caches
 * the photo in the course-images bucket and stamps the row), so re-runs are
 * cheap — already-imaged courses return as cache hits.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   node scripts/backfill-course-images.mjs
 *
 * Optional: DELAY_MS=1500 (politeness delay between Unsplash calls),
 *           ONLY_MISSING=false to also re-hit 'fallback' rows.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DELAY_MS = Number(process.env.DELAY_MS ?? 1500)
const ONLY_MISSING = (process.env.ONLY_MISSING ?? 'true') !== 'false'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/courses?select=id,name,location,image_url,image_source&order=name`,
    { headers },
  )
  if (!res.ok) throw new Error(`course list failed: ${res.status} ${await res.text()}`)
  const courses = await res.json()

  const targets = courses.filter((c) =>
    ONLY_MISSING ? !c.image_url && c.image_source !== 'fallback' : !c.image_url,
  )
  console.log(`${courses.length} courses, ${targets.length} need an image.`)

  let ok = 0
  let fallback = 0
  let failed = 0
  for (const course of targets) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/course-image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ courseId: course.id, name: course.name, location: course.location }),
      })
      const data = await r.json()
      if (r.ok && data.imageUrl) {
        ok += 1
        console.log(`  ok        ${course.id} -> ${data.imageUrl}`)
      } else if (r.ok) {
        fallback += 1
        console.log(`  fallback  ${course.id} (${data.source})`)
      } else {
        failed += 1
        console.log(`  FAILED    ${course.id}: ${data.message ?? data.error}`)
      }
    } catch (err) {
      failed += 1
      console.log(`  FAILED    ${course.id}: ${err.message}`)
    }
    await sleep(DELAY_MS)
  }
  console.log(`Done. ${ok} imaged, ${fallback} fallback, ${failed} failed.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
