/**
 * matchplay.js — Pure Match Play (hole-by-hole) scoring.
 *
 * Players compete hole by hole: low score wins the hole (1 up), ties are halved.
 * The match is decided when one side leads by more holes than remain. Results use
 * golf shorthand: "3&2" (3 up with 2 to play), "2 Up" (won on the last hole),
 * "All Square", or "1 Up (19th)" for a sudden-death extra hole.
 *
 * Works for singles or team match play — feed team best-ball scores per hole and
 * the same logic applies. Conceded holes are handled by the caller passing the
 * conceded winner ('p1'/'p2') as that hole's result.
 *
 * No React, no state.
 *
 * @typedef {Object} MatchStatus
 * @property {'p1'|'p2'|null} leader - Side currently ahead, or null if level.
 * @property {number} holesUp - How many holes the leader is ahead.
 * @property {number} holesPlayed - Holes completed so far.
 * @property {'active'|'complete'} status - Whether the match is still live.
 * @property {string} result - Human-readable match result/standing.
 */

/**
 * Decide a single hole.
 *
 * @param {number|null} player1Score - Side 1's score (gross or team best-ball).
 * @param {number|null} player2Score - Side 2's score.
 * @returns {'p1'|'p2'|'halved'|null} Winner, halved, or null if not both played.
 */
export function calculateHoleResult(player1Score, player2Score) {
  if (player1Score == null || player2Score == null) return null
  if (player1Score < player2Score) return 'p1'
  if (player2Score < player1Score) return 'p2'
  return 'halved'
}

/** English ordinal for extra-hole results (e.g. 19 -> "19th"). */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/**
 * Compute the running match status from a list of per-hole results.
 *
 * @param {Array<'p1'|'p2'|'halved'|null>} holeResults - Results in play order; nulls (unplayed) are ignored.
 * @param {number} [totalHoles=18] - Holes in the match (9 or 18). Extra holes are detected automatically.
 * @returns {MatchStatus}
 */
export function calculateMatchStatus(holeResults, totalHoles = 18) {
  const played = holeResults.filter((r) => r === 'p1' || r === 'p2' || r === 'halved')
  const holesPlayed = played.length

  let p1 = 0
  let p2 = 0
  for (const r of played) {
    if (r === 'p1') p1 += 1
    else if (r === 'p2') p2 += 1
  }

  const holesUp = Math.abs(p1 - p2)
  const leader = p1 > p2 ? 'p1' : p2 > p1 ? 'p2' : null
  const remaining = Math.max(0, totalHoles - holesPlayed)
  const extra = holesPlayed > totalHoles

  // Decided the moment the lead exceeds the holes left to play.
  const clinched = holesUp > 0 && holesUp > remaining
  const finishedRegulation = holesPlayed >= totalHoles

  let status
  let result

  if (clinched) {
    status = 'complete'
    if (remaining > 0) {
      result = `${holesUp}&${remaining}` // won before the last hole, e.g. "3&2"
    } else if (extra) {
      result = `${holesUp} Up (${ordinal(holesPlayed)})` // sudden-death, e.g. "1 Up (19th)"
    } else {
      result = `${holesUp} Up` // won on the final regulation hole, e.g. "2 Up"
    }
  } else if (finishedRegulation && !extra) {
    status = 'complete'
    result = holesUp === 0 ? 'All Square' : `${holesUp} Up`
  } else {
    status = 'active'
    result = holesUp === 0 ? 'All Square' : `${holesUp} Up`
  }

  return { leader, holesUp, holesPlayed, status, result }
}

function parseScore(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Per-hole match results for one pairing (net scores + concessions).
 */
export function buildHoleResults(side1, side2, scores, allocations, concededHoles, holeNumbers) {
  const a1 = allocations[side1.id] ?? {}
  const a2 = allocations[side2.id] ?? {}
  const results = []
  for (const h of holeNumbers) {
    const conceded = concededHoles[h]
    if (conceded) {
      results.push(conceded === side1.id ? 'p1' : 'p2')
      continue
    }
    const s1 = parseScore(scores[side1.id]?.[h])
    const s2 = parseScore(scores[side2.id]?.[h])
    if (s1 == null || s2 == null) continue
    const n1 = Math.max(0, s1 - (a1[h] ?? 0))
    const n2 = Math.max(0, s2 - (a2[h] ?? 0))
    results.push(calculateHoleResult(n1, n2))
  }
  return results
}

/**
 * All head-to-head pairings for a match-play round.
 */
export function buildMatchPairings(players, scores, allocations, concededHoles, pars, totalHoles) {
  const holeNumbers = Object.keys(pars)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((h) => h <= totalHoles)
  const pairs = []
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const side1 = players[i]
      const side2 = players[j]
      const holeResults = buildHoleResults(side1, side2, scores, allocations, concededHoles, holeNumbers)
      pairs.push({ side1, side2, status: calculateMatchStatus(holeResults, totalHoles) })
    }
  }
  return pairs
}

/**
 * Leaderboard rows for match play (compatible with stroke leaderboard shape).
 */
export function buildMatchplayLeaderboard(players, pairings) {
  if (!players.length || !pairings.length) return []

  if (players.length === 2 && pairings.length === 1) {
    const { side1, side2, status } = pairings[0]
    const p1Standing =
      status.leader === 'p1'
        ? status.result
        : status.leader === 'p2'
          ? `${status.holesUp} Down`
          : status.result
    const p2Standing =
      status.leader === 'p2'
        ? status.result
        : status.leader === 'p1'
          ? `${status.holesUp} Down`
          : status.result
    const entries = [
      {
        player: side1,
        result: p1Standing,
        holesUp: status.leader === 'p1' ? status.holesUp : status.leader === 'p2' ? -status.holesUp : 0,
        thru: status.holesPlayed,
      },
      {
        player: side2,
        result: p2Standing,
        holesUp: status.leader === 'p2' ? status.holesUp : status.leader === 'p1' ? -status.holesUp : 0,
        thru: status.holesPlayed,
      },
    ]
    entries.sort((a, b) => b.holesUp - a.holesUp)
    return entries.map((e, i) => ({
      rank: i + 1,
      player: e.player,
      result: e.result,
      holesUp: e.holesUp,
      thru: e.thru,
      gross: 0,
      net: e.holesUp,
      toPar: 0,
      points: null,
    }))
  }

  const wins = Object.fromEntries(players.map((p) => [p.id, 0]))
  const maxUp = Object.fromEntries(players.map((p) => [p.id, 0]))
  const results = Object.fromEntries(players.map((p) => [p.id, 'All Square']))

  for (const { side1, side2, status } of pairings) {
    if (status.leader === 'p1') {
      wins[side1.id] += 1
      maxUp[side1.id] = Math.max(maxUp[side1.id], status.holesUp)
      results[side1.id] = `${status.result} vs ${side2.name}`
      if (results[side2.id] === 'All Square') results[side2.id] = `${status.holesUp} Down vs ${side1.name}`
    } else if (status.leader === 'p2') {
      wins[side2.id] += 1
      maxUp[side2.id] = Math.max(maxUp[side2.id], status.holesUp)
      results[side2.id] = `${status.result} vs ${side1.name}`
      if (results[side1.id] === 'All Square') results[side1.id] = `${status.holesUp} Down vs ${side2.name}`
    }
  }

  const thru = pairings[0]?.status?.holesPlayed ?? 0
  return [...players]
    .map((p) => ({
      player: p,
      result: results[p.id],
      holesUp: maxUp[p.id],
      wins: wins[p.id],
      thru,
    }))
    .sort((a, b) => b.wins - a.wins || b.holesUp - a.holesUp)
    .map((e, i) => ({
      rank: i + 1,
      player: e.player,
      result: e.result,
      holesUp: e.holesUp,
      thru: e.thru,
      gross: 0,
      net: e.holesUp,
      toPar: 0,
      points: null,
    }))
}

/* ---------------------------------------------------------------------------
 * TEST CASE — Match Play
 * ---------------------------------------------------------------------------
 *   calculateHoleResult(4, 5)  // -> 'p1'
 *   calculateHoleResult(5, 5)  // -> 'halved'
 *
 *   // 3 up with 2 to play (won 3&2):
 *   const r = ['p1','p1','halved','p1','halved','p1','p1','p2','halved',
 *              'p1','halved','p1','p1','p2','halved','p1']            // 16 holes
 *   calculateMatchStatus(r, 18)
 *   // => { leader: 'p1', holesUp: 5, holesPlayed: 16, ... }  (illustrative)
 *
 *   // All square through 18:
 *   calculateMatchStatus(Array(18).fill('halved'), 18)
 *   // => { leader: null, holesUp: 0, holesPlayed: 18, status: 'complete', result: 'All Square' }
 *
 *   // Sudden death, p1 wins the 19th:
 *   calculateMatchStatus([...Array(18).fill('halved'), 'p1'], 18)
 *   // => { leader: 'p1', holesUp: 1, holesPlayed: 19, status: 'complete', result: '1 Up (19th)' }
 * ------------------------------------------------------------------------- */
