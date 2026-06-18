import { useId } from 'react'

/**
 * GoLo brand mark — the staggered "GoLo" wordmark where both o's are dimpled
 * golf balls, plus the standalone ball glyph and app-icon. Rebuilt from the
 * design reference (Golo Golf - Logo.dc.html / README) as parametric SVG so it
 * scales cleanly and the accent stays themeable.
 *
 * All geometry is expressed as ratios of the cap font-size `F` (see README):
 *   ball Ø 0.465F · ball lift 0.068F · cap↔ball gap max(1, 0.014F)
 *   cluster B drop 0.15F · cluster B nudge 0.10F · cap weight 300 · tracking −0.02em
 *
 *   <GoloWordmark variant="primary|white|lime|dark|nav" fontPx accent />
 *   <GoloBall size fill dimple highlight />
 *   <GoloIcon size accent />   // turf rounded-square + white ball (app icon)
 */

const ACCENT = '#d4f23a'

// Dimple positions as fractions of the 100×100 ball viewBox (README).
const DIMPLES = [
  [0.50, 0.30], [0.34, 0.42], [0.66, 0.42], [0.28, 0.62],
  [0.50, 0.55], [0.72, 0.62], [0.40, 0.74], [0.60, 0.74],
]

function hexA(hex, a) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** A single dimpled golf ball. `highlight` adds the soft top-left sheen. */
export function GoloBall({ size = 24, fill = '#ffffff', dimple = 'rgba(20,40,24,.32)', highlight = true, style }) {
  const gid = `golo-ball-${useId()}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ display: 'block', flex: '0 0 auto', ...style }}
    >
      {highlight && (
        <defs>
          <radialGradient id={gid} cx="34%" cy="26%" r="78%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="42%" stopColor={fill} />
            <stop offset="100%" stopColor={fill} />
          </radialGradient>
        </defs>
      )}
      <circle cx="50" cy="50" r="48" fill={highlight ? `url(#${gid})` : fill} />
      {DIMPLES.map(([x, y], i) => (
        <circle key={i} cx={x * 100} cy={y * 100} r="4.2" fill={dimple} />
      ))}
    </svg>
  )
}

// Per-variant cap color + ball treatment (README "Variants"). ballB null = both
// balls share ballA; primary is the only two-tone (white ball + lime ball).
function variantConfig(variant, accent) {
  switch (variant) {
    case 'primary':
      return {
        capColor: '#fff',
        ballA: { fill: '#ffffff', dimple: 'rgba(20,40,24,.32)', highlight: true },
        ballB: { fill: accent, dimple: hexA('#13250a', 0.5), highlight: true },
      }
    case 'lime':
      return { capColor: accent, ballA: { fill: accent, dimple: hexA('#0c0f12', 0.55), highlight: false }, ballB: null }
    case 'dark':
      return { capColor: '#13250a', ballA: { fill: '#ffffff', dimple: 'rgba(19,37,10,.45)', highlight: false }, ballB: null }
    case 'white':
    case 'nav':
    default:
      return { capColor: '#fff', ballA: { fill: '#ffffff', dimple: 'rgba(20,40,24,.3)', highlight: true }, ballB: null }
  }
}

/** The "GoLo" wordmark. `nav` defaults to F=30; everything else to F=56. */
export function GoloWordmark({ variant = 'white', fontPx, accent = ACCENT, title = 'GoLo', style }) {
  const F = fontPx ?? (variant === 'nav' ? 30 : 56)
  const cfg = variantConfig(variant, accent)
  const ballA = cfg.ballA
  const ballB = cfg.ballB ?? cfg.ballA

  const ballSize = Math.round(F * 0.465)
  const drop = Math.round(F * 0.068)
  const stagger = Math.round(F * 0.15)
  const shift = Math.round(F * 0.10)
  const gap = Math.max(1, Math.round(F * 0.014))
  const capStyle = {
    fontSize: F + 'px', fontWeight: 300, letterSpacing: '-0.02em',
    color: cfg.capColor, lineHeight: 1, fontFamily: 'system-ui,-apple-system,sans-serif',
  }

  return (
    <div role="img" aria-label={title} style={{ position: 'relative', display: 'inline-flex', alignItems: 'flex-start', ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: gap + 'px' }}>
        <span style={capStyle}>G</span>
        <span style={{ display: 'inline-flex', paddingBottom: drop + 'px' }}><GoloBall size={ballSize} {...ballA} /></span>
      </div>
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'flex-end', gap: gap + 'px', marginTop: stagger + 'px', marginLeft: shift + 'px' }}>
        <span style={capStyle}>L</span>
        <span style={{ display: 'inline-flex', paddingBottom: drop + 'px' }}><GoloBall size={ballSize} {...ballB} /></span>
      </div>
    </div>
  )
}

/** App-icon glyph: turf rounded-square with a centered white ball. */
export function GoloIcon({ size = 132, radius, accent = ACCENT, glow = true, style }) {
  void accent // turf icon doesn't tint; accent kept for API symmetry
  const r = radius ?? Math.round(size * 0.227)
  const ball = Math.round(size * 0.606)
  return (
    <div
      role="img"
      aria-label="GoLo"
      style={{
        width: size, height: size, borderRadius: r, flex: '0 0 auto',
        background: 'radial-gradient(125% 110% at 30% 15%, #2a7d4a 0%, #14532d 55%, #0a2418 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        boxShadow: glow ? '0 18px 44px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.14)' : 'inset 0 1px 0 rgba(255,255,255,.14)',
        ...style,
      }}
    >
      <GoloBall size={ball} fill="#ffffff" dimple="rgba(20,40,24,.32)" highlight style={{ transform: 'translateY(2px)' }} />
    </div>
  )
}

export default GoloWordmark
