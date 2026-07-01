import { calculateCTP } from './ctp'
import { calculateLongestDrive } from './longestDrive'

/**
 * skins.js — Pure Skins betting math.
 *
 * Each hole is worth one skin. A skin is won outright by the single lowest score
 * on the hole; if two or more players tie for low, the skin "carries over" and is
 * added to the next hole's pot. The next outright winner sweeps all carried skins.
 *
 * Cost model (transparent, nets to zero): every active skin is paid head-to-head.
 * If Alex wins a $5 skin in a foursome, each of the other 3 players pays Alex $5.
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

const grossScore = (scores, playerId, hole) => scores[playerId]?.[hole] ?? null
const completedHole = (players, scores, hole) =>
  players.length > 0 && players.every((p) => grossScore(scores, p.id, hole) != null)

function roundMoney(n) {
  const value = +Number(n || 0).toFixed(2)
  return Object.is(value, -0) ? 0 : value
}

function addHeadToHeadPayout(players, payouts, winnerId, perPlayerAmount) {
  const amount = Number(perPlayerAmount) || 0
  if (!winnerId || players.length < 2 || amount <= 0) return 0
  const others = players.filter((p) => p.id !== winnerId)
  payouts[winnerId] += amount * others.length
  others.forEach((p) => {
    payouts[p.id] -= amount
  })
  return amount * others.length
}

/** Split end-of-round carried skins among tied leaders (from each non-leader). */
function settleCarriedSkins(players, payouts, leaderIds, carried, valuePerSkin) {
  if (carried <= 0 || leaderIds.length === 0) return 0
  const leaders = new Set(leaderIds)
  const nonLeaders = players.filter((p) => !leaders.has(p.id))
  if (nonLeaders.length === 0) return 0
  const share = (carried * valuePerSkin) / leaderIds.length
  let total = 0
  for (const winnerId of leaderIds) {
    for (const other of nonLeaders) {
      payouts[winnerId] = (payouts[winnerId] ?? 0) + share
      payouts[other.id] = (payouts[other.id] ?? 0) - share
      total += share
    }
  }
  return total
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
  if (players.length < 2 || valuePerSkin <= 0) return { skinsByHole, payouts }

  let carried = 0 // skins carried in from prior ties

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
      // Outright winner sweeps this skin plus any carried skins from every opponent.
      const perOpponent = carryCount * valuePerSkin
      const winner = leaders[0].id
      const value = addHeadToHeadPayout(players, payouts, winner, perOpponent)
      skinsByHole.push({ hole, winner, value, carryCount })
      carried = 0
    } else {
      // Tie: skin carries (if enabled) — nobody is paid on this hole.
      skinsByHole.push({ hole, winner: null, value: 0, carryCount })
      carried = carryover ? carryCount : 0
    }
  }

  // Settle carried skins when the round ends on a tie among a subset of the field.
  if (carried > 0 && carryover && skinsByHole.length > 0) {
    const lastEntry = skinsByHole[skinsByHole.length - 1]
    if (lastEntry.winner == null && lastEntry.hole != null) {
      const hole = lastEntry.hole
      const scored = players
        .map((p) => ({ id: p.id, score: holeScore(scores, strokeAllocations, p.id, hole, useNetScores) }))
        .filter((s) => s.score != null)
      if (scored.length === players.length) {
        const lowest = Math.min(...scored.map((s) => s.score))
        const leaderIds = scored.filter((s) => s.score === lowest).map((s) => s.id)
        const value = settleCarriedSkins(players, payouts, leaderIds, carried, valuePerSkin)
        if (value > 0) {
          lastEntry.value = value
          if (leaderIds.length === 1) lastEntry.winner = leaderIds[0]
        }
      }
    }
  }

  players.forEach((p) => {
    payouts[p.id] = roundMoney(payouts[p.id])
  })

  return { skinsByHole, payouts }
}

/**
 * Automatic bonus skins derived directly from gross score.
 *
 * Birdie pays every birdie-or-better player independently. Eagle carries hole by
 * hole until exactly one player makes eagle-or-better, then resets.
 */
export function calculateBonusSkins(players, scores, pars, config = {}) {
  const { valuePerSkin = 0, birdie = false, eagle = false } = config
  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })
  const lines = []
  const holeTotals = {}

  if (players.length < 2 || valuePerSkin <= 0 || (!birdie && !eagle)) {
    return { payouts, lines, holeTotals }
  }

  const holes = Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'
  let eagleCarry = 1

  for (const hole of holes) {
    const par = Number(pars[hole])
    if (!Number.isFinite(par) || !completedHole(players, scores, hole)) continue

    if (birdie) {
      const birdies = players.filter((p) => grossScore(scores, p.id, hole) <= par - 1)
      for (const p of birdies) {
        const value = addHeadToHeadPayout(players, payouts, p.id, valuePerSkin)
        if (value > 0) {
          holeTotals[hole] = (holeTotals[hole] ?? 0) + value
          lines.push(`Hole ${hole}: ${nameOf(p.id)} Birdie +$${value}`)
        }
      }
    }

    if (eagle) {
      const eagles = players.filter((p) => grossScore(scores, p.id, hole) <= par - 2)
      if (eagles.length === 1) {
        const perOpponent = eagleCarry * valuePerSkin
        const value = addHeadToHeadPayout(players, payouts, eagles[0].id, perOpponent)
        if (value > 0) {
          holeTotals[hole] = (holeTotals[hole] ?? 0) + value
          lines.push(`Hole ${hole}: ${nameOf(eagles[0].id)} Eagle +$${value}${eagleCarry > 1 ? ` (${eagleCarry} skins)` : ''}`)
        }
        eagleCarry = 1
      } else if (eagles.length > 1) {
        // Sole eagle wins the carry; ties on eagle-or-better carry forward only.
        eagleCarry += 1
      }
    }
  }

  players.forEach((p) => {
    payouts[p.id] = roundMoney(payouts[p.id])
  })

  return { payouts, lines, holeTotals }
}

/** Manual skin types that are tracked by hand during scoring (not derivable
 * from strokes). Greenie is par-3 only; both stack and pay head-to-head. */
export const MANUAL_SKIN_TYPES = ['greenie', 'sandie']

/** Par-5 holes on the card (longest drive is par-5 only). */
export function par5HolesFromPars(pars, totalHoles = null) {
  const n = totalHoles ?? Object.keys(pars).length
  return Array.from({ length: n }, (_, i) => i + 1).filter((h) => pars[h] === 5)
}

/** Resolve stored longest-drive selection to a hole number on this card. */
export function resolveLdHoleNumber(ldHole, pars) {
  const par5 = par5HolesFromPars(pars)
  if (par5.length === 0) return null
  if (ldHole == null) return par5[0]

  // Prefer an explicit hole number when that hole is par 5 on this card.
  if (pars[ldHole] === 5) return ldHole

  // Legacy: index into the par-5 list (saved before hole-number storage).
  if (Number.isInteger(ldHole) && ldHole >= 0 && ldHole < par5.length) {
    return par5[ldHole]
  }

  return par5[0]
}

/** Normalize wizard/persisted ldHole against the current course card. */
export function normalizeSkinsLdHole(ldHole, pars) {
  return resolveLdHoleNumber(ldHole, pars)
}

/** Par-3 holes on the card, optionally limited to the back nine. */
export function skinsCtpHoles(skinsConfig, pars) {
  if (!skinsConfig?.selectedSkins?.closestToPin) return []
  const totalHoles = Object.keys(pars).length
  const par3 = Array.from({ length: totalHoles }, (_, i) => i + 1).filter((h) => pars[h] === 3)
  return (skinsConfig.ctpHoles ?? 0) === 1 ? par3.filter((h) => h > 9) : par3
}

/** Configured longest-drive hole, or null when disabled, not on the card, or not par 5. */
export function skinsLongestDriveHole(skinsConfig, pars = null) {
  if (!skinsConfig?.selectedSkins?.longestDrive || pars == null) return null
  const hole = resolveLdHoleNumber(skinsConfig.ldHole, pars)
  return hole != null && pars[hole] === 5 ? hole : null
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
 * Greenie: par-3 only, exactly one flagged CTP player, and that player must make
 * par or better. Unclaimed Greenies carry to the next completed par 3.
 * Sandie: any flagged bunker player who makes par or better wins a flat skin.
 *
 * @param {Array<{ id: string, name?: string }>} players - Players in the bet.
 * @param {Object} skinFlags - { [hole]: { greenie: string[], sandie: string[] } }
 * @param {{ valuePerSkin?: number, greenie?: boolean, sandie?: boolean }} config
 * @returns {{ payouts: { [playerId: string]: number }, lines: string[], holeTotals: { [hole: number]: number } }}
 */
export function calculateManualSkins(players, skinFlags = {}, config = {}, scores = {}, pars = {}) {
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

  const par3Holes = Object.keys(pars)
    .map(Number)
    .filter((h) => pars[h] === 3)
  const flagHoles = Object.keys(skinFlags)
    .map(Number)
  const holes = [...new Set([...par3Holes, ...flagHoles])]
    .sort((a, b) => a - b)
  let greenieCarry = 1

  for (const hole of holes) {
    const holeFlags = skinFlags[hole] ?? {}
    const par = Number(pars[hole])
    if (!completedHole(players, scores, hole)) continue

    if (greenie && par === 3) {
      const achievers = [...new Set((holeFlags.greenie ?? []).filter((id) => validIds.has(id)))]
      if (achievers.length === 1 && grossScore(scores, achievers[0], hole) <= par) {
        const perOpponent = greenieCarry * valuePerSkin
        const value = addHeadToHeadPayout(players, payouts, achievers[0], perOpponent)
        if (value > 0) {
          holeTotals[hole] = (holeTotals[hole] ?? 0) + value
          lines.push(`Hole ${hole}: ${nameOf(achievers[0])} ${labelOf.greenie} +$${value}${greenieCarry > 1 ? ` (${greenieCarry} skins)` : ''}`)
        }
        greenieCarry = 1
      } else {
        greenieCarry += 1
      }
    }

    if (sandie) {
      const achievers = [...new Set((holeFlags.sandie ?? []).filter((id) => validIds.has(id)))]
      for (const id of achievers) {
        if (!Number.isFinite(par) || grossScore(scores, id, hole) > par) continue
        const value = addHeadToHeadPayout(players, payouts, id, valuePerSkin)
        if (value > 0) {
          holeTotals[hole] = (holeTotals[hole] ?? 0) + value
          lines.push(`Hole ${hole}: ${nameOf(id)} ${labelOf.sandie} +$${value}`)
        }
      }
    }
  }

  players.forEach((p) => {
    payouts[p.id] = roundMoney(payouts[p.id])
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
  const bonus = calculateBonusSkins(players, scores, pars, {
    valuePerSkin: base,
    birdie: !!sel.birdieBonusSkin,
    eagle: !!sel.eagleBonusSkin,
  })
  const manual = calculateManualSkins(players, skinFlags, {
    valuePerSkin: base,
    greenie: !!sel.greenie,
    sandie: !!sel.sandie,
  }, scores, pars)

  const sideLines = []
  const sidePayouts = {}
  players.forEach((p) => {
    sidePayouts[p.id] = 0
  })

  if (sel.closestToPin && !sel.greenie) {
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
    payouts[p.id] = roundMoney((lowScore.payouts[p.id] ?? 0) + (bonus.payouts[p.id] ?? 0) + (manual.payouts[p.id] ?? 0) + (sidePayouts[p.id] ?? 0))
  })

  const lowLines = lowScore.skinsByHole.map((s) =>
    s.winner
      ? `Hole ${s.hole}: ${players.find((p) => p.id === s.winner)?.name ?? '—'} Standard +$${s.value}${s.carryCount > 1 ? ` (${s.carryCount} skins)` : ''}`
      : `Hole ${s.hole}: tie${s.carryCount > 1 ? ` (carry ×${s.carryCount})` : ''}`
  )
  const holeTotals = { ...bonus.holeTotals, ...manual.holeTotals }
  for (const [hole, value] of Object.entries(manual.holeTotals)) {
    holeTotals[hole] = (bonus.holeTotals[hole] ?? 0) + value
  }

  return {
    payouts,
    lines: [...lowLines, ...bonus.lines, ...manual.lines, ...sideLines],
    skinsByHole: lowScore.skinsByHole,
    holeTotals,
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
 *   //     { hole: 3, winner: 'p1', value: 18, carryCount: 3 },
 *   //   ],
 *   //   payouts: { p1: 18, p2: -6, p3: -6, p4: -6 },  // sums to 0
 *   // }
 * ------------------------------------------------------------------------- */
