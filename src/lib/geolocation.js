const GEO_CACHE_KEY = 'golo:geo'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export const GEO_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
}

export function isGeolocationSupported() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

/** @returns {{ lat: number, lng: number, city?: string, state?: string, stateCode?: string, ts: number } | null} */
export function readCachedGeo() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null
    if (typeof parsed.ts === 'number' && Date.now() - parsed.ts > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

/** @param {{ lat: number, lng: number, city?: string, state?: string, stateCode?: string }} geo */
export function writeCachedGeo(geo) {
  try {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city ?? '',
        state: geo.state ?? geo.stateCode ?? '',
        stateCode: geo.stateCode ?? geo.state ?? '',
        ts: Date.now(),
      }),
    )
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearCachedGeo() {
  try {
    localStorage.removeItem(GEO_CACHE_KEY)
  } catch {
    // Ignore.
  }
}

/**
 * Wrap navigator.geolocation.getCurrentPosition.
 * @param {{ timeoutMs?: number, maxAgeMs?: number }} [opts]
 * @returns {Promise<{ lat: number, lng: number }>}
 */
export function getDevicePosition({ timeoutMs = 10_000, maxAgeMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject(Object.assign(new Error('Geolocation is not supported'), { code: 0 }))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maxAgeMs },
    )
  })
}
