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
