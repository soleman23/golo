import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/http.ts'
import { cacheIsFresh } from '../_shared/courseMatching.ts'
import { resolveCoursePhoto } from '../_shared/coursePhotos.ts'

/**
 * Resolve a hotlinked Unsplash photo and stamp its URL/credit metadata into the
 * shared cache and public.courses.
 *
 * POST { courseId, name?, location? }
 *   -> { imageUrl, source, attribution, attributionUrl, cached }
 *
 * Automatic photos must remain hotlinked to comply with Unsplash's API rules.
 * Only curated admin uploads are copied into the app-owned Storage bucket.
 * Successful lookups are held for 30 days, genuine misses for 24 hours, and
 * provider outages for 15 minutes. Curated uploads are never overwritten.
 *
 * Because lookups consume a provider quota, the endpoint requires a signed-in
 * user or the server-only service role used by the backfill script. The public
 * anon key alone is never sufficient.
 */

const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NO_MATCH_TTL_MS = 24 * 60 * 60 * 1000
const PROVIDER_ERROR_TTL_MS = 15 * 60 * 1000
const USER_DAILY_LOOKUP_LIMIT = 20
const COURSE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const NOT_CURATED = 'image_source.is.null,image_source.neq.curated'

const adminClient = () => {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function callerIsAuthorized(req: Request) {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] ?? ''
  if (!url || !anonKey || !bearer) return null

  if (serviceRoleKey && bearer === serviceRoleKey) return { kind: 'service' as const }

  const scoped = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await scoped.auth.getUser()
  return !error && data.user ? { kind: 'user' as const, userId: data.user.id } : null
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

  const courseId = String(body.courseId ?? '').trim()
  if (!COURSE_ID_RE.test(courseId)) {
    return jsonResponse({ error: 'invalid_request', message: 'courseId must be a course slug.' }, 400)
  }
  const name = String(body.name ?? '').trim().slice(0, 160)
  const location = String(body.location ?? '').trim().slice(0, 160)

  const supabase = adminClient()
  if (!supabase) return jsonResponse({ error: 'not_configured' }, 500)
  const caller = await callerIsAuthorized(req)
  if (!caller) {
    return jsonResponse({ error: 'unauthorized', message: 'Sign in to load course photos.' }, 401)
  }

  const { data: course, error: courseError } = await supabase
    .from('courses')
    .select('id, name, location, image_url, image_source, image_attribution, image_attribution_url')
    .eq('id', courseId)
    .maybeSingle()
  if (courseError) {
    console.error('[course-image] course read', courseError)
    return jsonResponse({ error: 'cache_unavailable' }, 502)
  }

  if (course?.image_source === 'curated' && course.image_url) {
    return jsonResponse({
      imageUrl: course.image_url,
      source: 'curated',
      attribution: course.image_attribution ?? null,
      attributionUrl: course.image_attribution_url ?? null,
      cached: true,
    })
  }

  const { data: cached, error: cacheReadError } = await supabase
    .from('course_image_cache')
    .select('image_url, image_source, image_attribution, image_attribution_url, fetched_at, retry_ttl_ms')
    .eq('course_id', courseId)
    .maybeSingle()
  if (cacheReadError) {
    // Never call the provider when its cost-control cache is unavailable.
    console.error('[course-image] cache read', cacheReadError)
    return jsonResponse({ error: 'cache_unavailable' }, 502)
  }

  if (cached?.image_url && cacheIsFresh(cached.fetched_at, Date.now(), IMAGE_TTL_MS)) {
    return jsonResponse({
      imageUrl: cached.image_url,
      source: cached.image_source ?? null,
      attribution: cached.image_attribution ?? null,
      attributionUrl: cached.image_attribution_url ?? null,
      cached: true,
    })
  }
  if (cached && !cached.image_url) {
    const ttl = Number(cached.retry_ttl_ms) || NO_MATCH_TTL_MS
    if (cacheIsFresh(cached.fetched_at, Date.now(), ttl)) {
      return jsonResponse({
        imageUrl: null,
        source: null,
        attribution: null,
        attributionUrl: null,
        cached: true,
      })
    }
  }

  const hint = {
    // Stored catalogue data is authoritative and cannot be poisoned by a caller.
    name: course?.name || name,
    location: course?.location || location,
  }
  if (!hint.name) {
    return jsonResponse({ error: 'invalid_request', message: 'A course name is required.' }, 400)
  }

  // Cache hits are free. Only consume quota immediately before a provider call;
  // the service-role backfill has its own deliberate server-side access path.
  if (caller.kind === 'user') {
    const { data: withinQuota, error: quotaError } = await supabase.rpc('consume_course_image_quota', {
      p_user_id: caller.userId,
      p_daily_limit: USER_DAILY_LOOKUP_LIMIT,
    })
    if (quotaError) {
      console.error('[course-image] quota', quotaError)
      return jsonResponse({ error: 'quota_unavailable' }, 502)
    }
    if (!withinQuota) {
      return jsonResponse(
        { error: 'rate_limited', message: 'Daily course-photo lookup limit reached.' },
        429,
      )
    }
  }

  const cacheMiss = async (ttlMs: number) => {
    const { error } = await supabase.from('course_image_cache').upsert({
      course_id: courseId,
      image_url: null,
      image_source: null,
      image_attribution: null,
      image_attribution_url: null,
      retry_ttl_ms: ttlMs,
      fetched_at: new Date().toISOString(),
    })
    if (error) console.error('[course-image] cache miss', error)
  }

  const resolution = await resolveCoursePhoto(hint, {
    unsplashKey: Deno.env.get('UNSPLASH_ACCESS_KEY') ?? '',
  })
  if (!resolution.ok) {
    if (resolution.reason !== 'no_provider') {
      await cacheMiss(resolution.reason === 'no_match' ? NO_MATCH_TTL_MS : PROVIDER_ERROR_TTL_MS)
    }
    return jsonResponse({
      imageUrl: null,
      source: null,
      attribution: null,
      attributionUrl: null,
      cached: false,
    })
  }

  const photo = resolution.photo
  const stampedAt = new Date().toISOString()
  const { error: cacheError } = await supabase.from('course_image_cache').upsert({
    course_id: courseId,
    image_url: photo.url,
    image_source: photo.source,
    image_attribution: photo.attribution,
    image_attribution_url: photo.attributionUrl,
    retry_ttl_ms: null,
    fetched_at: stampedAt,
  })
  if (cacheError) {
    console.error('[course-image] cache write', cacheError)
    return jsonResponse({ error: 'cache_unavailable' }, 502)
  }

  if (course) {
    const { error: stampError } = await supabase
      .from('courses')
      .update({
        image_url: photo.url,
        image_source: photo.source,
        image_attribution: photo.attribution,
        image_attribution_url: photo.attributionUrl,
        image_fetched_at: stampedAt,
      })
      .eq('id', courseId)
      .or(NOT_CURATED)
    if (stampError) console.error('[course-image] course stamp', stampError)
  }

  return jsonResponse({
    imageUrl: photo.url,
    source: photo.source,
    attribution: photo.attribution,
    attributionUrl: photo.attributionUrl,
    cached: false,
  })
})
