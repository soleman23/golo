// Explicit extension: the verification scripts import this module from Node.
import { normalizeHoleRows } from './courseValidation.js'

/**
 * Turning provider tee payloads into the app's per-hole card.
 *
 * Pure data shaping — no network, no Supabase — so the verification scripts can
 * exercise it directly. The network client lives in ./golfCourseApi.
 *
 * The guiding rule: a card that is wrong is worse than no card at all, because
 * par and stroke index drive handicap strokes and every game's settlement. So a
 * tee is only accepted when something corroborates it, and a hole map is only
 * accepted when it is complete.
 */

/**
 * "Bend, OR" -> { city: 'Bend', state: 'OR' }. A location with no comma yields
 * blanks: a bare city is not worth guessing a state from, and a wrong state
 * hint is worse than none because the resolver scores against it.
 */
export function locationHint(location) {
  const parts = String(location ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  return {
    city: parts.length > 1 ? parts.at(-2) : '',
    state: parts.length > 1 ? parts.at(-1) : '',
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
 * Match a provider tee only when name or total yardage corroborates it.
 * Returning null is safer than silently using the longest or first tee, which
 * is how a mismatched course used to end up looking like real data.
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

/** Card for a provider tee set, chosen by name/yardage. Null when nothing matches. */
export function holeCardFromTees(teesData, teeName, gender = 'male', targetYards = null) {
  return cardFromRows(getHolesForTee(teesData, teeName, gender, targetYards))
}

/** Card for a tee the resolver already validated and attached to the course. */
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
