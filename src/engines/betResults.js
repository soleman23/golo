/**
 * betResults.js — Final-settlement orchestration.
 *
 * The payout-screen counterpart to betStatus.js's live pills: turns the persisted
 * bet list into normalized, display-ready result objects (net payouts, a one-line
 * headline, and a line-by-line breakdown) by running each bet's payout engine.
 * Also formats the shareable round summary. No React, no state.
 *
 * @typedef {Object} BetResult
 * @property {string} id - The bet's id.
 * @property {string} type - Bet type key.
 * @property {string} name - Display name.
 * @property {string} icon - Emoji icon.
 * @property {{ [playerId: string]: number }} payouts - Net per player for this bet.
 * @property {string} headline - Net result summary (e.g. "Mike won $10").
 * @property {string[]} lines - Per-segment / per-hole breakdown.
 */

import { calculateSkinsBet, skinsConfigForSettlement } from './skins'
import { calculateNassauPayouts } from './nassau'
import { calculateOverallPursePayouts } from './overallPurse'
import { calculatePressPayouts } from './pressBets'
import { calculateStrokePurse, calculateScramblePurse } from './strokePurse'
import { calculateCTP } from './ctp'
import { calculateLongestDrive } from './longestDrive'
import { getWolfOrder, calculateWolfResult, calculateWolfTotals } from './wolf'
import { calculateBBBPayouts } from './bingobangobongo'

const META = {
  nassau: { name: 'Nassau', icon: '🏆', glyph: 'nassau' },
  skins: { name: 'Skins', icon: '🎯', glyph: 'skins' },
  strokePurse: { name: 'Stroke Purse', icon: '💰', glyph: 'purse' },
  overallPurse: { name: 'Overall Purse', icon: '💰', glyph: 'purse' },
  ctp: { name: 'Closest to Pin', icon: '📍', glyph: 'closestToPin' },
  longestDrive: { name: 'Longest Drive', icon: '🚀', glyph: 'longestDrive' },
  wolf: { name: 'Wolf', icon: '🐺', glyph: 'wolf' },
  // Bingo Bango Bongo has no GoLo glyph — consumers fall back to its emoji.
  bingobangobongo: { name: 'Bingo Bango Bongo', icon: '🟢' },
}

/**
 * GoLo icon glyph name for a bet type, or null when no glyph exists (so the UI
 * can fall back to the emoji). Single source for the betting-vocabulary icons.
 * @param {string} type
 * @returns {string | null}
 */
export function betGlyphName(type) {
  return META[type]?.glyph ?? null
}

/** Display name for a player id (falls back to a dash). */
function nameOf(players, id) {
  return players.find((p) => p.id === id)?.name ?? '—'
}

/** Format a net-to-par number the golf way: E, +2, -1. */
function fmtToPar(n) {
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : `${n}`
}

/** Players who finished net-positive on a bet, biggest winner first. */
function winnersOf(players, payouts) {
  return Object.entries(payouts)
    .filter(([, amt]) => amt > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amt]) => ({ id, name: nameOf(players, id), amount: +amt.toFixed(2) }))
}

/** One-line net summary for a bet's card header. */
function headlineFor(players, payouts) {
  const winners = winnersOf(players, payouts)
  if (winners.length === 0) return 'Push ($0)'
  return winners.map((w) => `${w.name} won $${w.amount}`).join(', ')
}

/**
 * Build normalized results for every active bet by running its payout engine.
 *
 * Each bet is scored only over its own participants (bet.playerIds), so the
 * per-bet payouts and the aggregate settlement both stay correct.
 *
 * @param {Object} args
 * @param {Array<{ id: string, type: string, playerIds: string[], config: object }>} args.bets
 * @param {Array<{ id: string, name?: string }>} args.players
 * @param {Object} args.scores
 * @param {Object} args.pars
 * @param {Object} args.strokeAllocations
 * @param {{ closestToPin: object, longestDrive: object }} args.sideGameFlags
 * @param {Object} [args.skinFlags] - Per-hole manual skins { [hole]: { greenie: string[], sandie: string[] } }.
 * @param {Object} [args.wolfPicks] - Per-hole Wolf decisions { [hole]: { partnerId, blind } }.
 * @param {Object} [args.bbbFlags] - Per-hole BBB winners { [hole]: { bingo, bango, bongo } }.
 * @param {string} [args.scoringType] - Round format; drives Stroke Purse metric (stableford / scramble teams).
 * @param {Array<{ id: string, name: string, playerIds: string[] }>} [args.teams] - Scramble teams.
 * @param {Array<object>} [args.pressBets] - Manual press bets.
 * @returns {BetResult[]}
 */
export function buildBetResults({
  bets,
  players,
  scores,
  pars,
  strokeAllocations,
  sideGameFlags,
  skinFlags = {},
  wolfPicks = {},
  bbbFlags = {},
  scoringType = 'stroke',
  teams = [],
  pressBets = [],
}) {
  const results = bets.map((bet) => {
    const inBet = bet.playerIds?.length
      ? players.filter((p) => bet.playerIds.includes(p.id))
      : players
    let payouts = {}
    let lines = []

    switch (bet.type) {
      case 'nassau': {
        const r = calculateNassauPayouts(inBet, scores, pars, strokeAllocations, bet.config)
        payouts = r.payouts
        lines = r.lines
        break
      }
      case 'skins': {
        const skinsConfig = skinsConfigForSettlement(bet.config, {
          hasStandaloneCtp: bets.some((b) => b.type === 'ctp'),
          hasStandaloneLd: bets.some((b) => b.type === 'longestDrive'),
        })
        const r = calculateSkinsBet(inBet, scores, pars, strokeAllocations, skinsConfig, skinFlags, sideGameFlags)
        payouts = r.payouts
        lines = r.lines
        break
      }
      case 'strokePurse': {
        let r
        if (scoringType === 'scramble' && teams.length > 0) {
          // Purse between teams: lowest team total wins, split among members.
          r = calculateScramblePurse(teams, inBet, scores, pars, bet.config)
        } else {
          // Stableford pays the highest points; everything else lowest net.
          const metric = scoringType === 'stableford' ? 'stableford' : 'net'
          r = calculateStrokePurse(inBet, scores, pars, strokeAllocations, {
            ...bet.config,
            metric,
          })
        }
        payouts = r.payouts
        lines = r.lines
        break
      }
      case 'overallPurse': {
        const r = calculateOverallPursePayouts(
          inBet,
          scores,
          pars,
          strokeAllocations,
          bet.config,
          { teams: scoringType === 'scramble' ? teams : [] }
        )
        payouts = r.payouts
        lines = r.lines
        break
      }
      case 'ctp': {
        const r = calculateCTP(inBet, sideGameFlags, bet.config)
        payouts = r.payouts
        lines = r.lines
        break
      }
      case 'longestDrive': {
        const r = calculateLongestDrive(inBet, sideGameFlags, bet.config)
        payouts = r.payouts
        lines = r.lines
        break
      }
      case 'wolf': {
        const holes = Object.keys(pars)
          .map(Number)
          .sort((a, b) => a - b)
        const results = []
        for (const h of holes) {
          const pick = wolfPicks[h]
          if (!pick) continue
          const wolfId = getWolfOrder(inBet, h)
          const holeScores = {}
          inBet.forEach((p) => {
            holeScores[p.id] = scores[p.id]?.[h] ?? null
          })
          const r = calculateWolfResult(
            holeScores,
            wolfId,
            pick.partnerId,
            bet.config?.unit ?? bet.amount ?? 1,
            { blind: pick.blind }
          )
          results.push(r)
          const who = r.lone
            ? pick.blind
              ? 'blind Lone Wolf'
              : 'Lone Wolf'
            : `with ${nameOf(players, pick.partnerId)}`
          const outcome = r.result === 'wolf' ? 'win' : r.result === 'opponents' ? 'loss' : 'push'
          lines.push(`Hole ${h}: ${nameOf(players, wolfId)} ${who} — ${outcome}`)
        }
        payouts = calculateWolfTotals(results, inBet)
        break
      }
      case 'bingobangobongo': {
        // Store flags are { bingo, bango, bongo }; the engine wants *Winner keys.
        const flags = Object.values(bbbFlags).map((f) => ({
          bingoWinner: f?.bingo ?? null,
          bangoWinner: f?.bango ?? null,
          bongoWinner: f?.bongo ?? null,
        }))
        const r = calculateBBBPayouts(flags, inBet, bet.config?.valuePerPoint ?? 1)
        payouts = r.payouts
        lines = inBet.map((p) => {
          const pts = r.points[p.id] ?? 0
          return `${p.name}: ${pts} pt${pts === 1 ? '' : 's'}`
        })
        break
      }
      default:
        break
    }

    const meta = META[bet.type] ?? { name: bet.type, icon: '🎲' }
    return {
      id: bet.id,
      type: bet.type,
      name: meta.name,
      icon: meta.icon,
      payouts,
      lines,
      headline: headlineFor(inBet, payouts),
    }
  })

  if (pressBets.length > 0) {
    const pressOut = calculatePressPayouts(
      pressBets,
      players,
      scores,
      pars,
      strokeAllocations,
      teams
    )
    const hasPayout = Object.values(pressOut.payouts).some((v) => Math.abs(v) > 0.005)
    if (hasPayout || pressOut.lines.length > 0) {
      results.push({
        id: 'press-bets',
        type: 'press',
        name: 'Press',
        icon: '📣',
        payouts: pressOut.payouts,
        lines: pressOut.lines,
        headline: headlineFor(players, pressOut.payouts),
      })
    }
  }

  return results
}

/**
 * Format the shareable plain-text round summary.
 *
 * @param {Object} args
 * @param {{ course?: string, date?: string } | null} args.round
 * @param {Array<{ id: string, name?: string }>} args.players
 * @param {import('./scoring').LeaderboardEntry[]} args.leaderboard
 * @param {BetResult[]} args.betResults
 * @param {import('./payouts').Settlement[]} args.settlements
 * @param {string} [args.scoringType] - Round format; switches standings to points (stableford) etc.
 * @returns {string}
 */
export function formatRoundSummary({
  round,
  players,
  leaderboard,
  betResults,
  settlements,
  scoringType = 'stroke',
  scoring = 'net',
}) {
  const lines = []

  lines.push(`⛳ ${round?.course || 'Round'} — ${round?.date || ''}`.trim())
  lines.push(`Players: ${players.map((p) => p.name).join(', ')}`)
  lines.push('')

  lines.push('Final Standings:')
  leaderboard.forEach((e) => {
    if (scoringType === 'stableford') {
      lines.push(`${e.rank}. ${e.player.name} — ${e.points ?? e.net} pts`)
    } else {
      lines.push(`${e.rank}. ${e.player.name} — ${scoring === 'gross' ? 'Gross' : 'Net'} ${e.net} (${fmtToPar(e.toPar)})`)
    }
  })
  lines.push('')

  lines.push('💰 Payouts:')
  if (betResults.length === 0) {
    lines.push('No bets')
  } else {
    betResults.forEach((b) => {
      const winners = winnersOf(players, b.payouts)
      const text = winners.length
        ? winners.map((w) => `${w.name} wins $${w.amount}`).join(', ')
        : 'push'
      lines.push(`${b.name}: ${text}`)
    })
  }
  lines.push('')

  lines.push('Settle Up:')
  if (settlements.length === 0) {
    lines.push('All square')
  } else {
    settlements.forEach((s) => {
      lines.push(`${nameOf(players, s.from)} → ${nameOf(players, s.to)}: $${s.amount}`)
    })
  }

  return lines.join('\n')
}
