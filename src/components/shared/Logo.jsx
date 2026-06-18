import { useId } from 'react'

/**
 * GoLo brand assets.
 *
 * The exported "Pin" logo files live in /public/brand. SVGs are preferred by
 * the logo bundle's README, with full-color marks on dark surfaces and the dark
 * mark reserved for light surfaces.
 *
 *   <GoloWordmark variant="primary|white|lime|dark|nav" fontPx accent />
 *   <GoloBall size fill dimple highlight />
 *   <GoloIcon size accent />   // rounded-square app icon
 */

const ACCENT = '#d4f23a'
const BRAND = {
  appIcon: '/brand/golo-pin-appicon.svg',
  dark: '/brand/golo-pin-dark.svg',
  lime: '/brand/golo-pin-lime.svg',
  lockup: '/brand/golo-pin-lockup.svg',
  white: '/brand/golo-pin-white.svg',
}
const LOCKUP_RATIO = 930 / 260

// Dimple positions as fractions of the 100×100 ball viewBox.
const DIMPLES = [
  [0.50, 0.30], [0.34, 0.42], [0.66, 0.42], [0.28, 0.62],
  [0.50, 0.55], [0.72, 0.62], [0.40, 0.74], [0.60, 0.74],
]

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

function assetForVariant(variant) {
  switch (variant) {
    case 'lime':
      return { src: BRAND.lime, ratio: 1 }
    case 'dark':
      return { src: BRAND.dark, ratio: 1 }
    case 'mark':
      return { src: BRAND.white, ratio: 1 }
    case 'primary':
    case 'white':
    case 'nav':
    default:
      return { src: BRAND.lockup, ratio: LOCKUP_RATIO }
  }
}

/** The GoLo lockup/mark. `nav` defaults to F=30; everything else to F=56. */
export function GoloWordmark({ variant = 'white', fontPx, accent = ACCENT, title = 'GoLo', style }) {
  void accent // The exported assets carry their brand colors.
  const F = fontPx ?? (variant === 'nav' ? 30 : 56)
  const { src, ratio } = assetForVariant(variant)
  const isLockup = ratio !== 1
  const height = Math.round(F * (isLockup ? 1.78 : 1.65))

  return (
    <img
      src={src}
      alt={title}
      width={Math.round(height * ratio)}
      height={height}
      style={{
        display: 'block',
        width: 'auto',
        height,
        maxWidth: '100%',
        flex: '0 0 auto',
        ...style,
      }}
    />
  )
}

/** App-icon glyph: dark rounded-square with the full-color pin mark. */
export function GoloIcon({ size = 132, radius, accent = ACCENT, glow = true, style }) {
  void accent // The exported asset carries its brand colors.
  const r = radius ?? Math.round(size * 0.227)
  return (
    <img
      src={BRAND.appIcon}
      alt="GoLo"
      width={size}
      height={size}
      style={{
        display: 'block',
        width: size,
        height: size,
        borderRadius: r,
        flex: '0 0 auto',
        boxShadow: glow ? '0 18px 44px rgba(0,0,0,.5)' : 'none',
        ...style,
      }}
    />
  )
}

export default GoloWordmark
