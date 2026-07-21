/**
 * handicap.js — Pure handicap & stroke-allocation math.
 *
 * No React, no state. Every function is (inputs) => (output) with no side effects.
 * A "stroke reduction" is the number of handicap strokes a player subtracts from
 * their gross score on a given hole (0, 1, or 2 for typical handicaps).
 */

/**
 * Bounds for a stored Handicap Index. The low end is negative because a "plus"
 * handicap — better than scratch, written +2.4 by golfers — is stored as -2.4.
 */
export const MIN_HANDICAP_INDEX = -10
export const MAX_HANDICAP_INDEX = 54

/**
 * Parse a typed Handicap Index into a stored value.
 *
 * Shared by Onboarding and You so the two can't drift: both accept the same
 * range and round to the same precision. Callers that want the old silent
 * behaviour (blank or out-of-range clears the field) can read `.value ?? null`;
 * callers with somewhere to show a message read `.error`.
 *
 * @param {string|number|null|undefined} raw - Whatever the user typed.
 * @returns {{ value: number, error?: undefined } | { value?: undefined, error: string }}
 */
export function parseHandicapIndex(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { error: 'Enter a number like 12.4.' }

  const n = Number(text)
  if (!Number.isFinite(n)) return { error: 'Enter a number like 12.4.' }
  if (n < MIN_HANDICAP_INDEX || n > MAX_HANDICAP_INDEX) {
    return { error: `Index must be ${MIN_HANDICAP_INDEX} to ${MAX_HANDICAP_INDEX} (a plus 2.4 is -2.4).` }
  }

  return { value: Math.round(n * 10) / 10 }
}

/**
 * Calculate a player's course handicap from their handicap index.
 *
 * Full WHS formula: Course Handicap = round(index * slope/113 + (rating - par)).
 * 113 is the "standard" slope, so an average course yields a course handicap
 * near the index. The (rating - par) term adjusts for a tee that plays harder or
 * easier than its par; it's applied only when both rating and par are supplied,
 * so the older two-arg calls (index, slope) stay backward-compatible.
 *
 * @param {number} handicapIndex - The player's portable handicap index (may be negative for "plus" handicaps).
 * @param {number} [slopeRating=113] - The tee's slope rating (55–155). Defaults to neutral 113.
 * @param {number|null} [courseRating=null] - The tee's course rating (strokes); omit to skip the rating adjustment.
 * @param {number|null} [par=null] - The tee's par; omit to skip the rating adjustment.
 * @returns {number} The course handicap, rounded to the nearest whole stroke.
 */
export function calculateCourseHandicap(handicapIndex, slopeRating = 113, courseRating = null, par = null) {
  // Guard against a missing/invalid slope by falling back to neutral 113.
  const slope = slopeRating > 0 ? slopeRating : 113
  const ratingAdj = courseRating != null && par != null ? courseRating - par : 0
  return Math.round(handicapIndex * (slope / 113) + ratingAdj)
}

/**
 * Determine how many strokes a player receives on a single hole.
 *
 * Strokes are assigned hardest-hole-first by the hole's handicap rank
 * (1 = hardest, 18 = easiest). A player whose course handicap exceeds the
 * number of holes "wraps around" and gets a second stroke on the hardest holes.
 *
 * @param {number} courseHandicap - The player's course handicap.
 * @param {number} holeHandicapRank - The hole's stroke-index rank (1 = hardest).
 * @returns {0 | 1 | 2} Strokes received on this hole (capped at 2 for MVP).
 */
export function calculateStrokeReduction(courseHandicap, holeHandicapRank) {
  // Plus handicaps (negative) give strokes back rather than receive them; for MVP we floor at 0.
  if (courseHandicap <= 0) return 0

  let strokes = 0
  if (courseHandicap >= holeHandicapRank) strokes += 1
  // Second pass: a handicap of 18+N grants a 2nd stroke on the N hardest holes.
  if (courseHandicap >= holeHandicapRank + 18) strokes += 1

  // Cap at 2 — anything higher is out of MVP scope.
  return Math.min(strokes, 2)
}

/**
 * Compute a net score for one hole.
 *
 * @param {number} grossScore - Strokes actually taken on the hole.
 * @param {number} strokeReduction - Handicap strokes received on the hole.
 * @returns {number} Net score (never below 0).
 */
export function calculateNetScore(grossScore, strokeReduction) {
  // Net can't be negative — a player can't score below 0 on a hole.
  return Math.max(0, grossScore - strokeReduction)
}

/**
 * Allocate a player's full course handicap across all holes, hardest-first.
 *
 * If `holeHandicapRanks` is supplied (the course's real stroke index — a map of
 * hole number → rank where 1 = hardest), strokes are dealt to actual hole
 * numbers in rank order. When it's omitted, the hole number is treated as its
 * own rank (hole 1 = hardest), which is fine for tests or courses without a
 * stroke index. One stroke is dealt per hole in rank order, wrapping back to the
 * hardest hole for a second pass when the handicap exceeds the hole count. The
 * returned map is keyed by hole number and can be looked up by `calculateNetScore`.
 *
 * @param {number} courseHandicap - The player's course handicap.
 * @param {number} [totalHoles=18] - Number of holes in the round (9 or 18).
 * @param {{ [hole: number]: number } | null} [holeHandicapRanks=null] - Hole → stroke-index rank (1 = hardest).
 * @returns {{ [hole: number]: number }} Map of hole number → strokes received.
 */
export function allocateStrokes(courseHandicap, totalHoles = 18, holeHandicapRanks = null) {
  const allocation = {}
  // Initialize every hole to 0 so callers always get a defined value.
  for (let hole = 1; hole <= totalHoles; hole++) allocation[hole] = 0

  // Build the order in which holes receive strokes (hardest rank first).
  // Without a real stroke index, fall back to hole-number-as-rank.
  const order = holeHandicapRanks
    ? Object.keys(holeHandicapRanks)
        .map(Number)
        .sort((a, b) => holeHandicapRanks[a] - holeHandicapRanks[b])
    : Array.from({ length: totalHoles }, (_, i) => i + 1)

  // Plus/zero handicaps receive nothing.
  let remaining = Math.max(0, Math.round(courseHandicap))

  let i = 0
  while (remaining > 0 && order.length > 0) {
    const hole = order[i]
    if (allocation[hole] < 2) {
      allocation[hole] += 1
      remaining -= 1
    }
    i = i >= order.length - 1 ? 0 : i + 1
    // Excess strokes beyond 2/hole are dropped (MVP cap).
    if (order.every((h) => allocation[h] >= 2)) break
  }

  return allocation
}

/**
 * Build the per-player stroke-allocation map consumed by the scoring, nassau,
 * and skins engines.
 *
 * This is the bridge between the flat player list (each carrying a
 * `courseHandicap`) and the `{ [playerId]: { [hole]: number } }` shape those
 * engines expect. Pass the course's stroke index so strokes land on the right
 * holes; omit it to fall back to hole-number-as-rank.
 *
 * @param {Array<{ id: string, courseHandicap?: number }>} players
 * @param {number} [totalHoles=18] - Number of holes in the round (9 or 18).
 * @param {{ [hole: number]: number } | null} [holeHandicapRanks=null] - Hole → stroke-index rank (1 = hardest).
 * @returns {{ [playerId: string]: { [hole: number]: number } }} Per-player strokes by hole.
 */
export function buildStrokeAllocations(players, totalHoles = 18, holeHandicapRanks = null) {
  const allocations = {}
  for (const player of players) {
    allocations[player.id] = allocateStrokes(
      player.courseHandicap ?? 0,
      totalHoles,
      holeHandicapRanks,
    )
  }
  return allocations
}

/**
 * Validate a course stroke index captured at setup.
 *
 * A valid stroke index assigns each of the `totalHoles` holes a unique rank from
 * 1..totalHoles (1 = hardest). This catches the common setup mistakes: a missing
 * hole, a duplicated rank, or a rank out of range.
 *
 * @param {{ [hole: number]: number }} strokeIndex - Hole → rank.
 * @param {number} [totalHoles=18] - Expected number of holes (9 or 18).
 * @returns {{ valid: boolean, errors: string[] }} Validity plus human-readable errors.
 */
export function validateStrokeIndex(strokeIndex, totalHoles = 18) {
  const errors = []
  const ranks = Object.values(strokeIndex)

  if (ranks.length !== totalHoles) {
    errors.push(`Expected ${totalHoles} ranked holes, got ${ranks.length}.`)
  }

  const seen = new Set()
  for (const rank of ranks) {
    if (!Number.isInteger(rank) || rank < 1 || rank > totalHoles) {
      errors.push(`Rank ${rank} is out of range (must be 1–${totalHoles}).`)
    } else if (seen.has(rank)) {
      errors.push(`Rank ${rank} is assigned to more than one hole.`)
    }
    seen.add(rank)
  }

  return { valid: errors.length === 0, errors }
}
