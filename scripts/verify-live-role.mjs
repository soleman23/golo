/**
 * Static checks for resolveLiveRoundRole — the gate that decides whether the
 * current session can score (scorer) or is read-only (player/viewer), and that
 * demotes a stale persisted live session to local-only when its liveRoundId no
 * longer matches the round in play (the bug that made fresh local rounds
 * read-only). Run with `npm run verify:live-role`.
 */

import { resolveLiveRoundRole } from '../src/lib/liveRoundRole.js'

const cases = [
  { role: null, liveRoundId: null, roundId: 'r1', want: 'local-only', label: 'no session' },
  { role: 'scorer', liveRoundId: null, roundId: 'r1', want: 'local-only', label: 'role without a live session' },
  { role: 'viewer', liveRoundId: 'old', roundId: 'new', want: 'local-only', label: 'stale viewer session on new local round' },
  { role: 'scorer', liveRoundId: 'old', roundId: 'new', want: 'local-only', label: 'stale scorer session on new local round' },
  { role: 'scorer', liveRoundId: 'r1', roundId: null, want: 'scorer', label: 'live session, round not yet identified' },
  { role: 'scorer', liveRoundId: 'r1', roundId: 'r1', want: 'scorer', label: 'active live scorer' },
  { role: 'viewer', liveRoundId: 'r1', roundId: 'r1', want: 'viewer', label: 'active live viewer' },
]

let failed = 0
for (const c of cases) {
  const got = resolveLiveRoundRole(c.role, c.liveRoundId, c.roundId)
  if (got !== c.want) {
    console.error(`FAIL ${c.label}: got ${got}, want ${c.want}`)
    failed += 1
  } else {
    console.log(`OK   ${c.label}`)
  }
}

process.exit(failed ? 1 : 0)
