/**
 * nassau.js — Pure Nassau (match-play) betting math.
 *
 * A Nassau is three separate bets: the front 9, the back 9, and the overall 18,
 * each scored as match play (most holes won). Each segment pays a fixed amount
 * to its winner; ties ("pushes") pay nothing.
 *
 * No React, no state. All net scoring uses per-player stroke allocations so
 * handicap matches are supported out of the box.
 *
 * @typedef {Object} SegmentResult
 * @property {string | null} winner - Winning playerId, or null on a push.
 * @property {number} amount - Amount the winner collects (0 on a push).
 *
 * @typedef {Object} NassauResult
 * @property {SegmentResult} front - Holes 1–9.
 * @property {SegmentResult} back - Holes 10–18.
 * @property {SegmentResult} overall - All holes.
 * @property {string[]} lines - Human-readable summary lines for the bet.
 */

/**
 * Net score for a single player on a single hole.
 * @param {Object} scores - { [playerId]: { [hole]: number | null } }
 * @param {Object} strokeAllocations - { [playerId]: { [hole]: number } }
 * @param {string} playerId
 * @param {number} hole
 * @returns {number | null} Net strokes, or null if the hole isn't scored.
 */
function netForHole(scores, strokeAllocations, playerId, hole) {
  const gross = scores[playerId]?.[hole]
  if (gross == null) return null
  const reduction = strokeAllocations[playerId]?.[hole] ?? 0
  return Math.max(0, gross - reduction)
}

/**
 * Score one match-play segment between two players over a set of holes.
 *
 * @param {string} p1 - Player 1 id.
 * @param {string} p2 - Player 2 id.
 * @param {Object} scores
 * @param {Object} strokeAllocations
 * @param {number[]} holes - Holes belonging to this segment.
 * @param {number} amount - Payout for winning the segment.
 * @returns {{ winner: string|null, amount: number, holesUp: number }} holesUp is p1's net hole lead.
 */
function scoreSegment(p1, p2, scores, strokeAllocations, holes, amount) {
  let holesUp = 0 // positive = p1 ahead, negative = p2 ahead
  for (const hole of holes) {
    const n1 = netForHole(scores, strokeAllocations, p1, hole)
    const n2 = netForHole(scores, strokeAllocations, p2, hole)
    // Only count holes both players have completed.
    if (n1 == null || n2 == null) continue
    if (n1 < n2) holesUp += 1
    else if (n2 < n1) holesUp -= 1
  }

  if (holesUp > 0) return { winner: p1, amount, holesUp }
  if (holesUp < 0) return { winner: p2, amount, holesUp }
  return { winner: null, amount: 0, holesUp: 0 } // pushed segment pays nothing
}

/**
 * Score a segment stroke-play style: lowest total net strokes over the segment
 * wins it (ties push). Only holes both players have completed are counted.
 *
 * @returns {{ winner: string|null, amount: number, diff: number }} diff is the winning margin in strokes.
 */
function scoreSegmentStroke(p1, p2, scores, strokeAllocations, holes, amount) {
  let t1 = 0
  let t2 = 0
  let counted = 0
  for (const hole of holes) {
    const n1 = netForHole(scores, strokeAllocations, p1, hole)
    const n2 = netForHole(scores, strokeAllocations, p2, hole)
    if (n1 == null || n2 == null) continue
    t1 += n1
    t2 += n2
    counted += 1
  }
  if (counted === 0) return { winner: null, amount: 0, diff: 0 }
  if (t1 < t2) return { winner: p1, amount, diff: t2 - t1 }
  if (t2 < t1) return { winner: p2, amount, diff: t1 - t2 }
  return { winner: null, amount: 0, diff: 0 }
}

/**
 * Compute automatic 2-down presses for a match-play segment.
 *
 * A press opens the hole after the most recently opened bet (the base match or
 * the latest press) reaches 2 down, and runs to the end of the segment. Presses
 * cascade: a press that itself goes 2 down spawns another. Each press is scored
 * match-play for the segment amount.
 *
 * @returns {Array<{ winner: string|null, amount: number, holesUp: number, startHole: number }>}
 */
function computePresses(p1, p2, scores, strokeAllocations, holes, amount) {
  const starts = [0] // index 0 is the base match; >=1 are presses
  const diffs = [0]

  for (let hi = 0; hi < holes.length; hi++) {
    const hole = holes[hi]
    const n1 = netForHole(scores, strokeAllocations, p1, hole)
    const n2 = netForHole(scores, strokeAllocations, p2, hole)
    if (n1 == null || n2 == null) continue
    const step = n1 < n2 ? 1 : n2 < n1 ? -1 : 0
    for (let m = 0; m < starts.length; m++) {
      if (starts[m] <= hi) diffs[m] += step
    }
    // Open a new press off the latest bet when it hits 2 down, if holes remain.
    const last = starts.length - 1
    if (Math.abs(diffs[last]) >= 2 && hi + 1 < holes.length) {
      starts.push(hi + 1)
      diffs.push(0)
    }
  }

  const presses = []
  for (let m = 1; m < starts.length; m++) {
    const d = diffs[m]
    const winner = d > 0 ? p1 : d < 0 ? p2 : null
    presses.push({ winner, amount: winner ? amount : 0, holesUp: d, startHole: holes[starts[m]] })
  }
  return presses
}

/**
 * Split the played holes into front / back / overall buckets.
 * Front = holes ≤ 9, back = holes > 9, overall = everything. Works for 9-hole
 * rounds too (back simply ends up empty).
 * @param {Object} pars - { [hole]: number }
 */
function segmentHoles(pars) {
  const holes = Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)
  return {
    front: holes.filter((h) => h <= 9),
    back: holes.filter((h) => h > 9),
    overall: holes,
  }
}

/**
 * Calculate a head-to-head Nassau between two players.
 *
 * @param {{ id: string, name?: string }} player1
 * @param {{ id: string, name?: string }} player2
 * @param {Object} scores - { [playerId]: { [hole]: number | null } }
 * @param {Object} pars - { [hole]: number }
 * @param {Object} strokeAllocations - { [playerId]: { [hole]: number } }
 * @param {{ frontAmount: number, backAmount: number, overallAmount: number }} betConfig
 * @returns {NassauResult}
 */
export function calculateNassau(player1, player2, scores, pars, strokeAllocations, betConfig) {
  const {
    frontAmount = 0,
    backAmount = 0,
    overallAmount = 0,
    style = 'match', // 'match' = holes won; 'stroke' = total strokes per segment
    autoPress = false, // open a press when a side goes 2 down (match style only)
  } = betConfig
  const { front, back, overall } = segmentHoles(pars)
  const p1 = player1.id
  const p2 = player2.id
  const name = (id) => (id === p1 ? player1.name ?? p1 : player2.name ?? p2)

  // Score one segment in the configured style. Presses only apply to match play.
  const scoreSeg = (holes, amount) => {
    if (style === 'stroke') {
      return { ...scoreSegmentStroke(p1, p2, scores, strokeAllocations, holes, amount), presses: [] }
    }
    const base = scoreSegment(p1, p2, scores, strokeAllocations, holes, amount)
    const presses = autoPress
      ? computePresses(p1, p2, scores, strokeAllocations, holes, amount)
      : []
    return { ...base, presses }
  }

  const frontResult = scoreSeg(front, frontAmount)
  const backResult = scoreSeg(back, backAmount)
  const overallResult = scoreSeg(overall, overallAmount)

  const segLine = (label, r) => {
    if (!r.winner) return `${label}: push`
    const margin = style === 'stroke' ? `by ${Math.abs(r.diff)}` : `${Math.abs(r.holesUp)} up`
    return `${label}: ${name(r.winner)} wins $${r.amount} (${margin})`
  }
  const pressLines = (r) =>
    (r.presses ?? []).map((pr) =>
      pr.winner
        ? `  Press (from hole ${pr.startHole}): ${name(pr.winner)} wins $${pr.amount} (${Math.abs(pr.holesUp)} up)`
        : `  Press (from hole ${pr.startHole}): push`
    )

  const lines = [
    segLine('Front 9', frontResult),
    ...pressLines(frontResult),
    segLine('Back 9', backResult),
    ...pressLines(backResult),
    segLine('Overall', overallResult),
    ...pressLines(overallResult),
  ]

  // Public shape: winner + amount, plus any presses (also winner + amount).
  const segment = (r) => ({
    winner: r.winner,
    amount: r.amount,
    presses: (r.presses ?? []).map((pr) => ({ winner: pr.winner, amount: pr.amount })),
  })

  return {
    front: segment(frontResult),
    back: segment(backResult),
    overall: segment(overallResult),
    lines,
  }
}

/**
 * Run every head-to-head Nassau pairing for a 3–4 player group.
 *
 * @param {Array<{ id: string, name?: string }>} players - 2–4 players.
 * @param {Object} scores
 * @param {Object} pars
 * @param {Object} strokeAllocations
 * @param {{ frontAmount: number, backAmount: number, overallAmount: number }} betConfig
 * @returns {NassauResult[]} One result per unique pairing.
 */
export function calculateNassauGroup(players, scores, pars, strokeAllocations, betConfig) {
  const results = []
  // Each unordered pair plays its own Nassau.
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      results.push(
        calculateNassau(players[i], players[j], scores, pars, strokeAllocations, betConfig),
      )
    }
  }
  return results
}

/**
 * Aggregate a group Nassau into net per-player payouts.
 *
 * Runs every head-to-head pairing, then for each segment credits the winner and
 * debits the loser by the segment amount, so the result sums to zero across the
 * group. Detail lines are prefixed with the pairing when more than two players
 * are involved.
 *
 * @param {Array<{ id: string, name?: string }>} players - Participants in the bet (2–4).
 * @param {Object} scores
 * @param {Object} pars
 * @param {Object} strokeAllocations
 * @param {{ frontAmount: number, backAmount: number, overallAmount: number }} betConfig
 * @returns {{ payouts: { [playerId: string]: number }, lines: string[] }}
 */
export function calculateNassauPayouts(players, scores, pars, strokeAllocations, betConfig) {
  const payouts = {}
  players.forEach((p) => {
    payouts[p.id] = 0
  })

  const lines = []
  const showPairing = players.length > 2

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i]
      const p2 = players[j]
      const r = calculateNassau(p1, p2, scores, pars, strokeAllocations, betConfig)

      for (const seg of [r.front, r.back, r.overall]) {
        // The base segment plus any presses each pay out independently.
        for (const sub of [seg, ...(seg.presses ?? [])]) {
          if (sub.winner) {
            const loser = sub.winner === p1.id ? p2.id : p1.id
            payouts[sub.winner] += sub.amount
            payouts[loser] -= sub.amount
          }
        }
      }

      if (showPairing) lines.push(`${p1.name} vs ${p2.name}`)
      lines.push(...r.lines.map((l) => (showPairing ? `  ${l}` : l)))
    }
  }

  players.forEach((p) => {
    payouts[p.id] = +payouts[p.id].toFixed(2)
  })

  return { payouts, lines }
}

/* ---------------------------------------------------------------------------
 * TEST CASE — calculateNassau: 2 players with handicaps, $5/segment
 * ---------------------------------------------------------------------------
 * 18 holes, all par 4. Bob gets 1 handicap stroke on hole 1.
 *   - Front 9: Ann shoots 4s, Bob shoots 5s. Bob's stroke ties hole 1; Ann wins
 *     holes 2–9 -> Ann +8 -> wins the front.
 *   - Back 9:  Bob shoots 4s, Ann shoots 5s -> Bob wins all 9 -> wins the back.
 *   - Overall: Ann +8 (front) and -9 (back) = -1 -> Bob wins overall.
 *
 *   const player1 = { id: 'a', name: 'Ann' }
 *   const player2 = { id: 'b', name: 'Bob' }
 *   const pars = {}; for (let h = 1; h <= 18; h++) pars[h] = 4
 *   const scores = { a: {}, b: {} }
 *   for (let h = 1; h <= 9; h++)  { scores.a[h] = 4; scores.b[h] = 5 } // front
 *   for (let h = 10; h <= 18; h++) { scores.a[h] = 5; scores.b[h] = 4 } // back
 *   const strokeAllocations = { a: {}, b: { 1: 1 } } // Bob: 1 stroke on hole 1
 *   const betConfig = { frontAmount: 5, backAmount: 5, overallAmount: 5 }
 *
 *   calculateNassau(player1, player2, scores, pars, strokeAllocations, betConfig)
 *   // => {
 *   //   front:   { winner: 'a', amount: 5 },
 *   //   back:    { winner: 'b', amount: 5 },
 *   //   overall: { winner: 'b', amount: 5 },
 *   //   lines: [
 *   //     'Front 9: Ann wins $5 (8 up)',
 *   //     'Back 9: Bob wins $5 (9 up)',
 *   //     'Overall: Bob wins $5 (1 up)',
 *   //   ],
 *   // }
 * ------------------------------------------------------------------------- */
