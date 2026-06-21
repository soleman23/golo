/**
 * scoring.js — Pure scoring & leaderboard math.
 *
 * No React, no state. Score maps are keyed by hole number; a `null` value means
 * the hole hasn't been played yet and is skipped from totals.
 *
 * @typedef {Object} LeaderboardEntry
 * @property {number} rank - 1-based finishing position (ties share a rank).
 * @property {Object} player - The player object passed in (must have `id`).
 * @property {number} gross - Gross strokes over holes played.
 * @property {number} net - Net strokes (gross minus handicap strokes) over holes played.
 * @property {number} thru - Number of holes completed.
 * @property {number} toPar - Net score relative to par over holes played (negative = under).
 */

/**
 * Sum gross strokes across the given holes.
 *
 * @param {{ [hole: number]: number | null }} scores - Hole → strokes.
 * @param {number[]} holes - Which holes to include in the total.
 * @returns {number} Total gross strokes (unplayed/null holes are skipped).
 */
export function calculateGrossTotal(scores, holes) {
  return holes.reduce((sum, hole) => {
    const strokes = scores[hole]
    // Skip holes not yet played.
    return strokes == null ? sum : sum + strokes
  }, 0)
}

/**
 * Sum net strokes across all holes that have a gross score.
 *
 * @param {{ [hole: number]: number | null }} grossScores - Hole → gross strokes.
 * @param {{ [hole: number]: number }} strokeAllocations - Hole → handicap strokes received.
 * @returns {number} Total net strokes (unplayed/null holes are skipped).
 */
export function calculateNetTotal(grossScores, strokeAllocations) {
  return Object.entries(grossScores).reduce((sum, [hole, gross]) => {
    if (gross == null) return sum
    const reduction = strokeAllocations[hole] ?? 0
    // Net per hole can't drop below 0.
    return sum + Math.max(0, gross - reduction)
  }, 0)
}

/**
 * Score relative to par for a single hole.
 *
 * @param {number} score - Strokes taken.
 * @param {number} par - Par for the hole.
 * @returns {number} Difference (negative = under par, 0 = par, positive = over).
 */
export function getScoreVsPar(score, par) {
  return score - par
}

/**
 * Human-readable label for a score relative to par.
 *
 * @param {number} scoreVsPar - Output of `getScoreVsPar`.
 * @returns {string} e.g. "Birdie", "Par", "Double Bogey".
 */
export function getScoreLabel(scoreVsPar) {
  switch (scoreVsPar) {
    case -4:
      return 'Condor'
    case -3:
      return 'Albatross'
    case -2:
      return 'Eagle'
    case -1:
      return 'Birdie'
    case 0:
      return 'Par'
    case 1:
      return 'Bogey'
    case 2:
      return 'Double Bogey'
    case 3:
      return 'Triple Bogey'
    default:
      // Beyond a triple, just count the bogeys (e.g. "+4"); below a condor is impossible in practice.
      return scoreVsPar > 0 ? `+${scoreVsPar}` : `${scoreVsPar}`
  }
}

/**
 * Build a sorted net-score leaderboard.
 *
 * Only holes 1..thruHole that have a gross score are counted, so the board is
 * meaningful mid-round. Sorted ascending by net score; ties share a rank.
 *
 * @param {Array<{ id: string, name?: string }>} players - Players in the round.
 * @param {{ [playerId: string]: { [hole: number]: number | null } }} scores - Per-player hole scores.
 * @param {{ [playerId: string]: { [hole: number]: number } }} strokeAllocations - Per-player handicap strokes by hole.
 * @param {{ [hole: number]: number }} pars - Par by hole.
 * @param {number} thruHole - Highest hole number to include.
 * @returns {LeaderboardEntry[]} Entries sorted by net score, ranked.
 */
export function buildLeaderboard(players, scores, strokeAllocations, pars, thruHole) {
  const entries = players.map((player) => {
    const playerScores = scores[player.id] ?? {}
    const playerAlloc = strokeAllocations[player.id] ?? {}

    let gross = 0
    let net = 0
    let toPar = 0
    let thru = 0

    for (let hole = 1; hole <= thruHole; hole++) {
      const strokes = playerScores[hole]
      if (strokes == null) continue // hole not played

      const reduction = playerAlloc[hole] ?? 0
      const netStrokes = Math.max(0, strokes - reduction)
      const par = pars[hole] ?? 4 // sensible default if par data is incomplete

      gross += strokes
      net += netStrokes
      toPar += netStrokes - par
      thru += 1
    }

    return { player, gross, net, toPar, thru }
  })

  // Sort by net ascending; lower net wins. Players with no posted scores stay
  // below active players so a blank card can't lead the board mid-round.
  entries.sort((a, b) => {
    if (a.thru === 0 && b.thru > 0) return 1
    if (b.thru === 0 && a.thru > 0) return -1
    return a.net - b.net
  })

  // Assign ranks, sharing a rank for equal net scores.
  let lastNet = null
  let lastRank = 0
  return entries.map((entry, index) => {
    const rankNet = entry.thru === 0 ? Number.POSITIVE_INFINITY : entry.net
    if (rankNet !== lastNet) {
      lastRank = index + 1
      lastNet = rankNet
    }
    return { rank: lastRank, ...entry }
  })
}
