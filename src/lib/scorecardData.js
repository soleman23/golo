import { supabase, isSupabaseConfigured } from './supabaseClient'

/**
 * Client for the golfcourseapi-holes edge function, which fills the one gap
 * NCRDB leaves — per-hole yardage — from GolfCourseAPI.com. The function does
 * the GolfCourseAPI search, fetch and Supabase caching server-side (service
 * role), so here we just ask for a course's tee/hole payload by name.
 */

async function invoke(body) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Backend not configured') }
  }
  const { data, error } = await supabase.functions.invoke('golfcourseapi-holes', { body })
  if (error) {
    let message = error.message
    try {
      const payload = await error.context?.json()
      if (payload?.message) message = payload.message
      else if (payload?.error) message = payload.error
    } catch {
      // Keep the generic FunctionsHttpError message when no JSON payload exists.
    }
    return { data: null, error: new Error(message) }
  }
  return { data, error: null }
}

/**
 * Fetch the GolfCourseAPI tee/hole payload for a course, keyed and cached by the
 * app's own course id. Returns the tees object ({ male: [...], female: [...] })
 * or null when there's no match / no backend — callers fall back to NCRDB-only.
 * @param {{ id?: string, name?: string }} course
 * @returns {Promise<object | null>}
 */
export async function getHoleData(course) {
  const id = String(course?.id ?? '').trim()
  const name = String(course?.name ?? '').trim()
  if (!id || !name) return null

  const { data, error } = await invoke({ action: 'holes', courseId: id, courseName: name })
  if (error) {
    console.warn('[scorecardData] holes fetch failed for', name, '—', error.message)
    return null
  }
  return data?.tees ?? null
}

const normalizeTeeName = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The tee whose 18-hole total yardage is closest to `targetYards`. */
function closestTeeByYards(teeList, targetYards) {
  let best = null
  let bestDiff = Infinity
  for (const tee of teeList) {
    const yards = Number(tee?.total_yards)
    if (!Number.isFinite(yards) || yards <= 0) continue
    const diff = Math.abs(yards - targetYards)
    if (diff < bestDiff) {
      bestDiff = diff
      best = tee
    }
  }
  return best
}

/**
 * Pick the holes array for a given tee out of a GolfCourseAPI tees object.
 *
 * NCRDB and GolfCourseAPI name tees differently (e.g. NCRDB "Blue" vs
 * GolfCourseAPI "ROYAL BLUE"/"GREEN"), so an exact name hit is used first, then
 * — when the selected tee's total yardage is known — the tee closest in total
 * yardage (a far more reliable cross-source match than fuzzy names), then a
 * name-contains match, then the first (longest) tee.
 * @param {object | null} teesData
 * @param {string} teeName
 * @param {'male' | 'female'} [gender] — men's tees only per project convention
 * @param {number | null} [targetYards] — selected tee's 18-hole total, if known
 * @returns {Array<{ par?: number, yardage?: number, handicap?: number }> | null}
 */
export function getHolesForTee(teesData, teeName, gender = 'male', targetYards = null) {
  if (!teesData) return null
  const teeList = teesData[gender] ?? teesData.male ?? []
  if (!Array.isArray(teeList) || !teeList.length) return null

  const target = normalizeTeeName(teeName)
  const exact = target ? teeList.find((t) => normalizeTeeName(t?.tee_name) === target) : null
  const byYards =
    !exact && Number.isFinite(targetYards) && targetYards > 0
      ? closestTeeByYards(teeList, targetYards)
      : null
  const contains =
    !exact && !byYards && target
      ? teeList.find((t) => {
          const name = normalizeTeeName(t?.tee_name)
          return name && (name.includes(target) || target.includes(name))
        })
      : null
  const match = exact ?? byYards ?? contains ?? teeList[0]
  return Array.isArray(match?.holes) ? match.holes : null
}

const validYardage = (value) => Number.isFinite(value) && value > 0 && value < 1000
const validPar = (value) => Number.isInteger(value) && value >= 3 && value <= 6
const validStrokeIndex = (value) => Number.isInteger(value) && value >= 1 && value <= 18

/**
 * Build { [hole]: value } maps (holes 1..18) for a tee — par, stroke index
 * (GolfCourseAPI `handicap`) and yardage — mirroring the shape of
 * round.pars / round.strokeIndex / round.yardages. GolfCourseAPI returns holes
 * in order, so hole number is index + 1. Par and stroke index are the same
 * across tees; only yardage is tee-specific. Returns null when there's no tee.
 * @param {object | null} teesData
 * @param {string} teeName
 * @param {'male' | 'female'} [gender]
 * @param {number | null} [targetYards] — selected tee's 18-hole total, if known
 * @returns {{ pars: Record<number, number>, strokeIndex: Record<number, number>, yardages: Record<number, number> } | null}
 */
export function holeCardFromTees(teesData, teeName, gender = 'male', targetYards = null) {
  const holes = getHolesForTee(teesData, teeName, gender, targetYards)
  if (!holes) return null
  const pars = {}
  const strokeIndex = {}
  const yardages = {}
  holes.slice(0, 18).forEach((hole, index) => {
    const n = index + 1
    const par = Number(hole?.par)
    const si = Number(hole?.handicap)
    const yards = Number(hole?.yardage)
    if (validPar(par)) pars[n] = par
    if (validStrokeIndex(si)) strokeIndex[n] = si
    if (validYardage(yards)) yardages[n] = yards
  })
  return { pars, strokeIndex, yardages }
}

/**
 * Convenience wrapper: just the { [hole]: yardage } map, or null when empty.
 * @returns {Record<number, number> | null}
 */
export function yardageMapFromTees(teesData, teeName, gender = 'male', targetYards = null) {
  const card = holeCardFromTees(teesData, teeName, gender, targetYards)
  if (!card) return null
  return Object.keys(card.yardages).length ? card.yardages : null
}
