/** scorer | player | viewer | local-only */
export function resolveLiveRoundRole(role, liveRoundId, roundId) {
  if (!liveRoundId || !role) return 'local-only'
  // Stale persisted live sessions must not make a fresh local round read-only.
  if (roundId && liveRoundId !== roundId) return 'local-only'
  return role
}
