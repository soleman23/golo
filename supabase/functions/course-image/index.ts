import { corsHeaders, jsonResponse } from '../_shared/http.ts'

/**
 * Course photo resolver.
 *
 * Given a course id (plus name/location hints for courses not yet persisted —
 * e.g. an NCRDB import that only exists in the client's catalogue), find a
 * real photo of the course, cache it in the `course-images` Storage bucket,
 * and stamp the courses row. Resolution order:
 *
 *   1. courses.image_url already set          -> return it (cache hit)
 *   2. Unsplash search "<name> golf course"   -> download, re-host, update row
 *   3. nothing found / not configured         -> source 'fallback', null url
 *
 * Re-hosting in our own bucket (instead of hotlinking) keeps images stable,
 * avoids per-view API traffic, and satisfies Unsplash's production guidelines.
 * A curated image (image_source = 'curated', set via admin_set_course_image)
 * is never overwritten.
 *
 * Secrets (supabase secrets set):
 *   UNSPLASH_ACCESS_KEY        required for fetching; without it the function
 *                              returns { imageUrl: null, source: 'fallback' }
 *   SUPABASE_URL               auto-provided
 *   SUPABASE_SERVICE_ROLE_KEY  auto-provided (also accepted as the bearer for
 *                              trusted backfill calls)
 */

const BUCKET = 'course-images'
const TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const UNSPLASH_ACCESS_KEY = Deno.env.get('UNSPLASH_ACCESS_KEY') ?? ''

const cap = (value: unknown, max = 160) => String(value ?? '').trim().slice(0, max)

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

type CourseRow = {
  id: string
  name: string | null
  location: string | null
  image_url: string | null
  image_source: string | null
  image_attribution: string | null
}

/** Callers must be a signed-in user, or the service role itself (backfill). */
async function authorize(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return false
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: token, Authorization: auth },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return res.ok
}

async function findCourse(courseId: string): Promise<CourseRow | null> {
  const url = `${SUPABASE_URL}/rest/v1/courses?id=eq.${encodeURIComponent(courseId)}` +
    '&select=id,name,location,image_url,image_source,image_attribution&limit=1'
  const res = await fetch(url, { headers: serviceHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`course lookup failed: ${res.status}`)
  const rows = await res.json()
  return Array.isArray(rows) && rows.length ? (rows[0] as CourseRow) : null
}

async function stampCourse(courseId: string, fields: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/courses?id=eq.${encodeURIComponent(courseId)}`,
    { method: 'PATCH', headers: serviceHeaders, body: JSON.stringify(fields), signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!res.ok) throw new Error(`course update failed: ${res.status}`)
}

type UnsplashPhoto = {
  urls: { raw: string }
  user: { name: string }
  links: { download_location: string }
}

async function searchUnsplash(query: string): Promise<UnsplashPhoto | null> {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
    '&orientation=landscape&per_page=1&content_filter=high'
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`unsplash search failed: ${res.status}`)
  const data = await res.json()
  const photo = data?.results?.[0]
  return photo?.urls?.raw ? (photo as UnsplashPhoto) : null
}

/** Download the photo and re-host it in our bucket. Returns the public URL. */
async function cachePhoto(photo: UnsplashPhoto, courseId: string): Promise<string> {
  const imageUrl = `${photo.urls.raw}&w=1600&q=80&fm=jpg&fit=max`
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`photo download failed: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`photo size out of bounds: ${bytes.byteLength}`)
  }

  const path = `${courseId}.jpg`
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!upload.ok) throw new Error(`storage upload failed: ${upload.status}`)

  // Unsplash attribution guideline: ping the download endpoint (best effort).
  fetch(`${photo.links.download_location}?client_id=${UNSPLASH_ACCESS_KEY}`).catch(() => {})

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_body', message: 'Expected a JSON body.' }, 400)
  }

  const courseId = cap(body.courseId ?? body.course_id, 120)
  if (!courseId) return jsonResponse({ error: 'missing_course_id' }, 400)

  try {
    if (!(await authorize(req))) return jsonResponse({ error: 'unauthorized' }, 401)
  } catch {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  try {
    const course = await findCourse(courseId)
    const name = cap(body.name, 120) || course?.name || ''
    const location = cap(body.location, 120) || course?.location || ''

    // 1. cache hit — curated images always win
    if (course?.image_url) {
      return jsonResponse({
        imageUrl: course.image_url,
        source: course.image_source ?? 'unknown',
        attribution: course.image_attribution,
        cached: true,
      })
    }

    // 2. fetch from Unsplash
    if (UNSPLASH_ACCESS_KEY && name) {
      const query = `${name} golf course ${location}`.trim()
      const photo = await searchUnsplash(query)
      if (photo) {
        const publicUrl = await cachePhoto(photo, courseId)
        const attribution = `Photo by ${photo.user.name} on Unsplash`
        if (course) {
          await stampCourse(courseId, {
            image_url: publicUrl,
            image_source: 'unsplash',
            image_attribution: attribution,
            image_fetched_at: new Date().toISOString(),
          })
        }
        return jsonResponse({ imageUrl: publicUrl, source: 'unsplash', attribution, cached: false })
      }
    }

    // 3. nothing usable — remember we tried so we don't hammer the API
    if (course) {
      await stampCourse(courseId, { image_source: 'fallback', image_fetched_at: new Date().toISOString() })
    }
    return jsonResponse({
      imageUrl: null,
      source: UNSPLASH_ACCESS_KEY ? 'fallback' : 'not_configured',
      attribution: null,
      cached: false,
    })
  } catch (err) {
    return jsonResponse({ error: 'course_image_failed', message: String(err?.message ?? err) }, 502)
  }
})
