/**
 * bingobangobongo.js — Pure Bingo Bango Bongo points & payout math.
 *
 * Three independent points are available per hole:
 *   - Bingo: first ball on the green.
 *   - Bango: closest to the pin once every ball is on.
 *   - Bongo: first to hole out.
 * Each point is worth a set dollar value. Like Skins, the total value awarded is
 * split equally as an ante and netted out, so payouts sum to zero. A point may be
 * split between tied players (e.g. two players hole out together) by passing an
 * array of winner ids — the point is divided equally among them.
 *
 * No React, no state.
 *
 * @typedef {Object} HoleFlags
 * @property {string|string[]|null} bingoWinner - First on the green.
 * @property {string|string[]|null} bangoWinner - Closest once all are on.
 * @property {string|string[]|null} bongoWinner - First to hole out.
 *
 * @typedef {Object} BBBResult
 * @property {{ [playerId: string]: number }} points - Total points per player.
 * @property {{ [playerId: string]: number }} payouts - Net per player (sums to ~0).
 */

/** Credit a point (split equally if multiple in-bet winners). */
function award(points, winner, validIds) {
  if (winner == null) return
  const winners = (Array.isArray(winner) ? winner : [winner]).filter((id) => validIds.has(id))
  if (winners.length === 0) return
  const each = 1 / winners.length
  winners.forEach((id) => {
    points[id] = (points[id] ?? 0) + each
  })
}

/**
 * Calculate Bingo Bango Bongo points and payouts.
 *
 * @param {HoleFlags[] | { [hole: number]: HoleFlags }} holeFlags - Per-hole winner flags.
 * @param {Array<{ id: string, name?: string }>} players
 * @param {number} [valuePerPoint=1] - Dollar value of one point.
 * @returns {BBBResult}
 */
export function calculateBBBPayouts(holeFlags, players, valuePerPoint = 1) {
  const points = {}
  const validIds = new Set(players.map((p) => p.id))
  players.forEach((p) => {
    points[p.id] = 0
  })

  const entries = Array.isArray(holeFlags) ? holeFlags : Object.values(holeFlags ?? {})
  for (const f of entries) {
    if (!f) continue
    award(points, f.bingoWinner, validIds)
    award(points, f.bangoWinner, validIds)
    award(points, f.bongoWinner, validIds)
  }

  // Equal-ante netting (mirrors skins) so the table sums to zero.
  const totalPoints = Object.values(points).reduce((sum, x) => sum + x, 0)
  const share = players.length > 0 ? (totalPoints * valuePerPoint) / players.length : 0

  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = +(points[p.id] * valuePerPoint - share).toFixed(2)
  })
  Object.keys(points).forEach((id) => {
    points[id] = +points[id].toFixed(2)
  })

  return { points, payouts }
}

/* ---------------------------------------------------------------------------
 * TEST CASE — Bingo Bango Bongo: 4 players, $1/point, 1 hole, split Bongo
 * ---------------------------------------------------------------------------
 *   const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
 *   const flags = [{ bingoWinner: 'a', bangoWinner: 'b', bongoWinner: ['a', 'b'] }]
 *   calculateBBBPayouts(flags, players, 1)
 *   // points:  { a: 1.5, b: 1.5, c: 0, d: 0 }   (3 points awarded)
 *   // share:   3 * 1 / 4 = 0.75
 *   // payouts: { a: 0.75, b: 0.75, c: -0.75, d: -0.75 }  (sums to 0)
 * ------------------------------------------------------------------------- */
