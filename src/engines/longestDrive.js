/**
 * longestDrive.js — Pure Longest-Drive payout math.
 *
 * A single-hole par-5 challenge. The flagged winner on the configured hole collects
 * `amount` from every other participant. Nets to zero. If no hole is configured
 * or no winner is flagged, nobody pays.
 *
 * No React, no state. Reads the winner from the round's side-game flags.
 *
 * @typedef {Object} LongestDriveResult
 * @property {{ [playerId: string]: number }} payouts - Net per player (sums to 0).
 * @property {string[]} lines - Single-line breakdown.
 */

/**
 * Calculate Longest-Drive payouts.
 *
 * @param {Array<{ id: string, name?: string }>} players - Participants in the bet.
 * @param {{ longestDrive: { [hole: number]: string } }} sideGameFlags
 * @param {{ amount: number, hole: number | null }} betConfig
 * @returns {LongestDriveResult}
 */
export function calculateLongestDrive(players, sideGameFlags, betConfig) {
  const { amount = 0, hole = null } = betConfig
  const flags = sideGameFlags?.longestDrive ?? {}
  const ids = players.map((p) => p.id)
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'

  const payouts = {}
  ids.forEach((id) => {
    payouts[id] = 0
  })

  if (hole == null) return { payouts, lines: ['No hole configured.'] }

  const winner = flags[hole]
  if (!winner || !ids.includes(winner)) {
    return { payouts, lines: [`Hole ${hole}: no winner`] }
  }

  const others = ids.filter((id) => id !== winner)
  payouts[winner] += amount * others.length
  others.forEach((id) => {
    payouts[id] -= amount
  })
  ids.forEach((id) => {
    payouts[id] = +payouts[id].toFixed(2)
  })

  return {
    payouts,
    lines: [`Hole ${hole}: ${nameOf(winner)} wins $${amount * others.length}`],
  }
}
