import { supabase, isSupabaseConfigured } from './supabaseClient'
import { normalizeHoleRows } from './courseValidation'

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

function locationHint(location) {
  const parts = String(location ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  return {
    city: parts.length > 1 ? parts.at(-2) : '',
    state: parts.length > 1 ? parts.at(-1) : '',
  }
}

/**
 * Resolve a bundled/catalog course through the compatibility edge function.
 * NCRDB imports already arrive enriched and do not use this second call.
 */
export async function getHoleData(course) {
  const id = String(course?.id ?? '').trim()
  const name = String(course?.name ?? '').trim()
  if (!id || !name) {
    return { teesData: null, enrichment: { matched: false, reason: 'invalid_course' } }
  }

  const location = locationHint(course?.loc)
  const { data, error } = await invoke({
    action: 'holes',
    courseId: id,
    courseName: name,
    facility: course?.facility,
    course: course?.course,
    city: course?.city ?? location.city,
    state: course?.state ?? location.state,
  })
  if (error) {
    console.warn('[scorecardData] holes fetch failed for', name, '-', error.message)
    return { teesData: null, enrichment: { matched: false, reason: error.message } }
  }
  return {
    teesData: data?.tees ?? null,
    enrichment: {
      matched: !!data?.matched,
      reason: data?.reason,
      cached: !!data?.cached,
      source: 'golfcourseapi',
      matchScore: data?.matchScore,
    },
  }
}

const normalizeTeeName = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

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
  return bestDiff <= 400 ? best : null
}

/**
 * Match a provider tee only when name or total yardage corroborates it. Returning
 * null is safer than silently using the longest/first tee from a wrong course.
 */
export function getHolesForTee(teesData, teeName, gender = 'male', targetYards = null) {
  if (!teesData) return null
  const teeList = teesData[gender] ?? teesData.male ?? []
  if (!Array.isArray(teeList) || !teeList.length) return null

  const target = normalizeTeeName(teeName)
  const exact = target ? teeList.find((tee) => normalizeTeeName(tee?.tee_name) === target) : null
  const byYards =
    !exact && Number.isFinite(Number(targetYards)) && Number(targetYards) > 0
      ? closestTeeByYards(teeList, Number(targetYards))
      : null
  const contains =
    !exact && !byYards && target
      ? teeList.find((tee) => {
          const name = normalizeTeeName(tee?.tee_name)
          return name && (name.includes(target) || target.includes(name))
        })
      : null
  const match = exact ?? byYards ?? contains
  return Array.isArray(match?.holes) ? match.holes : null
}

const validYardage = (value) => Number.isFinite(value) && value > 0 && value < 1000
const validPar = (value) => Number.isInteger(value) && value >= 3 && value <= 6
const validStrokeIndex = (value) => Number.isInteger(value) && value >= 1 && value <= 18

function cardFromRows(rows) {
  const holes = normalizeHoleRows(rows)
  if (!holes) return null
  const pars = {}
  const strokeIndex = {}
  const yardages = {}
  holes.forEach((row) => {
    if (validPar(row.par)) pars[row.hole] = row.par
    if (validStrokeIndex(row.strokeIndex)) strokeIndex[row.hole] = row.strokeIndex
    if (validYardage(row.yardage)) yardages[row.hole] = row.yardage
  })
  return { pars, strokeIndex, yardages }
}

export function holeCardFromTees(teesData, teeName, gender = 'male', targetYards = null) {
  return cardFromRows(getHolesForTee(teesData, teeName, gender, targetYards))
}

export function holeCardFromCourseTee(tee) {
  return cardFromRows(tee?.holes)
}

export function yardageMapFromTees(teesData, teeName, gender = 'male', targetYards = null) {
  const card = holeCardFromTees(teesData, teeName, gender, targetYards)
  return card && Object.keys(card.yardages).length ? card.yardages : null
}

export function yardageMapFromCourseTee(tee) {
  const card = holeCardFromCourseTee(tee)
  return card && Object.keys(card.yardages).length ? card.yardages : null
}
