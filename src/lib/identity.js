/**
 * Player identity — shared across the live round, history, Home, and You.
 *
 * Players (and "you") are identified by EMAIL and/or PHONE. Player ids are
 * regenerated every round, so cross-round aggregation (season ledger, crew
 * standings, "which rounds did I play") is keyed by a stable identity derived
 * from contact info, NOT the per-round id.
 *
 * `playerKey` returns that stable key: email wins, else phone, else a name
 * fallback. The name fallback keeps legacy rounds (saved before this model, when
 * players were name-only) working — they aggregate by name exactly as before,
 * and a profile carrying only a name still matches them. Going forward, anyone
 * with a contact is matched on it regardless of what name they typed that day.
 *
 * Beyond identity, players may carry a `name` (full name) and a `nickname`
 * (handle, shown as @handle). `displayName` picks the best human label.
 */

const round2 = (n) => +n.toFixed(2)

export const normEmail = (e) => {
  const t = (e || '').trim().toLowerCase()
  return t || null
}

/** Digits only; treated as a real contact at 7+ digits (US-ish, lenient). */
export const normPhone = (p) => {
  const d = (p || '').replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

/** True when a player carries at least one contact method (the requirement). */
export const hasContact = (p) => !!(normEmail(p?.email) || normPhone(p?.phone))

/**
 * Stable cross-round identity key: `e:<email>` | `p:<phone>` | `n:<name>`, or
 * null when we have nothing to go on.
 *
 * Guests are deliberately transient: they play and settle up within a round,
 * but carry no key, so every cross-round rollup here (season ledger, crew
 * standings, "you" detection) skips them — they never accrue saved history.
 */
export const playerKey = (p) => {
  if (p?.guest) return null
  const e = normEmail(p?.email)
  if (e) return `e:${e}`
  const ph = normPhone(p?.phone)
  if (ph) return `p:${ph}`
  const n = (p?.name || '').trim().toLowerCase()
  return n ? `n:${n}` : null
}

export const sameIdentity = (a, b) => {
  const ka = playerKey(a)
  return ka != null && ka === playerKey(b)
}

/** @handle from a nickname, or null. */
export const handleOf = (p) => {
  const h = (p?.nickname || '').trim().replace(/^@+/, '')
  return h ? `@${h}` : null
}

/** Best human label: full name → nickname → email → phone → ''. */
export const displayName = (p) =>
  (p?.name || '').trim() ||
  (p?.nickname || '').trim() ||
  normEmail(p?.email) ||
  (p?.phone || '').trim() ||
  ''

/* ----------------------------------------------- saved-round aggregation */

/** Map a saved round's per-round playerId → stable identity key. */
const idKeyMap = (r) => Object.fromEntries((r.players ?? []).map((p) => [p.id, playerKey(p)]))

/** Did this identity play in the round? */
export const playedInByKey = (r, key) =>
  key != null && (r.players ?? []).some((p) => playerKey(p) === key)

/** key → net money summed across a list of saved rounds (from bet payouts). */
export function netByKey(rounds) {
  const map = {}
  for (const r of rounds) {
    const keys = idKeyMap(r)
    for (const b of r.betResults ?? []) {
      for (const [pid, amt] of Object.entries(b.payouts ?? {})) {
        const k = keys[pid]
        if (k == null) continue
        map[k] = (map[k] ?? 0) + amt
      }
    }
  }
  Object.keys(map).forEach((k) => { map[k] = round2(map[k]) })
  return map
}

/** One identity's net within a single saved round. */
export function myNetInRoundByKey(r, key) {
  if (key == null) return 0
  const keys = idKeyMap(r)
  let s = 0
  for (const b of r.betResults ?? []) {
    for (const [pid, amt] of Object.entries(b.payouts ?? {})) {
      if (keys[pid] === key) s += amt
    }
  }
  return round2(s)
}

/**
 * key → display label across rounds. Rounds are stored newest-first, so the
 * first label seen for a key is the most recent one the player used.
 */
export function namesByKey(rounds) {
  const map = {}
  for (const r of rounds) {
    for (const p of r.players ?? []) {
      const k = playerKey(p)
      if (k != null && map[k] == null) map[k] = displayName(p)
    }
  }
  return map
}

/** Most-frequently-seen identity across history — the auto "you". */
export function autoKey(rounds) {
  const freq = {}
  for (const r of rounds) {
    for (const p of r.players ?? []) {
      const k = playerKey(p)
      if (k) freq[k] = (freq[k] ?? 0) + 1
    }
  }
  let best = null
  let bestN = 0
  for (const [k, n] of Object.entries(freq)) if (n > bestN) { best = k; bestN = n }
  return best
}

/**
 * Match a saved leaderboard entry to an identity. New snapshots carry `key`;
 * legacy ones only have `name`, so fall back to name matching for those.
 */
export const entryMatches = (entry, key, name) =>
  !!entry && (entry.key != null ? entry.key === key : name != null && entry.name === name)
