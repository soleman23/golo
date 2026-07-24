/**
 * Course photography resolver.
 *
 * Unsplash is intentionally the only automatic provider. Its API requires the
 * returned `photo.urls.*` URL to be hotlinked, so callers store that URL as
 * metadata and browsers load the bytes directly from Unsplash. Do not proxy or
 * copy the image into Supabase Storage. Curated admin uploads remain in the
 * app-owned `course-images` bucket.
 */

export type PhotoHint = {
  name: string
  location?: string
}

export type ResolvedPhoto = {
  url: string
  source: 'unsplash'
  attribution: string
  attributionUrl: string
}

export type PhotoResolution =
  | { ok: true; photo: ResolvedPhoto }
  | { ok: false; reason: 'no_match' | 'provider_error' | 'no_provider' }

const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos'
const PROVIDER_TIMEOUT_MS = 10_000
const PHOTO_MAX_WIDTH = 1600
const UNSPLASH_UTM_SOURCE = 'golo_golf'

type UnsplashPhoto = {
  urls?: { raw?: string; regular?: string }
  user?: { name?: string; links?: { html?: string } }
}

async function fetchJson(url: string, init: RequestInit): Promise<{ data: unknown; failed: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500
      return { data: null, failed: transient }
    }
    return { data: await res.json(), failed: false }
  } catch {
    return { data: null, failed: true }
  } finally {
    clearTimeout(timer)
  }
}

/** Add the referral parameters Unsplash requires on links back to a creator. */
export function unsplashAttributionUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ''))
    if (url.protocol !== 'https:') return ''
    url.searchParams.set('utm_source', UNSPLASH_UTM_SOURCE)
    url.searchParams.set('utm_medium', 'referral')
    return url.toString()
  } catch {
    return ''
  }
}

/** Resize through Imgix while preserving the API's view-tracking `ixid`. */
export function unsplashImageUrl(urls: UnsplashPhoto['urls']) {
  const raw = urls?.raw
  if (!raw) return urls?.regular ?? ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return ''
    url.searchParams.set('w', String(PHOTO_MAX_WIDTH))
    url.searchParams.set('fit', 'crop')
    url.searchParams.set('q', '80')
    return url.toString()
  } catch {
    return ''
  }
}

/** Unsplash generic golf scenery, hotlinked exactly as its API requires. */
export async function resolveUnsplashPhoto(hint: PhotoHint, accessKey: string): Promise<PhotoResolution> {
  const query = `${hint.name} ${hint.location ?? ''} golf course`.replace(/\s+/g, ' ').trim()
  if (!query) return { ok: false, reason: 'no_match' }

  const url = `${UNSPLASH_SEARCH_URL}?query=${encodeURIComponent(query)}&orientation=landscape&per_page=1&content_filter=high`
  const search = await fetchJson(url, {
    headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
  })
  if (search.failed) return { ok: false, reason: 'provider_error' }

  const photo = (search.data as { results?: UnsplashPhoto[] } | null)?.results?.[0]
  const imageUrl = unsplashImageUrl(photo?.urls)
  const creatorName = String(photo?.user?.name ?? '').trim()
  const creatorUrl = unsplashAttributionUrl(photo?.user?.links?.html)

  // An uncredited API image is not usable: the UI cannot meet Unsplash's
  // attribution requirement without both the creator name and profile link.
  if (!imageUrl || !creatorName || !creatorUrl) return { ok: false, reason: 'no_match' }

  return {
    ok: true,
    photo: {
      url: imageUrl,
      source: 'unsplash',
      attribution: `Photo by ${creatorName} on Unsplash`,
      attributionUrl: creatorUrl,
    },
  }
}

export async function resolveCoursePhoto(
  hint: PhotoHint,
  keys: { unsplashKey?: string },
): Promise<PhotoResolution> {
  if (!keys.unsplashKey) return { ok: false, reason: 'no_provider' }
  return resolveUnsplashPhoto(hint, keys.unsplashKey)
}
