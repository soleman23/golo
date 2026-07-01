/**
 * wolf.js — Pure Wolf (4-player rotating partner) betting math.
 *
 * Each hole one player is the "Wolf". After watching drives the Wolf either picks
 * a partner (2 v 2) or goes alone (1 v 3). The team with the lower best-ball score
 * wins the hole. Stakes (in units, multiplied by the bet amount):
 *   - Lone Wolf win/lose: ±1 unit vs each of the 3 opponents (a "blind" lone wolf
 *     called before any drive is worth double).
 *   - Wolf + partner win/lose: each teammate ±1 unit vs each opponent.
 *   - Tie: push.
 *
 * Exactly 4 players. No React, no state.
 *
 * @typedef {Object} WolfHoleResult
 * @property {string} wolfId - The Wolf for this hole.
 * @property {string|null} partnerId - Chosen partner, or null for Lone Wolf.
 * @property {boolean} lone - Whether the Wolf played alone.
 * @property {'wolf'|'opponents'|'push'} result - Which side won the hole.
 * @property {{ [playerId: string]: number }} payouts - Net units×amount per player (sums to 0).
 */

/**
 * The Wolf for a given hole. Rotation follows the player order, wrapping each
 * cycle (4 players => same Wolf every 4 holes).
 *
 * @param {Array<{ id: string }>} players - Players in fixed order.
 * @param {number} hole - 1-based hole number.
 * @returns {string|null} The Wolf's playerId, or null if there are no players.
 */
export function getWolfOrder(players, hole) {
  if (!players || players.length === 0) return null
  return players[(hole - 1) % players.length].id
}

/**
 * Score a single Wolf hole.
 *
 * @param {{ [playerId: string]: number|null }} holeScores - Score per player this hole.
 * @param {string} wolfId - The Wolf.
 * @param {string|null} partnerId - Partner, or null for Lone Wolf.
 * @param {number} [betAmount=1] - Value of one unit.
 * @param {{ blind?: boolean }} [options] - blind = forced/early Lone Wolf, double value.
 * @returns {WolfHoleResult}
 */
export function calculateWolfResult(holeScores, wolfId, partnerId, betAmount = 1, options = {}) {
  const { blind = false } = options
  const ids = Object.keys(holeScores)
  const lone = partnerId == null

  const wolfSide = lone ? [wolfId] : [wolfId, partnerId]
  const opponents = ids.filter((id) => !wolfSide.includes(id))

  const payouts = {}
  ids.forEach((id) => {
    payouts[id] = 0
  })

  const wolfScores = wolfSide.map((id) => holeScores[id]).filter((s) => s != null)
  const oppScores = opponents.map((id) => holeScores[id]).filter((s) => s != null)

  // Wait until every player has posted — same guard as skins settlement.
  const allScored = ids.every((id) => holeScores[id] != null)
  if (!allScored) {
    return { wolfId, partnerId: lone ? null : partnerId, lone, result: 'push', payouts }
  }

  if (wolfScores.length === 0 || oppScores.length === 0) {
    return { wolfId, partnerId: lone ? null : partnerId, lone, result: 'push', payouts }
  }

  const wolfBest = Math.min(...wolfScores)
  const oppBest = Math.min(...oppScores)

  let result = 'push'
  if (wolfBest < oppBest) result = 'wolf'
  else if (oppBest < wolfBest) result = 'opponents'

  if (result === 'push') {
    return { wolfId, partnerId: lone ? null : partnerId, lone, result, payouts }
  }

  if (lone) {
    // ±1 unit (×2 if blind) between the Wolf and each opponent.
    const unit = (blind ? 2 : 1) * betAmount
    const wolfWon = result === 'wolf'
    opponents.forEach((id) => {
      payouts[id] += wolfWon ? -unit : unit
      payouts[wolfId] += wolfWon ? unit : -unit
    })
  } else {
    // Each teammate exchanges 1 unit with each opponent.
    const unit = betAmount
    const wolfWon = result === 'wolf'
    wolfSide.forEach((w) =>
      opponents.forEach((o) => {
        payouts[w] += wolfWon ? unit : -unit
        payouts[o] += wolfWon ? -unit : unit
      })
    )
  }

  ids.forEach((id) => {
    payouts[id] = +payouts[id].toFixed(2)
  })

  return { wolfId, partnerId: lone ? null : partnerId, lone, result, payouts }
}

/**
 * Sum a round's Wolf holes into one net total per player.
 *
 * @param {WolfHoleResult[]} allHoleResults
 * @param {Array<{ id: string }>} players
 * @returns {{ [playerId: string]: number }} Net per player (sums to ~0).
 */
export function calculateWolfTotals(allHoleResults, players) {
  const totals = {}
  players.forEach((p) => {
    totals[p.id] = 0
  })
  for (const r of allHoleResults) {
    if (!r || !r.payouts) continue
    for (const [id, amount] of Object.entries(r.payouts)) {
      totals[id] = (totals[id] ?? 0) + amount
    }
  }
  Object.keys(totals).forEach((id) => {
    totals[id] = +totals[id].toFixed(2)
  })
  return totals
}

/* ---------------------------------------------------------------------------
 * TEST CASE — Wolf: 4 players, $1/unit
 * ---------------------------------------------------------------------------
 *   const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
 *   getWolfOrder(players, 1)  // 'a'
 *   getWolfOrder(players, 5)  // 'a' (wraps)
 *
 *   // Wolf 'a' partners 'b'; team beats c/d:
 *   calculateWolfResult({ a: 4, b: 5, c: 5, d: 6 }, 'a', 'b', 1).payouts
 *   // => { a: 2, b: 2, c: -2, d: -2 }
 *
 *   // Lone Wolf 'a' beats all three:
 *   calculateWolfResult({ a: 3, b: 4, c: 4, d: 5 }, 'a', null, 1).payouts
 *   // => { a: 3, b: -1, c: -1, d: -1 }
 *
 *   // Blind Lone Wolf 'a' loses (double):
 *   calculateWolfResult({ a: 6, b: 4, c: 5, d: 5 }, 'a', null, 1, { blind: true }).payouts
 *   // => { a: -6, b: 2, c: 2, d: 2 }
 * ------------------------------------------------------------------------- */
