/**
 * GoLo custom icon set — 12 solid glyph icons + a two-tone Check.
 * Glyphs are drawn on a 24×24 grid and paint with `fill: currentColor`,
 * so set their color via surrounding text color or the `color` prop.
 *
 * Usage:
 *   import { Icon, CheckIcon } from '../components/shared/GoloIcons'
 *   <Icon name="skins" size={20} color="#d4f23a" />
 *   <Icon name="nassau" />            // inherits currentColor
 *   <CheckIcon />                     // lime accent, used in feature bullets
 */

export const ACCENT = '#d4f23a'

// Semantic name → glyph key. Prefer the semantic name in product code.
// (Exported alongside the icon components by design — see README; the disable
// keeps fast-refresh happy without splitting this single drop-in file.)
// eslint-disable-next-line react-refresh/only-export-components
export const ICON_NAMES = {
  skins:        'target',
  nassau:       'trophy',
  purse:        'cash',
  closestToPin: 'pin',
  longestDrive: 'drive',
  birdie:       'bird',
  streak:       'flame',
  swap:         'swap',
  scorecard:    'card',
  leader:       'crown',
  wager:        'dice',
  wolf:         'wolf',
}

// Raw inner SVG markup for each glyph (24×24, fill currentColor).
const GLYPHS = {
  target: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>`,
  trophy: `<path d="M6 3h12v2h3a1 1 0 0 1 1 1c0 2.9-1.9 5.2-4.6 5.8A6.5 6.5 0 0 1 13 15.8V18h3a1 1 0 0 1 1 1v2H7v-2a1 1 0 0 1 1-1h3v-2.2a6.5 6.5 0 0 1-4.4-3.9C3.9 11.2 2 8.9 2 6a1 1 0 0 1 1-1h3V3zM6 7H4.2c.3 1.4 1.1 2.4 2.1 2.9A8.6 8.6 0 0 1 6 8V7zm12 0v1c0 .6 0 1.2-.2 1.8 1-.5 1.7-1.4 2-2.8H18z"/>`,
  cash: `<path fill-rule="evenodd" clip-rule="evenodd" d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>`,
  pin: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a7 7 0 0 0-7 7c0 4.8 5.6 11.4 6.3 12.2a.9.9 0 0 0 1.4 0C13.4 20.4 19 13.8 19 9a7 7 0 0 0-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>`,
  drive: `<path d="M14 3h6.2a.8.8 0 0 1 .8.8V10a1 1 0 0 1-1.7.7l-1.8-1.8-7.7 7.7a1.4 1.4 0 0 1-2-2l7.7-7.7-1.8-1.8A1 1 0 0 1 14 3z"/><circle cx="5.5" cy="18.5" r="3"/>`,
  bird: `<path fill-rule="evenodd" clip-rule="evenodd" d="M3 13a7 7 0 0 1 7-7c2.6 0 4.9 1.4 6.1 3.5l3.5-.5a.8.8 0 0 1 .7 1.3l-2.1 2.5C18 16.1 14.9 19 11 19c-1 0-1.9-.2-2.8-.5L5 21l1.3-4.4A7 7 0 0 1 3 13zm10.5-3.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>`,
  flame: `<path d="M12 2c3 3 5 6 5 9.5a5 5 0 0 1-10 0c0-1.7.6-3.1 1.7-4.2-.1 1.5.6 2.4 1.4 2.7C11.6 8.4 12.5 5.7 12 2z"/>`,
  swap: `<path d="M3 8.5a1 1 0 0 1 1-1h12.1l-1.8-1.8a1 1 0 1 1 1.4-1.4l3.5 3.5a1 1 0 0 1 0 1.4l-3.5 3.5a1 1 0 0 1-1.4-1.4l1.8-1.8H4a1 1 0 0 1-1-1zM21 15.5a1 1 0 0 1-1 1H7.9l1.8 1.8a1 1 0 1 1-1.4 1.4l-3.5-3.5a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 0 1 1.4 1.4l-1.8 1.8H20a1 1 0 0 1 1 1z"/>`,
  card: `<path fill-rule="evenodd" clip-rule="evenodd" d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5zM7 7.5h10v2H7v-2zm0 4h10v2H7v-2zm0 4h6.5v2H7v-2z"/>`,
  crown: `<path d="M3 8.5a1.3 1.3 0 0 1 2.1-1l3.2 2.2 2.6-4.8a1.3 1.3 0 0 1 2.2 0l2.6 4.8 3.2-2.2a1.3 1.3 0 0 1 2.1 1L19.6 17a1 1 0 0 1-1 .8H5.4a1 1 0 0 1-1-.8L3 8.5zM5 19.5h14V21H5z"/>`,
  dice: `<path fill-rule="evenodd" clip-rule="evenodd" d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5zM8 7a1.4 1.4 0 1 0 0 2.8A1.4 1.4 0 0 0 8 7zm8 0a1.4 1.4 0 1 0 0 2.8A1.4 1.4 0 0 0 16 7zm-4 3.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM8 14.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm8 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/>`,
  wolf: `<path d="M4 4l3.5 2L9 3l3 3 3-3 1.5 3L20 4l-1 7.5c-.5 4-3.4 6.5-7 6.5s-6.5-2.5-7-6.5L4 4zm5 7.5a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm6 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm-3 2.8c-1 0-1.8.4-1.8 1 0 .5.8 1.2 1.8 1.2s1.8-.7 1.8-1.2c0-.6-.8-1-1.8-1z"/>`,
}

/** Generic icon. `name` accepts a semantic name (ICON_NAMES) or a raw glyph key. */
export function Icon({ name, size = 24, color, style, ...rest }) {
  const key = ICON_NAMES[name] || name
  const inner = GLYPHS[key]
  if (!inner) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color || 'currentColor'}
      aria-hidden="true"
      style={{ display: 'block', flex: '0 0 auto', ...style }}
      dangerouslySetInnerHTML={{ __html: inner }}
      {...rest}
    />
  )
}

/** Lime two-tone checkmark — used in the landing-page feature bullets. */
export function CheckIcon({ size = 24, color = ACCENT, style, ...rest }) {
  const a = (op) => hexA(color, op)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      aria-hidden="true" style={{ display: 'block', flex: '0 0 auto', ...style }} {...rest}>
      <circle cx="12" cy="12" r="11" fill={a(0.16)} stroke={a(0.5)} strokeWidth="1.4" />
      <path d="M7.5 12.4l3 3 6-6.4" stroke={color} strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// hex (#rgb or #rrggbb) → rgba() string with the given alpha.
function hexA(hex, a) {
  let h = (hex || ACCENT).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export default Icon
