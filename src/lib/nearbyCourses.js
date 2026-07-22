import { defaultHomeCourse } from './homeCourse.js'

const US_STATE_ABBREVS = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
}

/** @param {string | undefined | null} loc */
export function parseCourseRegion(loc) {
  const text = String(loc ?? '').trim()
  if (!text) return { city: '', state: '' }
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return { city: parts[0] ?? '', state: '' }
  return { city: parts[0], state: parts[parts.length - 1] }
}

function normalizeState(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.length === 2) return raw.toUpperCase()
  return US_STATE_ABBREVS[raw.toLowerCase()] ?? raw
}

/** @param {string | undefined | null} courseLoc @param {{ city?: string, state?: string, stateCode?: string }} region */
export function regionMatches(courseLoc, region) {
  if (!region?.city && !region?.state && !region?.stateCode) return false
  const parsed = parseCourseRegion(courseLoc)
  const courseState = normalizeState(parsed.state)
  const targetState = normalizeState(region.stateCode || region.state)
  const cityNeedle = String(region.city ?? '').trim().toLowerCase()
  const courseCity = parsed.city.toLowerCase()

  const stateMatch = !targetState || courseState.toUpperCase() === targetState.toUpperCase()
  const cityMatch =
    !cityNeedle ||
    courseCity === cityNeedle ||
    courseCity.includes(cityNeedle) ||
    cityNeedle.includes(courseCity)

  return stateMatch && cityMatch
}

/** @param {Array<object>} courses @param {{ city?: string, state?: string, stateCode?: string }} region */
export function sortCoursesByRegion(courses, region) {
  if (!region) return courses
  const matching = []
  const rest = []
  for (const course of courses) {
    if (regionMatches(course.loc, region)) matching.push(course)
    else rest.push(course)
  }
  return [...matching, ...rest]
}

export function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const r = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatDistance(miles) {
  if (!Number.isFinite(miles)) return null
  if (miles < 0.1) return '<0.1 mi'
  if (miles > 50) return '>50 mi'
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}

/** @param {Array<object>} courses */
export function sortCoursesByDistance(courses, userLat, userLng) {
  const withDistance = courses.map((course) => {
    const lat = course.latitude ?? course.lat
    const lng = course.longitude ?? course.lng
    const distance =
      lat != null && lng != null && userLat != null && userLng != null
        ? haversineMiles(userLat, userLng, lat, lng)
        : Infinity
    return { course, distance }
  })
  withDistance.sort((a, b) => a.distance - b.distance)
  return withDistance.map((row) => row.course)
}

/** @param {object | null | undefined} course @param {number | null | undefined} userLat @param {number | null | undefined} userLng */
export function courseDistanceLabel(course, userLat, userLng) {
  const lat = course?.latitude ?? course?.lat
  const lng = course?.longitude ?? course?.lng
  if (lat == null || lng == null || userLat == null || userLng == null) return null
  return formatDistance(haversineMiles(userLat, userLng, lat, lng))
}

/**
 * Pin home course first, then sort the rest by distance or region.
 * @param {Array<object>} courses
 * @param {{ homeClub?: string, rounds?: Array<object>, region?: object, userLat?: number, userLng?: number }} opts
 */
export function sortCoursesForNearby(courses, opts = {}) {
  const { homeClub, rounds, region, userLat, userLng } = opts
  let sorted = [...courses]
  if (userLat != null && userLng != null) {
    sorted = sortCoursesByDistance(sorted, userLat, userLng)
  } else if (region) {
    sorted = sortCoursesByRegion(sorted, region)
  }
  const home = defaultHomeCourse(sorted, { homeClub, rounds })
  if (!home) return sorted
  const index = sorted.findIndex((c) => c.id === home.id)
  if (index <= 0) return sorted
  return [sorted[index], ...sorted.slice(0, index), ...sorted.slice(index + 1)]
}

/** @param {Array<object>} courses @param {number} userLat @param {number} userLng */
export function inferRegionFromNearestCourse(courses, userLat, userLng) {
  if (userLat == null || userLng == null || !courses?.length) return null
  const nearest = sortCoursesByDistance(courses, userLat, userLng)[0]
  if (!nearest?.loc) return null
  const { city, state } = parseCourseRegion(nearest.loc)
  if (!city && !state) return null
  return { city, state, stateCode: state }
}

/** Fill missing city/state from the nearest catalogue course (for NCRDB regional search). */
export function enrichRegionWithCatalog(region, catalog, fallbackCatalog) {
  if (!region) return region
  let next = region
  if (!next.city) {
    const inferred = inferRegionFromNearestCourse(catalog, region.lat, region.lng)
    if (inferred) next = { ...next, ...inferred }
  }
  if (!next.city && fallbackCatalog && fallbackCatalog !== catalog) {
    const inferred = inferRegionFromNearestCourse(fallbackCatalog, region.lat, region.lng)
    if (inferred) next = { ...next, ...inferred }
  }
  return next
}

/** Max parallel NCRDB searches per nearby discovery (avoids 1→N fan-out). */
export const MAX_NEARBY_SEARCH_QUERIES = 4

/** Build NCRDB search payloads for regional nearby discovery. */
export function buildNearbySearchQueries(region, catalog) {
  const city = String(region?.city ?? '').trim()
  const queries = []
  const seen = new Set()
  const push = (clubName) => {
    const name = String(clubName ?? '').trim()
    if (!name) return
    const key = name.toLowerCase()
    if (seen.has(key) || queries.length >= MAX_NEARBY_SEARCH_QUERIES) return
    seen.add(key)
    queries.push({ clubName: name, clubCountry: 'USA' })
  }

  if (city) {
    push(`${city} Golf`)
    push(`${city} Golf Club`)
    for (const term of extraRegionalSearchTerms(city)) push(term)
  }
  const nearest =
    region?.lat != null && region?.lng != null
      ? sortCoursesByDistance(catalog, region.lat, region.lng)
      : catalog
  for (const course of nearest) {
    if (queries.length >= MAX_NEARBY_SEARCH_QUERIES) break
    push(course?.name)
  }
  return queries
}

/** NCRDB hits use stateDisplay; match state without requiring same city. */
export function ncrdbHitMatchesRegion(hit, region) {
  if (!region?.state && !region?.stateCode) return true
  const hitState = normalizeState(hit?.stateDisplay ?? hit?.state ?? '')
  const targetState = normalizeState(region.stateCode || region.state)
  if (!targetState || !hitState) return false
  return hitState.toUpperCase() === targetState.toUpperCase()
}

/** Prefer hits in the user's city, then same state. */
export function sortNcrdbHitsByRegion(hits, region) {
  if (!region?.city) return hits
  const cityNeedle = String(region.city).trim().toLowerCase()
  return [...hits].sort((a, b) => {
    const aCity = String(a?.city ?? '').toLowerCase()
    const bCity = String(b?.city ?? '').toLowerCase()
    const aMatch = aCity === cityNeedle || aCity.includes(cityNeedle) ? 0 : 1
    const bMatch = bCity === cityNeedle || bCity.includes(cityNeedle) ? 0 : 1
    return aMatch - bMatch
  })
}

/** Extra NCRDB name searches for metros where city-only filtering is too narrow. */
const EXTRA_TERMS_BY_CITY = {
  bend: ['Pronghorn', 'Juniper', 'Broken Top', 'Sunriver', 'Eagle Crest', 'Widgi', 'Brasada', 'Redmond'],
}

export function extraRegionalSearchTerms(city) {
  const key = String(city ?? '').trim().toLowerCase()
  return EXTRA_TERMS_BY_CITY[key] ?? []
}

export function catalogCourseKeys(catalog) {
  return new Set(
    (catalog ?? []).flatMap((c) => [
      c.ghinCourseId ? `ncrdb:${c.ghinCourseId}` : '',
      `${String(c.name ?? '').trim()}|${String(c.loc ?? '').trim()}`.toLowerCase(),
    ]).filter(Boolean),
  )
}

/**
 * @param {Array<object>} catalog
 * @param {Array<object>} ncrdbHits
 * @param {{ getId?: (hit: object) => string, getName?: (hit: object) => string, getLoc?: (hit: object) => string }} [helpers]
 */
export function dedupeNcrdbAgainstCatalog(catalog, ncrdbHits, helpers = {}) {
  const getId = helpers.getId ?? ((hit) => String(hit?.courseID ?? hit?.courseId ?? '').trim())
  const getName = helpers.getName ?? ((hit) => String(hit?.fullName ?? hit?.name ?? '').trim())
  const getLoc = helpers.getLoc ?? ((hit) => {
    const city = String(hit?.city ?? '').trim()
    const state = String(hit?.stateDisplay ?? hit?.state ?? '').trim()
    return [city, state].filter(Boolean).join(', ')
  })

  const keys = catalogCourseKeys(catalog)
  return (ncrdbHits ?? []).filter((hit) => {
    const id = getId(hit)
    const name = getName(hit)
    const loc = getLoc(hit)
    if (!id || !name) return false
    return !keys.has(`ncrdb:${id}`) && !keys.has(`${name}|${loc}`.toLowerCase())
  })
}
