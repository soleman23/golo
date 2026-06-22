import { calculateCTP } from './ctp'
import { calculateLongestDrive } from './longestDrive'

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

    // Only settle a skin once every participant has posted the hole. This keeps
    // live payout views from awarding a skin while the group is still entering scores.
    if (players.length === 0 || scored.length < players.length) continue

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

/** Manual skin types that are tracked by hand during scoring (not derivable
 * from strokes). Greenie is par-3 only; both stack and pay head-to-head. */
export const MANUAL_SKIN_TYPES = ['greenie', 'sandie']

/** Longest-drive hole presets (wizard index → hole number). */
export const LONGEST_DRIVE_HOLES = [8, 13, 18]

/** Par-3 holes on the card, optionally limited to the back nine. */
export function skinsCtpHoles(skinsConfig, pars) {
  if (!skinsConfig?.selectedSkins?.closestToPin) return []
  const totalHoles = Object.keys(pars).length
  const par3 = Array.from({ length: totalHoles }, (_, i) => i + 1).filter((h) => pars[h] === 3)
  return (skinsConfig.ctpHoles ?? 0) === 1 ? par3.filter((h) => h > 9) : par3
}

/** Configured longest-drive hole, or null when disabled or not on the card. */
export function skinsLongestDriveHole(skinsConfig, pars = null) {
  if (!skinsConfig?.selectedSkins?.longestDrive) return null
  const hole = LONGEST_DRIVE_HOLES[skinsConfig.ldHole ?? 0] ?? LONGEST_DRIVE_HOLES[0]
  if (pars != null && pars[hole] == null && pars[String(hole)] == null) return null
  return hole
}

/** Avoid paying CTP/LD twice when the same side game also exists as a standalone bet. */
export function skinsConfigForSettlement(config, { hasStandaloneCtp = false, hasStandaloneLd = false } = {}) {
  if (!hasStandaloneCtp && !hasStandaloneLd) return config
  const sc = config.skinsConfig
  if (!sc?.selectedSkins) return config
  return {
    ...config,
    skinsConfig: {
      ...sc,
      selectedSkins: {
        ...sc.selectedSkins,
        ...(hasStandaloneCtp ? { closestToPin: false } : {}),
        ...(hasStandaloneLd ? { longestDrive: false } : {}),
      },
    },
  }
}

/**
 * Head-to-head manual skins (greenie / sandie).
 *
 * Each "hit" is worth `valuePerSkin`, paid to the achiever by every OTHER player
 * in the bet. So a $2 sandie by Mike in a 4-some nets Mike +$6 and each opponent
 * -$2. Skins stack: multiple players can earn the same type on a hole, and one
 * player can earn more than one type. Always sums to zero across the field.
 *
 * @param {Array<{ id: string, name?: string }>} players - Players in the bet.
 * @param {Object} skinFlags - { [hole]: { greenie: string[], sandie: string[] } }
 * @param {{ valuePerSkin?: number, greenie?: boolean, sandie?: boolean }} config
 * @returns {{ payouts: { [playerId: string]: number }, lines: string[], holeTotals: { [hole: number]: number } }}
 */
export function calculateManualSkins(players, skinFlags = {}, config = {}) {
  const { valuePerSkin = 0, greenie = false, sandie = false } = config
  const enabled = MANUAL_SKIN_TYPES.filter((t) => (t === 'greenie' ? greenie : sandie))

  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })
  const lines = []
  const holeTotals = {}

  if (players.length < 2 || valuePerSkin <= 0 || enabled.length === 0) {
    return { payouts, lines, holeTotals }
  }

  const validIds = new Set(players.map((p) => p.id))
  const labelOf = { greenie: 'Greenie', sandie: 'Sandie' }
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'

  const holes = Object.keys(skinFlags)
    .map(Number)
    .sort((a, b) => a - b)

  for (const hole of holes) {
    const holeFlags = skinFlags[hole] ?? {}
    let holeHits = 0
    for (const type of enabled) {
      const achievers = [...new Set((holeFlags[type] ?? []).filter((id) => validIds.has(id)))]
      for (const id of achievers) {
        // Head-to-head: every other player pays `valuePerSkin` to the achiever.
        players.forEach((p) => {
          if (p.id === id) payouts[id] += valuePerSkin * (players.length - 1)
          else payouts[p.id] -= valuePerSkin
        })
        holeHits += 1
        lines.push(`Hole ${hole}: ${nameOf(id)} ${labelOf[type]} +$${valuePerSkin}`)
      }
    }
    if (holeHits > 0) holeTotals[hole] = holeHits * valuePerSkin
  }

  players.forEach((p) => {
    payouts[p.id] = +payouts[p.id].toFixed(2)
  })

  return { payouts, lines, holeTotals }
}

/**
 * Full Skins settlement: the classic low-score skins (standard + carryover) PLUS
 * the manually tracked head-to-head greenie/sandie skins, merged into one result
 * so live pills, payouts, and history all agree.
 *
 * @param {Array<{ id: string, name?: string }>} players
 * @param {Object} scores
 * @param {Object} pars
 * @param {Object} strokeAllocations
 * @param {Object} config - The skins bet config (with optional `skinsConfig`).
 * @param {Object} [skinFlags] - { [hole]: { greenie: string[], sandie: string[] } }
 * @param {{ closestToPin?: object, longestDrive?: object }} [sideGameFlags]
 * @returns {{ payouts: { [playerId: string]: number }, lines: string[], skinsByHole: SkinHole[], holeTotals: { [hole: number]: number } }}
 */
export function calculateSkinsBet(players, scores, pars, strokeAllocations, config = {}, skinFlags = {}, sideGameFlags = {}) {
  const lowScore = calculateSkins(players, scores, pars, strokeAllocations, config)

  const sc = config.skinsConfig ?? {}
  const sel = sc.selectedSkins ?? {}
  const base = sc.baseSkinValue ?? config.valuePerSkin ?? 0
  const manual = calculateManualSkins(players, skinFlags, {
    valuePerSkin: base,
    greenie: !!sel.greenie,
    sandie: !!sel.sandie,
  })

  const sideLines = []
  const sidePayouts = {}
  players.forEach((p) => {
    sidePayouts[p.id] = 0
  })

  if (sel.closestToPin) {
    const ctp = calculateCTP(players, sideGameFlags, { amount: base, holes: skinsCtpHoles(sc, pars) })
    sideLines.push(...ctp.lines)
    players.forEach((p) => {
      sidePayouts[p.id] += ctp.payouts[p.id] ?? 0
    })
  }
  if (sel.longestDrive) {
    const ld = calculateLongestDrive(players, sideGameFlags, { amount: base, hole: skinsLongestDriveHole(sc, pars) })
    sideLines.push(...ld.lines)
    players.forEach((p) => {
      sidePayouts[p.id] += ld.payouts[p.id] ?? 0
    })
  }

  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = +(((lowScore.payouts[p.id] ?? 0) + (manual.payouts[p.id] ?? 0) + (sidePayouts[p.id] ?? 0)).toFixed(2))
  })

  const lowLines = lowScore.skinsByHole.map((s) =>
    s.winner
      ? `Hole ${s.hole}: ${players.find((p) => p.id === s.winner)?.name ?? '—'} wins $${s.value}`
      : `Hole ${s.hole}: tie${s.carryCount > 1 ? ` (carry ×${s.carryCount})` : ''}`
  )

  return {
    payouts,
    lines: [...lowLines, ...manual.lines, ...sideLines],
    skinsByHole: lowScore.skinsByHole,
    holeTotals: manual.holeTotals,
  }
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
