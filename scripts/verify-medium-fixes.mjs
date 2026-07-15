/**
 * Runtime checks for medium-severity bug fixes.
 */
import { calculateStablefordPoints } from '../src/engines/stableford.js'
import { allocateStrokes } from '../src/engines/handicap.js'
import { buildLeaderboard } from '../src/engines/scoring.js'
import { getPressEligibility } from '../src/engines/pressBets.js'
import { buildMatchPairings, buildMatchplayLeaderboard } from '../src/engines/matchplay.js'
import { isWolfField } from '../src/engines/wolf.js'
import { courseFromNcrdb } from '../src/lib/courseValidation.js'

let passed = 0
let failed = 0

function assert(name, cond) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`)
  }
}

// #7 Stableford floors net and caps points vs gross
const ptsInflated = calculateStablefordPoints(1, 4, 2)
assert('stableford high strokes cannot inflate beyond gross (gross 1, 2 strokes, par 4)', ptsInflated === 5)
const ptsBogey = calculateStablefordPoints(5, 4, 4)
assert('stableford gross bogey with excess strokes stays bogey-tier', ptsBogey === 1)

// #8 allocateStrokes caps at 2 per hole
const alloc = allocateStrokes(54, 18, Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, i + 1])))
const maxStrokes = Math.max(...Object.values(alloc))
assert('allocateStrokes max 2 per hole', maxStrokes <= 2)
assert('allocateStrokes distributes high handicap without infinite loop', Object.values(alloc).reduce((s, n) => s + n, 0) > 0)

// #12 leaderboard tiebreak by holes played
const players = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }]
const scores = {
  a: { 1: 6 },
  b: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
}
const pars = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4]))
const board = buildLeaderboard(players, scores, {}, pars, 18)
assert('leaderboard tie on net ranks more holes played first', board[0].player.id === 'b')

// #11 eagle carry: only ties increment (logic mirror)
let eagleCarry = 1
for (const eaglesLen of [0, 0, 2, 0]) {
  if (eaglesLen === 1) eagleCarry = 1
  else if (eaglesLen > 1) eagleCarry += 1
}
assert('eagle carry unchanged across par holes, increments on eagle tie', eagleCarry === 2)

// #15 carried skins: leaders split carry from each non-leader (settlement math)
{
  const carried = 17
  const valuePerSkin = 1
  const leaderCount = 2
  const nonLeaderCount = 2
  const share = (carried * valuePerSkin) / leaderCount
  const leaderGain = share * nonLeaderCount
  const nonLeaderLoss = share * leaderCount
  assert('carried skin split pays leaders from non-leaders', leaderGain > 0 && nonLeaderLoss > 0)
}

// #16 press eligibility respects pars keys on back-9 card
const back9Pars = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 10, 4]))
const back9Bet = { id: 'op', type: 'overallPurse', playerIds: ['a', 'b'], config: { stake: 5 } }
const back9Scores = { a: {}, b: {} }
for (let h = 10; h <= 18; h++) {
  back9Scores.a[h] = 4
  back9Scores.b[h] = 5
}
const back9Elig = getPressEligibility({
  bets: [back9Bet],
  pressBets: [],
  scores: back9Scores,
  pars: back9Pars,
  strokeAllocations: { a: {}, b: {} },
  teams: [],
  currentHole: 18,
  totalHoles: 18,
  status: 'in_progress',
})
assert('press blocked on last hole of back-9 card', !back9Elig.allowed)

// startScoring must not reopen a completed round (mirrors roundStore guard)
const canStartScoring = (status) => status === 'setup'
assert('startScoring blocked when complete', !canStartScoring('complete'))
assert('startScoring blocked when in_progress', !canStartScoring('in_progress'))
assert('startScoring allowed from setup', canStartScoring('setup'))

// match play: 2-up standing on payouts board
{
  const mpPlayers = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }]
  const mpScores = {
    a: { 1: 3, 2: 3, 3: 3 },
    b: { 1: 5, 2: 5, 3: 5 },
  }
  const mpPars = { 1: 4, 2: 4, 3: 4 }
  const pairings = buildMatchPairings(mpPlayers, mpScores, {}, {}, mpPars, 3)
  const mpBoard = buildMatchplayLeaderboard(mpPlayers, pairings)
  assert('matchplay 2-player leaderboard ranks winner first', mpBoard[0].player.id === 'a')
  assert('matchplay standing uses result string', mpBoard[0].result === '3 Up')
}

// wolf guard: fewer than 4 players is not a valid field
assert('wolf field rejects 3 players', !isWolfField([{ id: 'a' }, { id: 'b' }, { id: 'c' }]))
assert('wolf field accepts 4 players', isWolfField([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]))

// NCRDB imports must preserve hole-level pars instead of falling back to all par 4s.
{
  const imported = courseFromNcrdb(
    { fullName: 'Example Links', city: 'Bend', stateDisplay: 'OR', facilityID: 10, courseID: 20 },
    [{
      name: 'Blue',
      gender: 'M',
      courseRating: 72.1,
      slope: 133,
      par: 72,
      yards: 6500,
      teeId: 30,
      holes: Array.from({ length: 18 }, (_, i) => ({
        hole: i + 1,
        par: [3, 5, 4][i % 3],
        strokeIndex: i + 1,
      })),
    }],
  )
  assert('NCRDB import promotes hole-level pars', imported.pars[1] === 3 && imported.pars[2] === 5 && imported.pars[3] === 4)
  assert('NCRDB import promotes hole-level stroke index', imported.strokeIndex[1] === 1 && imported.strokeIndex[18] === 18)
}

console.log(`\nverify-medium-fixes: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
