/**
 * strokePurse.js — Pure Stroke Purse payout math.
 *
 * The field antes into a pot and the best score(s) take it, always netting to
 * zero. Funding:
 *   - 'entry' mode: every player antes a flat `entryFee` (pot = entryFee × n).
 *   - 'total' mode: a fixed `totalPurse` is split into equal antes (pot / n each).
 *
 * The metric for "best" follows the round's format:
 *   - net strokes, lowest wins (stroke play / default),
 *   - Stableford points, highest wins,
 *   - team total strokes, lowest wins (scramble — see calculateScramblePurse).
 *
 * The pot is divided equally across the top `payTop` finishing positions; players
 * tied across paid positions split the combined money for those positions evenly.
 *
 * No React, no state.
 *
 * @typedef {Object} StrokePurseResult
 * @property {{ [playerId: string]: number }} payouts - Net per player (sums to ~0).
 * @property {string[]} lines - Human-readable per-player breakdown.
 */

import { buildLeaderboard } from './scoring'
import { buildStablefordLeaderboard } from './stableford'

/** Signed money string: "+$30", "-$10", "$0". */
function money(m) {
  if (m === 0) return '$0'
  return m > 0 ? `+$${m}` : `-$${Math.abs(m)}`
}

/** Pot size for a player count. */
function potFor(mode, entryFee, totalPurse, n) {
  return mode === 'entry' ? entryFee * n : totalPurse
}

/**
 * Distribute a pot across ranked entities (best-first), splitting tied positions.
 * @param {Array<{ id: string, score: number }>} ranked - Sorted best-first; ties share an adjacent score.
 * @param {number} pot
 * @param {number} payTop
 * @returns {{ [id: string]: number }} winnings per entity id
 */
function distributePot(ranked, pot, payTop) {
  const winnings = {}
  if (ranked.length === 0) return winnings
  const positionsPaid = Math.min(payTop, ranked.length)
  const perPosition = pot / positionsPaid

  let i = 0
  while (i < ranked.length && i < positionsPaid) {
    let j = i
    while (j < ranked.length && ranked[j].score === ranked[i].score) j += 1
    const groupSize = j - i
    const paidInGroup = Math.min(j, positionsPaid) - i
    const each = (perPosition * paidInGroup) / groupSize
    for (let k = i; k < j; k++) winnings[ranked[k].id] = each
    i = j
  }
  return winnings
}

/**
 * Calculate Stroke Purse payouts for an individual field.
 *
 * @param {Array<{ id: string, name?: string }>} players
 * @param {Object} scores - { [playerId]: { [hole]: number | null } }
 * @param {Object} pars - { [hole]: number }
 * @param {Object} strokeAllocations - { [playerId]: { [hole]: number } }
 * @param {{ mode: 'entry'|'total', entryFee: number, totalPurse: number, payTop: number, metric?: 'net'|'stableford' }} betConfig
 * @returns {StrokePurseResult}
 */
export function calculateStrokePurse(players, scores, pars, strokeAllocations, betConfig) {
  const { mode = 'entry', entryFee = 0, totalPurse = 0, payTop = 1, metric = 'net' } = betConfig

  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })
  const n = players.length
  if (n === 0) return { payouts, lines: [] }

  const pot = potFor(mode, entryFee, totalPurse, n)
  const ante = pot / n

  // Board comes pre-sorted best-first from the respective engine.
  let board
  let scoreOf
  let labelOf
  if (metric === 'stableford') {
    board = buildStablefordLeaderboard(players, scores, pars, strokeAllocations)
    scoreOf = (e) => e.points
    labelOf = (e) => `${e.points} pts`
  } else {
    const thru = Object.keys(pars).length
    board = buildLeaderboard(players, scores, strokeAllocations, pars, thru)
    scoreOf = (e) => e.net
    labelOf = (e) => `${e.net} net`
  }

  const played = board.filter((e) => e.thru > 0)
  if (played.length === 0) {
    return { payouts, lines: ['No scores posted yet.'] }
  }

  const ranked = played.map((e) => ({ id: e.player.id, score: scoreOf(e) }))
  const winnings = distributePot(ranked, pot, payTop)

  players.forEach((p) => {
    payouts[p.id] = +((winnings[p.id] ?? 0) - ante).toFixed(2)
  })

  const lines = board.map((e) => {
    const m = +((winnings[e.player.id] ?? 0) - ante).toFixed(2)
    return `${e.rank}. ${e.player.name} — ${labelOf(e)} · ${money(m)}`
  })

  return { payouts, lines }
}

/**
 * Calculate a team Stroke Purse (scramble): lowest team total strokes wins.
 *
 * Every player antes; the winning team's pot is split equally among its members.
 * Net per player = their share of team winnings − ante, so the table sums to ~0.
 *
 * @param {Array<{ id: string, name: string, playerIds: string[] }>} teams
 * @param {Array<{ id: string, name?: string }>} players - All players (for antes).
 * @param {Object} scores - Keyed by teamId in scramble.
 * @param {Object} pars
 * @param {{ mode: 'entry'|'total', entryFee: number, totalPurse: number, payTop: number }} betConfig
 * @returns {StrokePurseResult}
 */
export function calculateScramblePurse(teams, players, scores, pars, betConfig) {
  const { mode = 'entry', entryFee = 0, totalPurse = 0, payTop = 1 } = betConfig

  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })
  const n = players.length
  if (n === 0 || teams.length === 0) return { payouts, lines: [] }

  const pot = potFor(mode, entryFee, totalPurse, n)
  const ante = pot / n

  const holes = Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)

  // Team gross total over holes played (scramble plays gross by default).
  const teamInfo = teams.map((t) => {
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

  const playedTeams = teamInfo.filter((ti) => ti.thru > 0)
  if (playedTeams.length === 0) {
    return { payouts, lines: ['No scores posted yet.'] }
  }

  const ranked = [...playedTeams]
    .sort((a, b) => a.total - b.total)
    .map((ti) => ({ id: ti.team.id, score: ti.total }))
  const winnings = distributePot(ranked, pot, Math.min(payTop, playedTeams.length))

  players.forEach((p) => {
    const team = teams.find((t) => t.playerIds.includes(p.id))
    const teamWin = team ? winnings[team.id] ?? 0 : 0
    const share = team && team.playerIds.length ? teamWin / team.playerIds.length : 0
    payouts[p.id] = +(share - ante).toFixed(2)
  })

  const lines = [...teamInfo]
    .sort((a, b) => (b.thru > 0) - (a.thru > 0) || a.total - b.total)
    .map((ti) => {
      const win = +(winnings[ti.team.id] ?? 0).toFixed(2)
      return `${ti.team.name} — ${ti.thru > 0 ? `${ti.total} gross` : '–'}${
        win > 0 ? ` · wins $${win}` : ''
      }`
    })

  return { payouts, lines }
}

/* ---------------------------------------------------------------------------
 * TEST CASE — calculateStrokePurse: entry mode, winner takes all
 * ---------------------------------------------------------------------------
 *   4 players, $10 entry (pot $40), payTop 1, net metric.
 *   A shoots lowest net -> A nets +30, the other three net -10 each.
 *
 *   For Stableford, pass metric: 'stableford' and the highest points total wins.
 *   For scramble use calculateScramblePurse(teams, players, scores, pars, config):
 *   the lowest team total takes the pot, split among that team's members.
 * ------------------------------------------------------------------------- */
