/**
 * One-off backfill: give every catalogue course a photo.
 *
 * Walks public.courses and POSTs each to the course-image edge function, which
 * does the resolving, caching and stamping. Courses whose photo is already
 * curated or cached come back `cached: true` and cost nothing, so re-running
 * this is safe and cheap — only genuinely new courses hit a paid provider.
 *
 * Usage:
 *   node scripts/backfill-course-images.mjs            # visible courses only
 *   node scripts/backfill-course-images.mjs --all      # every course
 *   node scripts/backfill-course-images.mjs --dry-run  # list what would run
 *
 * Live runs require SUPABASE_SERVICE_ROLE_KEY. It is sent only to the protected
 * edge function and must never be placed in a VITE_* environment variable.
 */

import { invokeEdgeFunction, requireSupabaseEnv } from './_shared.mjs'

const DELAY_MS = 400 // gentle on provider rate limits
const args = new Set(process.argv.slice(2))
const includeAll = args.has('--all')
const dryRun = args.has('--dry-run')

async function fetchCourses(env) {
  const filter = includeAll ? '' : '&visible_in_setup=eq.true'
  const res = await fetch(
    `${env.url}/rest/v1/courses?select=id,name,location,image_url,image_source${filter}&order=name`,
    { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` }, signal: AbortSignal.timeout(15_000) },
  )
  const rows = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(rows)) {
    console.error(`courses fetch failed: HTTP ${res.status} ${JSON.stringify(rows)?.slice(0, 300) ?? ''}`)
    process.exit(1)
  }
  return rows
}

async function main() {
  const env = requireSupabaseEnv()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!dryRun && !serviceRoleKey) {
    console.error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. The protected course-image endpoint ' +
        'requires this server-only credential for backfills.',
    )
    process.exit(1)
  }
  const courses = await fetchCourses(env)
  console.log(`${courses.length} course${courses.length === 1 ? '' : 's'} to process${dryRun ? ' (dry run)' : ''}\n`)

  const tally = { fetched: 0, cached: 0, curated: 0, none: 0, failed: 0 }

  for (const course of courses) {
    const label = `${course.name}${course.location ? ` (${course.location})` : ''}`

    if (course.image_source === 'curated' && course.image_url) {
      console.log(`  curated  ${label}`)
      tally.curated += 1
      continue
    }
    if (dryRun) {
      console.log(`  would fetch  ${label}`)
      continue
    }

    const res = await invokeEdgeFunction(
      { url: env.url, key: serviceRoleKey },
      'course-image',
      { courseId: course.id, name: course.name, location: course.location ?? '' },
      { timeoutMs: 30_000 },
    )

    if (!res.ok) {
      console.log(`  FAILED   ${label} — ${res.error}`)
      tally.failed += 1
    } else if (!res.json?.imageUrl) {
      console.log(`  no match ${label}`)
      tally.none += 1
    } else if (res.json.cached) {
      console.log(`  cached   ${label}`)
      tally.cached += 1
    } else {
      console.log(`  fetched  ${label} — ${res.json.source}`)
      tally.fetched += 1
    }

    await new Promise((r) => setTimeout(r, DELAY_MS))
  }

  if (dryRun) return
  console.log(
    `\nfetched ${tally.fetched} · cached ${tally.cached} · curated ${tally.curated} · ` +
      `no match ${tally.none} · failed ${tally.failed}`,
  )
  if (tally.failed) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
