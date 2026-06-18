/**
 * skins.js — Pure Skins betting math.
 *
 * Each hole is worth one skin. A skin is won outright by the single lowest score
 * on the hole; if two or more players tie for low, the skin "carries over" and is
 * added to the next hole's pot. The next outright winner sweeps all carried skins.
 *
 * Cost model (transparent, nets to zero): the total value awarded across the
 * round is split equally among all players, then each player's winnings are
 * netted against that equal share.
 *
 * No React, no state.
 *
 * @typedef {Object} SkinHole
 * @property {number} hole - Hole number.
 * @property {string | null} winner - Winning playerId, or null if the hole tied/carried.
 * @property {number} value - Total payout awarded on this hole (0 if carried).
 * @property {number} carryCount - How many skins were in play on this hole (1 + carried).
 *
 * @typedef {Object} SkinsResult
 * @property {SkinHole[]} skinsByHole - Per-hole outcome in play order.
 * @property {{ [playerId: string]: number }} payouts - Net amount per player (sums to ~0).
 */

/**
 * Net score for a player on a hole (or gross if net scoring is off).
 * @returns {number | null} null if the hole isn't scored.
 */
function holeScore(scores, strokeAllocations, playerId, hole, useNetScores) {
  const gross = scores[playerId]?.[hole]
  if (gross == null) return null
  if (!useNetScores) return gross
  const reduction = strokeAllocations[playerId]?.[hole] ?? 0
  return Math.max(0, gross - reduction)
}

/**
 * Calculate Skins for a group.
 *
 * @param {Array<{ id: string, name?: string }>} players
 * @param {Object} scores - { [playerId]: { [hole]: number | null } }
 * @param {Object} pars - { [hole]: number }
 * @param {Object} strokeAllocations - { [playerId]: { [hole]: number } }
 * @param {{ valuePerSkin: number, carryover: boolean, useNetScores: boolean }} betConfig
 * @returns {SkinsResult}
 */
export function calculateSkins(players, scores, pars, strokeAllocations, betConfig) {
  const { valuePerSkin = 0, carryover = true, useNetScores = true } = betConfig

  const holes = Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)

  const skinsByHole = []
  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })

  let carried = 0 // skins carried in from prior ties
  let totalAwarded = 0

  for (const hole of holes) {
    // Gather every player's score for this hole.
    const scored = players
      .map((p) => ({ id: p.id, score: holeScore(scores, strokeAllocations, p.id, hole, useNetScores) }))
      .filter((s) => s.score != null)

    // Hole not yet played by anyone — leave it out of the results entirely.
    if (scored.length === 0) continue

    const carryCount = carried + 1
    const lowest = Math.min(...scored.map((s) => s.score))
    const leaders = scored.filter((s) => s.score === lowest)

    if (leaders.length === 1) {
      // Outright winner sweeps this skin plus any carried skins.
      const value = carryCount * valuePerSkin
      const winner = leaders[0].id
      payouts[winner] += value
      totalAwarded += value
      skinsByHole.push({ hole, winner, value, carryCount })
      carried = 0
    } else {
      // Tie: skin carries (if enabled) — nobody is paid on this hole.
      skinsByHole.push({ hole, winner: null, value: 0, carryCount })
      carried = carryover ? carryCount : 0
    }
  }

  // Split the total pot equally as each player's "ante", then net it out.
  // This keeps payouts summing to zero so the settlement math balances.
  const share = players.length > 0 ? totalAwarded / players.length : 0
  players.forEach((p) => {
    payouts[p.id] = +(payouts[p.id] - share).toFixed(2)
  })

  return { skinsByHole, payouts }
}

/* ---------------------------------------------------------------------------
 * TEST CASE — calculateSkins: 4 players, 3 holes, 2 carryovers, $2/skin
 * ---------------------------------------------------------------------------
 * Holes 1 & 2 tie (carry over); hole 3 is won outright and sweeps all 3 skins.
 *
 *   const players = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }]
 *   const scores = {
 *     p1: { 1: 4, 2: 5, 3: 3 },  // wins hole 3 outright
 *     p2: { 1: 4, 2: 5, 3: 4 },  // ties hole 1
 *     p3: { 1: 5, 2: 4, 3: 4 },  // ties hole 2
 *     p4: { 1: 5, 2: 4, 3: 4 },  // ties hole 2
 *   }
 *   const pars = { 1: 4, 2: 4, 3: 4 }
 *   const strokeAllocations = {} // gross scoring
 *   const betConfig = { valuePerSkin: 2, carryover: true, useNetScores: false }
 *
 *   calculateSkins(players, scores, pars, strokeAllocations, betConfig)
 *   // => {
 *   //   skinsByHole: [
 *   //     { hole: 1, winner: null, value: 0, carryCount: 1 },
 *   //     { hole: 2, winner: null, value: 0, carryCount: 2 },
 *   //     { hole: 3, winner: 'p1', value: 6, carryCount: 3 },
 *   //   ],
 *   //   payouts: { p1: 4.5, p2: -1.5, p3: -1.5, p4: -1.5 },  // sums to 0
 *   // }
 * ------------------------------------------------------------------------- */
