/**
 * payouts.js — Pure payout aggregation & debt settlement.
 *
 * Takes the per-player results from every bet engine, sums them into a single
 * net position per player, then computes the minimal set of player-to-player
 * transfers that settles all debts.
 *
 * No React, no state.
 *
 * @typedef {Object} Settlement
 * @property {string} from - Player who pays.
 * @property {string} to - Player who receives.
 * @property {number} amount - Amount transferred (positive).
 */

/**
 * Sum every bet's payout lines into one net total per player.
 *
 * Each entry may be a plain `{ [playerId]: number }` map, or an object with a
 * `.payouts` map (e.g. a SkinsResult) — both are supported so engine results can
 * be passed straight through.
 *
 * @param {Array<{ [playerId: string]: number } | { payouts: { [playerId: string]: number } }>} betResults
 * @returns {{ [playerId: string]: number }} Net amount per player (positive = owed money).
 */
export function aggregatePayouts(betResults) {
  const totals = {}
  for (const result of betResults) {
    if (!result) continue
    // Unwrap engine result objects that nest their map under `payouts`.
    const map = result.payouts && typeof result.payouts === 'object' ? result.payouts : result
    for (const [playerId, amount] of Object.entries(map)) {
      if (typeof amount !== 'number') continue
      totals[playerId] = (totals[playerId] ?? 0) + amount
    }
  }
  // Round to cents to avoid floating-point drift accumulating across bets.
  for (const id of Object.keys(totals)) totals[id] = +totals[id].toFixed(2)
  return totals
}

/**
 * Compute the minimum-transaction settlements for a set of net balances.
 *
 * Greedy debt-netting: repeatedly match the biggest debtor against the biggest
 * creditor and transfer the smaller of the two magnitudes. This produces at most
 * (n - 1) transactions, which is optimal for the common case.
 *
 * @param {{ [playerId: string]: number }} netPayouts - Net per player (positive = is owed, negative = owes).
 * @returns {Settlement[]} Transfers that zero out every balance.
 */
export function calculateSettlements(netPayouts) {
  const EPS = 0.005 // ignore sub-cent residue

  // Split into creditors (owed money) and debtors (owe money).
  const creditors = []
  const debtors = []
  for (const [id, amount] of Object.entries(netPayouts)) {
    if (amount > EPS) creditors.push({ id, amount })
    else if (amount < -EPS) debtors.push({ id, amount: -amount }) // store debt as positive
  }

  // Largest balances first so we clear big debts in the fewest moves.
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const settlements = []
  let ci = 0
  let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]
    const debtor = debtors[di]
    const amount = Math.min(creditor.amount, debtor.amount)

    settlements.push({ from: debtor.id, to: creditor.id, amount: +amount.toFixed(2) })

    creditor.amount -= amount
    debtor.amount -= amount

    // Advance past whichever side is now settled.
    if (creditor.amount <= EPS) ci += 1
    if (debtor.amount <= EPS) di += 1
  }

  return settlements
}

/* ---------------------------------------------------------------------------
 * TEST CASE — calculateSettlements: 4 players with complex debts
 * ---------------------------------------------------------------------------
 * Net positions (positive = owed money, negative = owes):
 *   p1: +25, p2: +5, p3: -10, p4: -20   (sums to 0)
 *
 * Greedy netting matches biggest creditor with biggest debtor:
 *   p4 owes 20 -> p1   (p1 now owed 5)
 *   p3 owes  5 -> p1   (p1 settled, p3 still owes 5)
 *   p3 owes  5 -> p2   (all settled)
 *
 *   const netPayouts = { p1: 25, p2: 5, p3: -10, p4: -20 }
 *   calculateSettlements(netPayouts)
 *   // => [
 *   //   { from: 'p4', to: 'p1', amount: 20 },
 *   //   { from: 'p3', to: 'p1', amount: 5 },
 *   //   { from: 'p3', to: 'p2', amount: 5 },
 *   // ]   // 3 transactions for 4 players (n - 1, optimal)
 * ------------------------------------------------------------------------- */
