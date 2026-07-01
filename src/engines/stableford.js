/**
 * stableford.js — Pure Stableford (points-based) scoring.
 *
 * Each hole earns points by net score relative to par; the highest total wins
 * (the opposite of stroke play). Standard scale:
 *   ≤ 3 under (albatross+) 5 · eagle 4 · birdie 3 · par 2 · bogey 1 · double+ 0.
 *
 * No React, no state. Unplayed holes (null) earn 0 and are skipped from totals.
 *
 * @typedef {Object} StablefordEntry
 * @property {number} rank - 1-based finishing position (ties share a rank).
 * @property {Object} player - The player object passed in (must have `id`).
 * @property {number} points - Total Stableford points over holes played.
 * @property {number} gross - Gross strokes over holes played.
 * @property {number} thru - Number of holes completed.
 * @property {{ [hole: number]: number }} pointsByHole - Points earned per hole.
 */

/**
 * Stableford points for a single hole.
 *
 * @param {number} grossScore - Strokes taken on the hole.
 * @param {number} par - Par for the hole.
 * @param {number} [strokeReduction=0] - Handicap strokes received on this hole (0, 1, or 2).
 * @returns {number} Points (0–5).
 */
export function calculateStablefordPoints(grossScore, par, strokeReduction = 0) {
  if (grossScore == null) return 0
  const net = Math.max(0, grossScore - strokeReduction)
  // Can't score better than gross relative to par (prevents inflated points when strokes > gross).
  const diff = Math.max(net - par, grossScore - par)
  if (diff <= -3) return 5 // albatross or better
  if (diff === -2) return 4 // eagle
  if (diff === -1) return 3 // birdie
  if (diff === 0) return 2 // par
  if (diff === 1) return 1 // bogey
  return 0 // double bogey or worse
}

/**
 * Build a points-sorted Stableford leaderboard (highest points first).
 *
 * @param {Array<{ id: string, name?: string }>} players
 * @param {{ [playerId: string]: { [hole: number]: number | null } }} scores
 * @param {{ [hole: number]: number }} pars
 * @param {{ [playerId: string]: { [hole: number]: number } }} strokeAllocations
 * @returns {StablefordEntry[]} Entries sorted by points descending, ranked.
 */
export function buildStablefordLeaderboard(players, scores, pars, strokeAllocations) {
  const holes = Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)

  const entries = players.map((player) => {
    const playerScores = scores[player.id] ?? {}
    const playerAlloc = strokeAllocations?.[player.id] ?? {}

    let points = 0
    let gross = 0
    let thru = 0
    const pointsByHole = {}

    for (const hole of holes) {
      const g = playerScores[hole]
      if (g == null) continue
      const par = pars[hole] ?? 4
      const pts = calculateStablefordPoints(g, par, playerAlloc[hole] ?? 0)
      pointsByHole[hole] = pts
      points += pts
      gross += g
      thru += 1
    }

    return { player, points, gross, thru, pointsByHole }
  })

  // Highest points wins. Blank scorecards stay below active players.
  entries.sort((a, b) => {
    if (a.thru === 0 && b.thru > 0) return 1
    if (b.thru === 0 && a.thru > 0) return -1
    if (b.points !== a.points) return b.points - a.points
    return b.thru - a.thru
  })

  // Assign ranks, sharing a rank for equal point totals.
  let lastPoints = null
  let lastRank = 0
  return entries.map((entry, index) => {
    const rankPoints = entry.thru === 0 ? Number.NEGATIVE_INFINITY : entry.points
    if (rankPoints !== lastPoints) {
      lastRank = index + 1
      lastPoints = rankPoints
    }
    return { rank: lastRank, ...entry }
  })
}

/* ---------------------------------------------------------------------------
 * TEST CASE — Stableford: 1 player, mixed scores, 1 handicap stroke
 * ---------------------------------------------------------------------------
 *   calculateStablefordPoints(3, 4, 0)  // birdie  -> 3
 *   calculateStablefordPoints(4, 4, 0)  // par     -> 2
 *   calculateStablefordPoints(6, 4, 0)  // double  -> 0
 *   calculateStablefordPoints(5, 4, 1)  // net par -> 2
 *   calculateStablefordPoints(2, 5, 0)  // albatross-> 5
 *
 *   buildStablefordLeaderboard(
 *     [{ id: 'a', name: 'Ann' }],
 *     { a: { 1: 3, 2: 4, 3: 6 } },     // birdie, par, double
 *     { 1: 4, 2: 4, 3: 4 },
 *     {},
 *   )
 *   // => [{ rank: 1, player: {...}, points: 5, gross: 13, thru: 3,
 *   //       pointsByHole: { 1: 3, 2: 2, 3: 0 } }]
 * ------------------------------------------------------------------------- */
