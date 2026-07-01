/**
 * verify-press-bets.mjs — QA assertions for Overall Purse press logic.
 */
import { buildPressBet, getPressEligibility, calculatePressPayouts } from '../src/engines/pressBets.js'
import { calculateOverallPursePayouts } from '../src/engines/overallPurse.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    passed += 1
    return
  }
  failed += 1
  console.error('FAIL:', msg)
}

const pars = {}
for (let h = 1; h <= 18; h++) pars[h] = 4

const players = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Bob' },
]

const parentBet = {
  id: 'op1',
  type: 'overallPurse',
  playerIds: ['a', 'b'],
  amount: 5,
  config: { stake: 5, style: 'match' },
}

function scoresThrough9(aWins) {
  const scores = { a: {}, b: {} }
  for (let h = 1; h <= 9; h++) {
    if (aWins) {
      scores.a[h] = 4
      scores.b[h] = 5
    } else {
      scores.a[h] = 5
      scores.b[h] = 4
    }
  }
  return scores
}

const strokeAllocations = { a: {}, b: {} }

// Eligibility: Bob 9 down through 9 → 2+ down on hole 9
const scores9 = scoresThrough9(true)
const elig = getPressEligibility({
  bets: [parentBet],
  pressBets: [],
  scores: scores9,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 9,
  totalHoles: 18,
  status: 'in_progress',
})
assert(elig.allowed, 'Bob should be press-eligible when 9 down')
assert(
  elig.targets.some((t) => t.targetPlayerId === 'b' && t.opponentPlayerId === 'a'),
  'Target should be down side Bob vs Ann'
)

// Block 1 down
const scores1 = { a: { 1: 4 }, b: { 1: 5 } }
const elig1 = getPressEligibility({
  bets: [parentBet],
  pressBets: [],
  scores: scores1,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 1,
  totalHoles: 18,
  status: 'in_progress',
})
assert(!elig1.allowed, '1 down should block press')

// Create press x2 continue
const created = buildPressBet({
  bets: [parentBet],
  pressBets: [],
  scores: scores9,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 9,
  totalHoles: 18,
  roundId: 'r1',
  status: 'in_progress',
  multiplier: 2,
  originalBetAction: 'continue',
  createdByPlayerId: 'a',
  targetPlayerId: 'b',
  opponentPlayerId: 'a',
})
assert(created.ok, 'Press creation should succeed')
assert(created.pressBet.pressStake === 10, 'x2 press stake = 10')
assert(created.pressBet.startHole === 10, 'Press starts next hole')
assert(created.parentBetPatch === null, 'Continue leaves parent unchanged')

// Close original
const closed = buildPressBet({
  bets: [parentBet],
  pressBets: [],
  scores: scores9,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 9,
  totalHoles: 18,
  roundId: 'r1',
  status: 'in_progress',
  multiplier: 3,
  originalBetAction: 'close',
  createdByPlayerId: 'a',
  targetPlayerId: 'b',
  opponentPlayerId: 'a',
})
assert(closed.ok, 'Close-original press should succeed')
assert(closed.parentBetPatch?.config?.pressState?.closures?.length === 1, 'Closure recorded')
assert(
  closed.parentBetPatch.config.pressState.closures[0].closedAtHole === 9,
  'Closed thru hole 9'
)

// Max 2 presses
const third = buildPressBet({
  bets: [parentBet],
  pressBets: [created.pressBet, { ...created.pressBet, id: 'p2', status: 'active' }],
  scores: scores9,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 9,
  totalHoles: 18,
  roundId: 'r1',
  status: 'in_progress',
  multiplier: 2,
  originalBetAction: 'continue',
  createdByPlayerId: 'a',
  targetPlayerId: 'b',
  opponentPlayerId: 'a',
})
assert(!third.ok, 'Third active press blocked')

// Last hole blocked
const lastHole = buildPressBet({
  bets: [parentBet],
  pressBets: [],
  scores: scores9,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 18,
  totalHoles: 18,
  roundId: 'r1',
  status: 'in_progress',
  multiplier: 2,
  originalBetAction: 'continue',
  createdByPlayerId: 'a',
  targetPlayerId: 'b',
  opponentPlayerId: 'a',
})
assert(!lastHole.ok, 'Press blocked on last hole')

// 4-player requires opponent
const parent4 = {
  ...parentBet,
  id: 'op4',
  playerIds: ['a', 'b', 'c', 'd'],
}
const fourPlayers = [
  ...players,
  { id: 'c', name: 'Cal' },
  { id: 'd', name: 'Dan' },
]
const noOpp = buildPressBet({
  bets: [parent4],
  pressBets: [],
  scores: scores9,
  pars,
  strokeAllocations,
  teams: [],
  currentHole: 9,
  totalHoles: 18,
  roundId: 'r1',
  status: 'in_progress',
  multiplier: 2,
  originalBetAction: 'continue',
  createdByPlayerId: 'a',
  targetPlayerId: 'b',
})
assert(!noOpp.ok, '4-player press requires opponentPlayerId')

// Close original settlement + press payout no double count
const fullScores = scoresThrough9(true)
for (let h = 10; h <= 18; h++) {
  fullScores.a[h] = 4
  fullScores.b[h] = 5
}
const closedBet = {
  ...parentBet,
  config: {
    stake: 5,
    style: 'match',
    pressState: closed.parentBetPatch.config.pressState,
  },
}
const origPayouts = calculateOverallPursePayouts(
  players,
  fullScores,
  pars,
  strokeAllocations,
  closedBet.config
)
assert(origPayouts.payouts.a === 5 && origPayouts.payouts.b === -5, 'Original closed thru 9 only')

const pressOut = calculatePressPayouts(
  [closed.pressBet],
  players,
  fullScores,
  pars,
  strokeAllocations,
  []
)
assert(pressOut.payouts.a === 15 && pressOut.payouts.b === -15, 'Press x3 from 10 wins for Ann')

console.log(`verify-press-bets: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
