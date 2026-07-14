/**
 * One-time helper: forward-geocode course locations and print SQL UPDATE statements.
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY in the environment.
 *
 * Usage:
 *   node scripts/geocode-courses.mjs
 */

const COURSE_LOCATIONS = [
  { id: 'pinehurst', loc: 'Pinehurst, NC' },
  { id: 'harbor', loc: 'Pawleys Island, SC' },
  { id: 'lincoln', loc: 'San Francisco, CA' },
  { id: 'tetherow', loc: 'Bend, OR' },
  { id: 'losttracks', loc: 'Bend, OR' },
]

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

async function forwardGeocode(query) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/reverse-geocode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Geocode failed for "${query}": ${res.status}`)
  return res.json()
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_* equivalents).')
    process.exit(1)
  }

  for (const course of COURSE_LOCATIONS) {
    const coords = await forwardGeocode(course.loc)
    console.log(
      `update public.courses set latitude = ${coords.lat}, longitude = ${coords.lng} where id = '${course.id}';`,
    )
    await new Promise((r) => setTimeout(r, 1100))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
