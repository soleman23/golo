/**
 * pressBets.js — Manual press bet logic for Overall Purse.
 *
 * Presses are stored separately from the parent bet. Eligibility, creation,
 * close-original settlement, and payout math live here — no React.
 */

import { netForHole, scoreSegment } from './nassau.js'
import {
  allHoles,
  settleOverallPurseAtHole,
  settleTeamOverallPurseAtHole,
  teamPairStanding,
  holesThrough,
} from './overallPurse.js'
import { calculateMatchStatus, calculateHoleResult } from './matchplay.js'

const MAX_ACTIVE_PRESSES = 2
const MULTIPLIERS = [2, 3, 4]

/**
 * @typedef {Object} PressBet
 * @property {string} id
 * @property {string} roundId
 * @property {string} parentBetId
 * @property {string} createdAt
 * @property {string} createdByPlayerId
 * @property {string|null} [createdByTeamId]
 * @property {string|null} [targetPlayerId]
 * @property {string|null} [targetTeamId]
 * @property {string|null} [opponentPlayerId]
 * @property {string|null} [opponentTeamId]
 * @property {'overallPurse'} gameType
 * @property {number} startHole
 * @property {2|3|4} multiplier
 * @property {number} originalStake
 * @property {number} pressStake
 * @property {'continue'|'close'} originalBetAction
 * @property {'active'|'closed'|'settled'} status
 * @property {string|null} [closedAt]
 * @property {string|null} [settledAt]
 */

export function findOverallPurseBet(bets) {
  return bets.find((b) => b.type === 'overallPurse') ?? null
}

function roundMoney(n) {
  const value = +Number(n || 0).toFixed(2)
  return Object.is(value, -0) ? 0 : value
}

function pairStanding(p1, p2, scores, alloc, pars, thruHole) {
  let up = 0
  for (const hole of holesThrough(pars, thruHole)) {
    const a = netForHole(scores, alloc, p1, hole)
    const b = netForHole(scores, alloc, p2, hole)
    if (a == null || b == null) continue
    if (a < b) up += 1
    else if (b < a) up -= 1
  }
  return up
}

function holeResultsForPair(p1, p2, scores, alloc, pars, thruHole) {
  const results = []
  for (const hole of holesThrough(pars, thruHole)) {
    const a = netForHole(scores, alloc, p1, hole)
    const b = netForHole(scores, alloc, p2, hole)
    if (a == null || b == null) {
      results.push(null)
      continue
    }
    results.push(calculateHoleResult(a, b) === 'p1' ? 'p1' : calculateHoleResult(a, b) === 'p2' ? 'p2' : 'halved')
  }
  return results
}

function holeResultsForTeams(tA, tB, scores, pars, thruHole) {
  const results = []
  for (const hole of holesThrough(pars, thruHole)) {
    const a = scores[tA]?.[hole]
    const b = scores[tB]?.[hole]
    if (a == null || b == null) {
      results.push(null)
      continue
    }
    const r = calculateHoleResult(a, b)
    results.push(r === 'p1' ? 'p1' : r === 'p2' ? 'p2' : 'halved')
  }
  return results
}

function teamStandingOverHoles(teamAId, teamBId, scores, holes) {
  let up = 0
  for (const hole of holes) {
    const a = scores[teamAId]?.[hole]
    const b = scores[teamBId]?.[hole]
    if (a == null || b == null) continue
    if (a < b) up += 1
    else if (b < a) up -= 1
  }
  return up
}

function resolveOpponent(input, parentBet, teams) {
  if (teams.length === 2) {
    const targetTeamId = input.targetTeamId
    const opponentTeamId =
      input.opponentTeamId ??
      (targetTeamId === teams[0].id ? teams[1].id : targetTeamId === teams[1].id ? teams[0].id : null)
    return { targetTeamId, opponentTeamId, isTeam: true }
  }

  const inBet = parentBet.playerIds ?? []
  const targetPlayerId = input.targetPlayerId
  let opponentPlayerId = input.opponentPlayerId ?? null
  if (!opponentPlayerId && inBet.length === 2) {
    opponentPlayerId = inBet.find((id) => id !== targetPlayerId) ?? null
  }
  return { targetPlayerId, opponentPlayerId, isTeam: false }
}

function marginForTarget(targetId, opponentId, scores, alloc, teams, pars, thru, isTeam) {
  if (isTeam) {
    const up = teamPairStanding(opponentId, targetId, scores, pars, thru)
    return up
  }
  return pairStanding(opponentId, targetId, scores, alloc, pars, thru)
}

function isMatchActiveForPair(targetId, opponentId, scores, alloc, teams, pars, thru, totalHoles, isTeam) {
  const results = isTeam
    ? holeResultsForTeams(opponentId, targetId, scores, pars, thru)
    : holeResultsForPair(opponentId, targetId, scores, alloc, pars, thru)
  const status = calculateMatchStatus(results, totalHoles)
  return status.status === 'active'
}

function activePressCount(pressBets, parentBetId) {
  return pressBets.filter((p) => p.parentBetId === parentBetId && p.status === 'active').length
}

/**
 * @returns {{ allowed: boolean, reasons: string[], targets: Array<object> }}
 */
export function getPressEligibility(ctx) {
  const {
    bets = [],
    pressBets = [],
    scores = {},
    pars = {},
    strokeAllocations = {},
    teams = [],
    currentHole = 1,
    totalHoles = 18,
    status = 'in_progress',
  } = ctx

  const reasons = []
  const parentBet = findOverallPurseBet(bets)
  if (!parentBet) reasons.push('No Overall Purse bet')
  if (status !== 'in_progress') reasons.push('Round not in progress')

  const stake = parentBet?.config?.stake ?? 0
  if (parentBet && stake <= 0) reasons.push('No valid original stake')

  if (currentHole >= totalHoles) reasons.push('Last hole — no next hole for press')

  if (parentBet && activePressCount(pressBets, parentBet.id) >= MAX_ACTIVE_PRESSES) {
    reasons.push('Maximum active presses reached')
  }

  const thru = currentHole
  const targets = []

  if (parentBet && reasons.length === 0) {
    if (teams.length === 2) {
      for (const t of teams) {
        const opp = teams.find((x) => x.id !== t.id)
        if (!opp) continue
        const margin = marginForTarget(t.id, opp.id, scores, strokeAllocations, teams, pars, thru, true)
        const active = isMatchActiveForPair(t.id, opp.id, scores, strokeAllocations, teams, pars, thru, totalHoles, true)
        if (margin >= 2 && active) {
          targets.push({
            targetTeamId: t.id,
            opponentTeamId: opp.id,
            margin,
            label: `${t.name} ${margin} down`,
          })
        }
      }
    } else {
      const inBet = (parentBet.playerIds ?? []).filter(Boolean)
      const pairs = []
      if (inBet.length === 2) {
        pairs.push([inBet[0], inBet[1]])
      } else if (inBet.length > 2) {
        for (let i = 0; i < inBet.length; i++) {
          for (let j = i + 1; j < inBet.length; j++) pairs.push([inBet[i], inBet[j]])
        }
      }
      for (const [a, b] of pairs) {
        for (const targetId of [a, b]) {
          const oppId = targetId === a ? b : a
          const margin = marginForTarget(targetId, oppId, scores, strokeAllocations, teams, pars, thru, false)
          const active = isMatchActiveForPair(
            targetId,
            oppId,
            scores,
            strokeAllocations,
            teams,
            pars,
            thru,
            totalHoles,
            false
          )
          if (margin >= 2 && active) {
            targets.push({
              targetPlayerId: targetId,
              opponentPlayerId: oppId,
              margin,
            })
          }
        }
      }
    }
  }

  if (targets.length === 0 && reasons.length === 0) {
    reasons.push('No side is 2+ down in an active match')
  }

  return {
    allowed: reasons.length === 0 && targets.length > 0,
    reasons,
    targets,
  }
}

/**
 * @returns {{ ok: true, pressBet: PressBet, parentBetPatch: object|null } | { ok: false, error: string }}
 */
export function buildPressBet(ctx) {
  const {
    bets,
    pressBets,
    scores,
    pars,
    strokeAllocations,
    teams = [],
    currentHole,
    totalHoles,
    roundId,
    status,
    multiplier,
    originalBetAction,
    createdByPlayerId,
    createdByTeamId = null,
    targetPlayerId = null,
    targetTeamId = null,
    opponentPlayerId = null,
    opponentTeamId = null,
  } = ctx

  if (!MULTIPLIERS.includes(multiplier)) {
    return { ok: false, error: 'Invalid multiplier' }
  }
  if (originalBetAction !== 'continue' && originalBetAction !== 'close') {
    return { ok: false, error: 'Invalid original bet action' }
  }
  if (!createdByPlayerId) {
    return { ok: false, error: 'Missing createdByPlayerId' }
  }
  if (status !== 'in_progress') {
    return { ok: false, error: 'Round not in progress' }
  }

  const parentBet = findOverallPurseBet(bets)
  if (!parentBet) return { ok: false, error: 'No Overall Purse bet' }

  const originalStake = parentBet.config?.stake ?? 0
  if (originalStake <= 0) return { ok: false, error: 'No valid original stake' }

  const resolved = resolveOpponent(
    { targetPlayerId, targetTeamId, opponentPlayerId, opponentTeamId },
    parentBet,
    teams
  )

  const targetId = resolved.isTeam ? resolved.targetTeamId : resolved.targetPlayerId
  const opponentId = resolved.isTeam ? resolved.opponentTeamId : resolved.opponentPlayerId

  if (!targetId || !opponentId) {
    return { ok: false, error: 'Target and opponent required' }
  }

  const inBet = parentBet.playerIds ?? []
  if (!resolved.isTeam && inBet.length > 2 && !opponentPlayerId) {
    return { ok: false, error: 'opponentPlayerId required for 3–4 player groups' }
  }

  const margin = marginForTarget(
    targetId,
    opponentId,
    scores,
    strokeAllocations,
    teams,
    pars,
    currentHole,
    resolved.isTeam
  )
  if (margin < 2) {
    return { ok: false, error: 'Target must be 2+ down' }
  }

  if (currentHole >= totalHoles) {
    return { ok: false, error: 'Last hole — no next hole for press' }
  }

  if (activePressCount(pressBets, parentBet.id) >= MAX_ACTIVE_PRESSES) {
    return { ok: false, error: 'Maximum active presses reached' }
  }

  if (
    !isMatchActiveForPair(
      targetId,
      opponentId,
      scores,
      strokeAllocations,
      teams,
      pars,
      currentHole,
      totalHoles,
      resolved.isTeam
    )
  ) {
    return { ok: false, error: 'Match is not active' }
  }

  const pressStake = roundMoney(originalStake * multiplier)
  const startHole = currentHole + 1

  const pressBet = {
    id: crypto.randomUUID(),
    roundId,
    parentBetId: parentBet.id,
    createdAt: new Date().toISOString(),
    createdByPlayerId,
    createdByTeamId,
    targetPlayerId: resolved.isTeam ? null : targetId,
    targetTeamId: resolved.isTeam ? targetId : null,
    opponentPlayerId: resolved.isTeam ? null : opponentId,
    opponentTeamId: resolved.isTeam ? opponentId : null,
    gameType: 'overallPurse',
    startHole,
    multiplier,
    originalStake,
    pressStake,
    originalBetAction,
    status: 'active',
    closedAt: null,
    settledAt: null,
  }

  let parentBetPatch = null
  if (originalBetAction === 'close') {
    const settlement = resolved.isTeam
      ? settleTeamOverallPurseAtHole(
          opponentId,
          targetId,
          scores,
          pars,
          originalStake,
          currentHole
        )
      : settleOverallPurseAtHole(
          opponentId,
          targetId,
          scores,
          pars,
          strokeAllocations,
          originalStake,
          currentHole
        )

    const closures = [...(parentBet.config?.pressState?.closures ?? [])]
    const pairIds = resolved.isTeam ? [opponentId, targetId] : [opponentId, targetId]
    closures.push({
      pairPlayerIds: pairIds,
      closedAtHole: currentHole,
      settlement: {
        winnerId: settlement.winnerId,
        loserId: settlement.loserId,
        amount: settlement.amount,
        holesUp: settlement.holesUp,
      },
      closedAt: new Date().toISOString(),
    })

    parentBetPatch = {
      ...parentBet,
      config: {
        ...parentBet.config,
        pressState: { closures },
      },
    }
  }

  return { ok: true, pressBet, parentBetPatch }
}

function pressHoles(pars, startHole) {
  return allHoles(pars).filter((h) => h >= startHole)
}

/**
 * @returns {{ payouts: Object, lines: string[] }}
 */
export function calculatePressPayouts(pressBets, players, scores, pars, strokeAllocations, teams = []) {
  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })
  const lines = []

  const active = pressBets.filter(
    (p) => p.status === 'active' || p.status === 'settled' || p.status === 'closed'
  )

  for (const press of active) {
    const amount = press.pressStake
    const holes = pressHoles(pars, press.startHole)
    if (holes.length === 0) continue

    if (press.targetTeamId && press.opponentTeamId) {
      const segHoles = holes
      const up = teamStandingOverHoles(press.opponentTeamId, press.targetTeamId, scores, segHoles)
      let winnerTeamId = null
      if (up > 0) winnerTeamId = press.opponentTeamId
      else if (up < 0) winnerTeamId = press.targetTeamId
      if (winnerTeamId) {
        const loserTeamId = winnerTeamId === press.opponentTeamId ? press.targetTeamId : press.opponentTeamId
        const winTeam = teams.find((t) => t.id === winnerTeamId)
        const loseTeam = teams.find((t) => t.id === loserTeamId)
        if (winTeam && loseTeam) {
          const share = amount / winTeam.playerIds.length
          winTeam.playerIds.forEach((pid) => {
            payouts[pid] = (payouts[pid] ?? 0) + share
          })
          const loseShare = amount / loseTeam.playerIds.length
          loseTeam.playerIds.forEach((pid) => {
            payouts[pid] = (payouts[pid] ?? 0) - loseShare
          })
          lines.push(
            `Press x${press.multiplier} (from ${press.startHole}): ${winTeam.name} wins $${amount}`
          )
        }
      } else {
        lines.push(`Press x${press.multiplier} (from ${press.startHole}): push`)
      }
      continue
    }

    const p1 = press.opponentPlayerId
    const p2 = press.targetPlayerId
    if (!p1 || !p2) continue

    const segHoles = holes.filter((h) => h >= press.startHole)
    const result = scoreSegment(p1, p2, scores, strokeAllocations, segHoles, amount)
    if (result.winner) {
      const loser = result.winner === p1 ? p2 : p1
      payouts[result.winner] = (payouts[result.winner] ?? 0) + result.amount
      payouts[loser] = (payouts[loser] ?? 0) - result.amount
      const name = players.find((p) => p.id === result.winner)?.name ?? result.winner
      lines.push(
        `Press x${press.multiplier} (from ${press.startHole}): ${name} wins $${result.amount} (${Math.abs(result.holesUp)} up)`
      )
    } else {
      lines.push(`Press x${press.multiplier} (from ${press.startHole}): push`)
    }
  }

  players.forEach((p) => {
    payouts[p.id] = roundMoney(payouts[p.id])
  })

  return { payouts, lines }
}

export { MAX_ACTIVE_PRESSES, MULTIPLIERS }
