/**
 * overallPurse.js — Match-play side bet over the full round (Overall Purse).
 *
 * Head-to-head holes-up scoring, same rules as a Nassau overall segment.
 * Supports early closure per pairing when the original bet is closed via press.
 */

import { scoreSegment } from './nassau.js'

function allHoles(pars) {
  return Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)
}

function holesThrough(pars, thruHole) {
  return allHoles(pars).filter((h) => h <= thruHole)
}

function pairKey(a, b) {
  return [a, b].sort().join(':')
}

function roundMoney(n) {
  const value = +Number(n || 0).toFixed(2)
  return Object.is(value, -0) ? 0 : value
}

function applyPairResult(payouts, winnerId, loserId, amount) {
  if (!winnerId || amount <= 0) return
  payouts[winnerId] = (payouts[winnerId] ?? 0) + amount
  payouts[loserId] = (payouts[loserId] ?? 0) - amount
}

function closureForPair(betConfig, p1Id, p2Id) {
  const closures = betConfig?.pressState?.closures ?? []
  const key = pairKey(p1Id, p2Id)
  return closures.find((c) => pairKey(c.pairPlayerIds[0], c.pairPlayerIds[1]) === key) ?? null
}

/**
 * Team holes-up standing (scramble): positive = teamA ahead.
 * @param {Object} pars - Hole → par map (defines which hole numbers exist).
 * @param {number} thruHole - Include holes ≤ this number.
 */
export function teamPairStanding(teamAId, teamBId, scores, pars, thruHole) {
  let up = 0
  for (const hole of holesThrough(pars, thruHole)) {
    const a = scores[teamAId]?.[hole]
    const b = scores[teamBId]?.[hole]
    if (a == null || b == null) continue
    if (a < b) up += 1
    else if (b < a) up -= 1
  }
  return up
}

function splitTeamPayout(payouts, team, amount) {
  const n = team.playerIds.length
  if (n === 0) return
  const share = amount / n
  team.playerIds.forEach((pid) => {
    payouts[pid] = (payouts[pid] ?? 0) + share
  })
}

/**
 * @param {{ id: string, name?: string }} player1
 * @param {{ id: string, name?: string }} player2
 */
export function calculateOverallPurse(player1, player2, scores, pars, strokeAllocations, betConfig) {
  const stake = betConfig?.stake ?? 0
  const holes = allHoles(pars)
  return scoreSegment(player1.id, player2.id, scores, strokeAllocations, holes, stake)
}

/**
 * Aggregate Overall Purse payouts for 2–4 players (every pairing) or 2-team scramble.
 */
export function calculateOverallPursePayouts(
  players,
  scores,
  pars,
  strokeAllocations,
  betConfig,
  options = {}
) {
  const { teams = [] } = options
  const stake = betConfig?.stake ?? 0
  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })

  const lines = []
  const holes = allHoles(pars)

  if (teams.length === 2) {
    const [tA, tB] = teams
    const closure = closureForPair(betConfig, tA.id, tB.id)
    let line
    if (closure?.settlement) {
      const { winnerId, amount } = closure.settlement
      const loserTeam = winnerId === tA.id ? tB : tA
      const winnerTeam = winnerId === tA.id ? tA : tB
      splitTeamPayout(payouts, winnerTeam, amount)
      splitTeamPayout(payouts, loserTeam, -amount)
      line = `${winnerTeam.name} wins $${amount} (closed thru ${closure.closedAtHole})`
    } else {
      const thru = holes.length ? holes[holes.length - 1] : 0
      const up = teamPairStanding(tA.id, tB.id, scores, pars, thru)
      let winnerTeam = null
      if (up > 0) winnerTeam = tA
      else if (up < 0) winnerTeam = tB
      if (winnerTeam) {
        const loserTeam = winnerTeam === tA ? tB : tA
        splitTeamPayout(payouts, winnerTeam, stake)
        splitTeamPayout(payouts, loserTeam, -stake)
        line = `${winnerTeam.name} wins $${stake} (${Math.abs(up)} up)`
      } else {
        line = 'Push'
      }
    }
    lines.push(line)
    players.forEach((p) => {
      payouts[p.id] = roundMoney(payouts[p.id])
    })
    return { payouts, lines }
  }

  const showPairing = players.length > 2

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i]
      const p2 = players[j]
      const closure = closureForPair(betConfig, p1.id, p2.id)

      if (closure?.settlement) {
        const { winnerId, loserId, amount } = closure.settlement
        applyPairResult(payouts, winnerId, loserId, amount)
        if (showPairing) lines.push(`${p1.name} vs ${p2.name}`)
        lines.push(
          showPairing
            ? `  Closed thru ${closure.closedAtHole}: ${players.find((p) => p.id === winnerId)?.name ?? winnerId} wins $${amount}`
            : `${players.find((p) => p.id === winnerId)?.name ?? winnerId} wins $${amount} (closed thru ${closure.closedAtHole})`
        )
        continue
      }

      const result = scoreSegment(p1.id, p2.id, scores, strokeAllocations, holes, stake)
      if (result.winner) {
        const loser = result.winner === p1.id ? p2.id : p1.id
        applyPairResult(payouts, result.winner, loser, result.amount)
      }
      const winnerName = result.winner
        ? players.find((p) => p.id === result.winner)?.name ?? result.winner
        : null
      const segLine = result.winner
        ? `${winnerName} wins $${result.amount} (${Math.abs(result.holesUp)} up)`
        : 'Push'
      if (showPairing) {
        lines.push(`${p1.name} vs ${p2.name}`)
        lines.push(`  ${segLine}`)
      } else {
        lines.push(segLine)
      }
    }
  }

  players.forEach((p) => {
    payouts[p.id] = roundMoney(payouts[p.id])
  })

  return { payouts, lines }
}

/** Settle a pairing through a specific hole (close-original on press). */
export function settleOverallPurseAtHole(
  player1Id,
  player2Id,
  scores,
  pars,
  strokeAllocations,
  stake,
  closedAtHole
) {
  const holes = holesThrough(pars, closedAtHole)
  const result = scoreSegment(player1Id, player2Id, scores, strokeAllocations, holes, stake)
  if (!result.winner) {
    return {
      winnerId: null,
      loserId: null,
      amount: 0,
      holesUp: result.holesUp,
      pairPlayerIds: [player1Id, player2Id],
    }
  }
  const loserId = result.winner === player1Id ? player2Id : player1Id
  return {
    winnerId: result.winner,
    loserId,
    amount: result.amount,
    holesUp: result.holesUp,
    pairPlayerIds: [player1Id, player2Id],
  }
}

export function settleTeamOverallPurseAtHole(teamAId, teamBId, scores, pars, stake, closedAtHole) {
  const up = teamPairStanding(teamAId, teamBId, scores, pars, closedAtHole)
  if (up === 0) {
    return {
      winnerId: null,
      loserId: null,
      amount: 0,
      holesUp: 0,
      pairPlayerIds: [teamAId, teamBId],
    }
  }
  const winnerId = up > 0 ? teamAId : teamBId
  const loserId = up > 0 ? teamBId : teamAId
  return {
    winnerId,
    loserId,
    amount: stake,
    holesUp: up,
    pairPlayerIds: [teamAId, teamBId],
  }
}

export { allHoles, holesThrough }
