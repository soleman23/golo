/**
 * betStatus.js — Pure derivation of live bet status for the Active Bets Bar.
 *
 * Turns the persisted bet list into display-ready pills (a short status label
 * plus a few detail lines for the bottom sheet). Skins and Nassau use the real
 * engines; Stroke Purse leans on the leaderboard; CTP / Longest Drive read the
 * side-game flags. No React, no state — (inputs) => (pills).
 *
 * @typedef {Object} BetPill
 * @property {string} id - The bet's id.
 * @property {string} type - Bet type key.
 * @property {string} name - Short display name (e.g. "Skins").
 * @property {string} label - Live status text (e.g. "$4 carried").
 * @property {string[]} detailLines - Longer per-bet breakdown for the detail sheet.
 */

import { calculateSkinsBet, skinsConfigForSettlement } from './skins'
import { calculateNassau, calculateNassauGroup } from './nassau'
import { buildLeaderboard } from './scoring'
import { buildStablefordLeaderboard } from './stableford'

/** Display name for a player id (falls back to a dash). */
function nameOf(players, id) {
  return players.find((p) => p.id === id)?.name ?? '—'
}

/**
 * Participants in a bet — scopes the field to `bet.playerIds` so live pills
 * agree with the final settlement in betResults.js. Falls back to the full
 * field when a bet has no playerIds (legacy/edge data).
 */
function participants(bet, players) {
  if (!bet.playerIds?.length) return players
  return players.filter((p) => bet.playerIds.includes(p.id))
}

/** Format a net-to-par number the golf way: E, +2, -1. */
function fmtToPar(n) {
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : `${n}`
}

/** Net strokes for a player on a hole, or null if unplayed. */
function netHole(scores, alloc, pid, hole) {
  const gross = scores[pid]?.[hole]
  if (gross == null) return null
  return Math.max(0, gross - (alloc[pid]?.[hole] ?? 0))
}

/**
 * Signed match-play standing between two players over holes 1..thru.
 * Positive = p1 ahead by that many holes (net), negative = p2 ahead.
 */
function pairStanding(p1, p2, scores, alloc, thru) {
  let up = 0
  for (let hole = 1; hole <= thru; hole++) {
    const a = netHole(scores, alloc, p1, hole)
    const b = netHole(scores, alloc, p2, hole)
    if (a == null || b == null) continue // only count holes both have played
    if (a < b) up += 1
    else if (b < a) up -= 1
  }
  return up
}

/** Nassau pill — current overall standing; detail lines from the engine. */
function nassauPill(bet, players, scores, pars, alloc) {
  const inBet = participants(bet, players)
  if (inBet.length < 2) {
    return { label: '—', detailLines: ['Need at least two players.'] }
  }

  const thru = Object.keys(pars).length

  if (inBet.length === 2) {
    const up = pairStanding(inBet[0].id, inBet[1].id, scores, alloc, thru)
    const leader = up > 0 ? inBet[0] : up < 0 ? inBet[1] : null
    const label = leader ? `${leader.name} ${Math.abs(up)} up` : 'All square'
    const { lines } = calculateNassau(
      inBet[0],
      inBet[1],
      scores,
      pars,
      alloc,
      bet.config
    )
    return { label, detailLines: lines }
  }

  // 3–4 players: aggregate signed holes-up across every pairing to find who's
  // leading the Nassau overall.
  const totals = Object.fromEntries(inBet.map((p) => [p.id, 0]))
  for (let i = 0; i < inBet.length; i++) {
    for (let j = i + 1; j < inBet.length; j++) {
      const up = pairStanding(inBet[i].id, inBet[j].id, scores, alloc, thru)
      totals[inBet[i].id] += up
      totals[inBet[j].id] -= up
    }
  }
  const ranked = [...inBet].sort((a, b) => totals[b.id] - totals[a.id])
  const top = ranked[0]
  const allEven = ranked.every((p) => totals[p.id] === totals[top.id])
  const label = allEven ? 'All square' : `${top.name} leads`
  const detailLines = calculateNassauGroup(
    inBet,
    scores,
    pars,
    alloc,
    bet.config
  ).flatMap((r) => r.lines)
  return { label, detailLines }
}

/** Skins pill — carried pot if currently carrying, else the money leader. */
function skinsPill(bet, players, scores, pars, alloc, skinFlags, sideGameFlags, allBets = []) {
  const inBet = participants(bet, players)
  const skinsConfig = skinsConfigForSettlement(bet.config, {
    hasStandaloneCtp: allBets.some((b) => b.type === 'ctp'),
    hasStandaloneLd: allBets.some((b) => b.type === 'longestDrive'),
  })
  const res = calculateSkinsBet(inBet, scores, pars, alloc, skinsConfig, skinFlags, sideGameFlags)
  const last = res.skinsByHole[res.skinsByHole.length - 1]
  const anyManual = Object.keys(res.holeTotals ?? {}).length > 0

  let label
  // Only surface a "carried" pot when nothing else has paid out yet — a manual
  // greenie/sandie hit means the leader/all-even framing is more informative.
  if (last && last.winner == null && !anyManual) {
    const carried = last.carryCount * (bet.config.valuePerSkin ?? 0) * Math.max(0, inBet.length - 1)
    label = `$${carried} riding`
  } else {
    const leader = [...inBet].sort(
      (a, b) => (res.payouts[b.id] ?? 0) - (res.payouts[a.id] ?? 0)
    )[0]
    const amt = leader ? res.payouts[leader.id] ?? 0 : 0
    label = amt > 0 ? `${leader.name} +$${amt}` : 'All even'
  }

  return { label, detailLines: res.lines }
}

/**
 * Stroke Purse pill — leader + pot size, scored by the round's format so the live
 * pill agrees with the final settlement: team gross (scramble), Stableford points,
 * or net strokes (default).
 */
function strokePursePill(bet, players, scores, pars, alloc, scoringType, teams) {
  const inBet = participants(bet, players)
  const pot =
    bet.config.mode === 'entry'
      ? (bet.config.entryFee ?? 0) * inBet.length
      : bet.config.totalPurse ?? 0

  // Scramble: lowest team gross total takes the pot.
  if (scoringType === 'scramble' && teams.length > 0) {
    const holes = Object.keys(pars).map(Number)
    const info = teams.map((t) => {
      let total = 0
      let thru = 0
      for (const h of holes) {
        const s = scores[t.id]?.[h]
        if (s == null) continue
        total += s
        thru += 1
      }
      return { team: t, total, thru }
    })
    const played = info.filter((ti) => ti.thru > 0).sort((a, b) => a.total - b.total)
    const label = played.length ? `${played[0].team.name} leads` : `$${pot} pot`
    const detailLines = [...info]
      .sort((a, b) => (b.thru > 0) - (a.thru > 0) || a.total - b.total)
      .map((ti) => `${ti.team.name} — ${ti.thru > 0 ? `${ti.total} gross` : '–'}`)
    return { label, detailLines }
  }

  // Stableford: highest points takes the pot.
  if (scoringType === 'stableford') {
    const board = buildStablefordLeaderboard(inBet, scores, pars, alloc)
    const leader = board[0]
    const label =
      leader && leader.thru > 0 ? `${leader.player.name} leads` : `$${pot} pot`
    const detailLines = board.map(
      (e) => `${e.rank}. ${e.player.name} — ${e.points} pts (thru ${e.thru})`
    )
    return { label, detailLines }
  }

  // Net strokes (default): lowest net takes the pot.
  const thru = Object.keys(pars).length
  const board = buildLeaderboard(inBet, scores, alloc, pars, thru)
  const leader = board[0]
  const label =
    leader && leader.thru > 0 ? `${leader.player.name} leads` : `$${pot} pot`
  const detailLines = board.map(
    (e) => `${e.rank}. ${e.player.name} — net ${fmtToPar(e.toPar)} (thru ${e.thru})`
  )
  return { label, detailLines }
}

/** Closest-to-pin pill — how many of the configured holes have a winner set. */
function ctpPill(bet, players, sideGameFlags) {
  const flags = sideGameFlags?.closestToPin ?? {}
  const holes = bet.config.holes ?? []
  const setCount = holes.filter((h) => flags[h]).length
  const label = `$${bet.config.amount} · ${setCount}/${holes.length}`
  const detailLines = holes.map(
    (h) => `Hole ${h}: ${flags[h] ? nameOf(players, flags[h]) : 'open'}`
  )
  return { label, detailLines: detailLines.length ? detailLines : ['No holes selected.'] }
}

/** Longest-drive pill — winner on the configured hole, if flagged. */
function longestDrivePill(bet, players, sideGameFlags) {
  const flags = sideGameFlags?.longestDrive ?? {}
  const hole = bet.config.hole
  const winner = hole == null ? null : flags[hole]
  const label =
    hole == null
      ? `$${bet.config.amount}`
      : `$${bet.config.amount} · ${winner ? nameOf(players, winner) : 'open'}`
  const detailLines = [
    `Hole ${hole ?? '—'}: ${winner ? nameOf(players, winner) : 'open'}`,
  ]
  return { label, detailLines }
}

const NAMES = {
  nassau: 'Nassau',
  skins: 'Skins',
  strokePurse: 'Purse',
  ctp: 'CTP',
  longestDrive: 'LD',
}

/**
 * Build live status pills for every active bet.
 *
 * @param {Object} args
 * @param {Array<{ id: string, type: string, playerIds: string[], config: object }>} args.bets
 * @param {Array<{ id: string, name?: string }>} args.players
 * @param {Object} args.scores - { [playerId]: { [hole]: number | null } }
 * @param {Object} args.pars - { [hole]: number }
 * @param {Object} args.strokeAllocations - { [playerId]: { [hole]: number } }
 * @param {{ closestToPin: object, longestDrive: object }} args.sideGameFlags
 * @param {Object} [args.skinFlags] - Per-hole manual skins { [hole]: { greenie: string[], sandie: string[] } }.
 * @param {string} [args.scoringType] - Round format; drives the Stroke Purse metric.
 * @param {Array<{ id: string, name: string, playerIds: string[] }>} [args.teams] - Scramble teams.
 * @returns {BetPill[]}
 */
export function summarizeBets({
  bets,
  players,
  scores,
  pars,
  strokeAllocations,
  sideGameFlags,
  skinFlags = {},
  scoringType = 'stroke',
  teams = [],
}) {
  return bets.map((bet) => {
    let result
    switch (bet.type) {
      case 'nassau':
        result = nassauPill(bet, players, scores, pars, strokeAllocations)
        break
      case 'skins':
        result = skinsPill(bet, players, scores, pars, strokeAllocations, skinFlags, sideGameFlags, bets)
        break
      case 'strokePurse':
        result = strokePursePill(
          bet,
          players,
          scores,
          pars,
          strokeAllocations,
          scoringType,
          teams
        )
        break
      case 'ctp':
        result = ctpPill(bet, players, sideGameFlags)
        break
      case 'longestDrive':
        result = longestDrivePill(bet, players, sideGameFlags)
        break
      default:
        result = { label: '—', detailLines: [] }
    }
    return {
      id: bet.id,
      type: bet.type,
      name: NAMES[bet.type] ?? bet.type,
      ...result,
    }
  })
}
