/**
 * Accent-tint helper: `hexA('#d4f23a', 0.4)` → `rgba(212,242,58,0.4)`.
 * Shared so pages don't each redefine it (per the design system's hexA convention).
 * Falls back to the lime accent when `hex` is empty, and to white on a bad hex.
 */
const ACCENT = '#d4f23a'

export function hexA(hex, a) {
  let h = (hex || ACCENT).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(255,255,255,${a})`
  return `rgba(${r},${g},${b},${a})`
}
