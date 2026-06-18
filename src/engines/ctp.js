/**
 * ctp.js — Pure Closest-to-Pin payout math.
 *
 * Each configured CTP hole that has a winner flagged pays `amount` to that winner
 * from every other participant. Holes with no winner flagged are skipped. Nets to
 * zero, matching the "could lose `amount` on each CTP hole" exposure model.
 *
 * No React, no state. Reads winners from the round's side-game flags.
 *
 * @typedef {Object} CtpResult
 * @property {{ [playerId: string]: number }} payouts - Net per player (sums to 0).
 * @property {string[]} lines - Per-hole breakdown.
 */

/**
 * Calculate Closest-to-Pin payouts.
 *
 * @param {Array<{ id: string, name?: string }>} players - Participants in the bet.
 * @param {{ closestToPin: { [hole: number]: string } }} sideGameFlags
 * @param {{ amount: number, holes: number[] }} betConfig
 * @returns {CtpResult}
 */
export function calculateCTP(players, sideGameFlags, betConfig) {
  const { amount = 0, holes = [] } = betConfig
  const flags = sideGameFlags?.closestToPin ?? {}
  const ids = players.map((p) => p.id)
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'

  const payouts = {}
  ids.forEach((id) => {
    payouts[id] = 0
  })

  const lines = []
  for (const hole of holes) {
    const winner = flags[hole]
    if (!winner || !ids.includes(winner)) {
      lines.push(`Hole ${hole}: no winner`)
      continue
    }
    const others = ids.filter((id) => id !== winner)
    payouts[winner] += amount * others.length
    others.forEach((id) => {
      payouts[id] -= amount
    })
    lines.push(`Hole ${hole}: ${nameOf(winner)} wins $${amount * others.length}`)
  }

  ids.forEach((id) => {
    payouts[id] = +payouts[id].toFixed(2)
  })

  return { payouts, lines: lines.length ? lines : ['No holes configured.'] }
}
