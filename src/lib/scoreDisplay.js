/**
 * Shared scoring-display helpers so the full player card (ScoringPage) and the
 * compact foursome row (PlayerScoreRow) stay visually in lockstep.
 */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

/** First initial of a name for the player avatar. */
export const initial = (name) => (name || '').trim().charAt(0).toUpperCase() || '?'

/** Format net-to-par the golf way: E, +2, -1. */
export const vpl = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`)

/** Colour a to-par number: green under, red over, neutral at level. */
export const ncd = (n) => (n < 0 ? '#bef264' : n > 0 ? '#fb7185' : 'rgba(255,255,255,.72)')

/** The lime "YOU" pill beside the signed-in player. */
export const youBadge = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.5,
  color: ACCENT_DARK,
  background: ACCENT,
  padding: '2px 7px',
  borderRadius: 9999,
  flex: '0 0 auto',
}
