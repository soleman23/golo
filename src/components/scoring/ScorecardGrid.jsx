import { hexA } from '../../lib/colors'
import { ncd, vpl } from '../../lib/scoreDisplay'

const ACCENT = '#d4f23a'
const OVER = '#fb7185'
const DASH = '·'

/* Column widths are tuned to the fixed 390px phone canvas: with the sheet's
 * 16px page padding and the card's 8px inset, 342px of usable width remain.
 * 54 + (9 × 28) + 32 = 338 — nine holes fit with no horizontal scrolling. */
const NAME_W = 54
const CELL_W = 28
const TOTAL_W = 32
const BOX = 20

const num = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Row label for the narrow name column. Scramble teams are named "Team A" /
 * "Team B", so a plain first word would render every row as "Team" — drop the
 * prefix and keep the part that distinguishes them.
 */
function shortLabel(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return '—'
  const team = trimmed.match(/^team\s+(.+)$/i)
  return (team ? team[1] : trimmed).split(' ')[0]
}

/** Holes belonging to a nine, clipped to the round's length (9-hole rounds have no back). */
function holesForNine(nine, totalHoles) {
  const max = Math.max(1, Math.round(Number(totalHoles) || 18))
  const start = nine === 'back' ? 10 : 1
  const end = nine === 'back' ? max : Math.min(9, max)
  const out = []
  for (let h = start; h <= end; h += 1) out.push(h)
  // A 'back' request on a 9-hole round has no holes — fall back to the front.
  return out.length ? out : holesForNine('front', max)
}

/**
 * Shape vocabulary for a hole, the way a card is marked by hand:
 * double circle = eagle or better, circle = birdie, plain = par,
 * square = bogey, double square = double bogey or worse.
 */
function shapeFor(vsPar) {
  if (vsPar == null) return null
  if (vsPar <= -2) return { radius: '50%', color: ACCENT, double: true }
  if (vsPar === -1) return { radius: '50%', color: ACCENT, double: false }
  if (vsPar === 0) return null
  if (vsPar === 1) return { radius: 5, color: OVER, double: false }
  return { radius: 5, color: OVER, double: true }
}

/** Outer ring of a double circle / double square, drawn as a nested element so
 *  it follows the corner radius everywhere (`outline-offset` only does on
 *  Safari 16.4+, and this app lives on phones). */
function Ring({ shape }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: -3,
        borderRadius: shape.radius === '50%' ? '50%' : 7,
        border: `1.5px solid ${shape.color}`,
        pointerEvents: 'none',
      }}
    />
  )
}

/** The marked box itself: gross strokes, its shape, and a dot per stroke received. */
function ScoreBox({ gross, par, strokes }) {
  const vsPar = gross != null && par != null ? gross - par : null
  const shape = shapeFor(vsPar)
  const empty = gross == null

  return (
    <span
      style={{
        position: 'relative',
        width: BOX,
        height: BOX,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: shape?.radius ?? 4,
        border: shape ? `1.5px solid ${shape.color}` : '1.5px solid transparent',
        fontSize: 13,
        fontWeight: 800,
        lineHeight: 1,
        color: empty ? 'rgba(255,255,255,.25)' : shape ? shape.color : '#fff',
      }}
    >
      {shape?.double && <Ring shape={shape} />}
      {empty ? DASH : gross}
      {/* Handicap strokes received, marked inside the corner as on a paper card. */}
      {strokes > 0 && (
        <span aria-hidden="true" style={{ position: 'absolute', top: 1.5, left: 1.5, display: 'flex', gap: 1.5 }}>
          {Array.from({ length: Math.min(strokes, 3) }, (_, i) => (
            <span key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,.75)' }} />
          ))}
        </span>
      )}
    </span>
  )
}

/** One grid cell — a real button only while a scorer can edit it. */
function Cell({ gross, par, strokes, label, onTap }) {
  const box = <ScoreBox gross={gross} par={par} strokes={strokes} />
  const frame = {
    width: CELL_W,
    height: 40,
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  // Read-only rounds and viewers get inert markup rather than a disabled
  // button, so screen readers don't announce 18 dead controls per player.
  if (!onTap) return <span style={frame}>{box}</span>

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      style={{
        ...frame,
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {box}
    </button>
  )
}

/**
 * ScorecardGrid — the paper-scorecard view: one nine at a time, players down
 * the left, holes across, OUT/IN total on the right.
 *
 * Cells show gross strokes (the number actually written on a card) with a dot
 * per handicap stroke received, so net stays derivable at a glance without a
 * second set of numbers. Tapping a cell edits that hole when a scorer is
 * driving; viewers and finished rounds render inert.
 *
 * Works for players or scramble teams — it only needs entities with `id`,
 * `name`, and `color`, and score maps keyed by that same id.
 */
export default function ScorecardGrid({
  entities,
  scores,
  pars,
  strokeIndex = {},
  allocations = {},
  totalHoles = 18,
  nine = 'front',
  meEntityId = null,
  readOnly = false,
  onCellTap,
}) {
  const holes = holesForNine(nine, totalHoles)
  const hasStrokeIndex = holes.some((h) => num(strokeIndex[h]) != null)
  const totalLabel = holes[0] > 9 ? 'IN' : 'OUT'
  const parTotal = holes.reduce((sum, h) => sum + (num(pars[h]) ?? 0), 0)
  const editable = !readOnly && typeof onCellTap === 'function'

  const cols = (children) => (
    <div style={{ display: 'flex', alignItems: 'center' }}>{children}</div>
  )

  return (
    <div
      style={{
        background: 'rgba(20,28,24,.5)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,.13)',
        borderRadius: 20,
        padding: '10px 8px 8px',
        boxShadow: '0 14px 34px rgba(0,0,0,.3)',
      }}
    >
      {/* hole numbers */}
      {cols(
        <>
          <span style={{ width: NAME_W, flex: '0 0 auto' }} />
          {holes.map((h) => (
            <span
              key={h}
              style={{
                width: CELL_W,
                flex: '0 0 auto',
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 800,
                color: 'rgba(255,255,255,.62)',
              }}
            >
              {h}
            </span>
          ))}
          <span
            style={{
              width: TOTAL_W,
              flex: '0 0 auto',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0.6,
              color: ACCENT,
            }}
          >
            {totalLabel}
          </span>
        </>
      )}

      {/* par */}
      <div style={{ marginTop: 3 }}>
        {cols(
          <>
            <span
              style={{
                width: NAME_W,
                flex: '0 0 auto',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1,
                color: 'rgba(255,255,255,.45)',
              }}
            >
              PAR
            </span>
            {holes.map((h) => (
              <span
                key={h}
                style={{
                  width: CELL_W,
                  flex: '0 0 auto',
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,.5)',
                }}
              >
                {num(pars[h]) ?? DASH}
              </span>
            ))}
            <span
              style={{
                width: TOTAL_W,
                flex: '0 0 auto',
                textAlign: 'center',
                fontSize: 12,
                fontWeight: 800,
                color: 'rgba(255,255,255,.5)',
              }}
            >
              {parTotal || DASH}
            </span>
          </>
        )}
      </div>

      {/* stroke index */}
      {hasStrokeIndex && (
        <div style={{ marginTop: 1 }}>
          {cols(
            <>
              <span
                style={{
                  width: NAME_W,
                  flex: '0 0 auto',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: 1,
                  color: 'rgba(255,255,255,.32)',
                }}
              >
                S.I.
              </span>
              {holes.map((h) => (
                <span
                  key={h}
                  style={{
                    width: CELL_W,
                    flex: '0 0 auto',
                    textAlign: 'center',
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'rgba(255,255,255,.32)',
                  }}
                >
                  {num(strokeIndex[h]) ?? ''}
                </span>
              ))}
              <span style={{ width: TOTAL_W, flex: '0 0 auto' }} />
            </>
          )}
        </div>
      )}

      <div style={{ height: 1, background: 'rgba(255,255,255,.12)', margin: '7px 0 3px' }} />

      {/* one row per player / team */}
      {entities.map((e) => {
        const sc = scores[e.id] ?? {}
        const alloc = allocations[e.id] ?? {}
        const isMe = e.id === meEntityId
        const label = shortLabel(e.name)
        const nineTotal = holes.reduce((sum, h) => sum + (num(sc[h]) ?? 0), 0)

        // Gross to par across every hole played — the sub-line under the name.
        // Raw totals would read ambiguously next to the OUT/IN column. Walk the
        // round's own holes so a shortened round ignores stale scores.
        let played = 0
        let vsPar = 0
        for (let h = 1; h <= totalHoles; h += 1) {
          const g = num(sc[h])
          const p = num(pars[h])
          if (g == null || p == null) continue
          played += 1
          vsPar += g - p
        }

        return (
          <div
            key={e.id}
            style={{
              borderRadius: 12,
              background: isMe ? hexA(ACCENT, 0.08) : 'transparent',
              borderLeft: `3px solid ${e.color ?? '#2dd4bf'}`,
              paddingLeft: 4,
              marginBottom: 2,
            }}
          >
            {cols(
              <>
                <span
                  style={{
                    width: NAME_W - 7,
                    flex: '0 0 auto',
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 800,
                      color: '#fff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: played ? ncd(vsPar) : 'rgba(255,255,255,.35)',
                    }}
                  >
                    {played ? vpl(vsPar) : DASH}
                  </span>
                </span>
                {holes.map((h) => {
                  const gross = num(sc[h])
                  return (
                    <Cell
                      key={h}
                      gross={gross}
                      par={num(pars[h])}
                      strokes={num(alloc[h]) ?? 0}
                      label={`${e.name}, hole ${h}${gross == null ? '' : `, ${gross}`}`}
                      onTap={editable ? () => onCellTap(e.id, h) : undefined}
                    />
                  )
                })}
                <span
                  style={{
                    width: TOTAL_W,
                    flex: '0 0 auto',
                    textAlign: 'center',
                    fontSize: 15,
                    fontWeight: 800,
                    color: '#fff',
                  }}
                >
                  {nineTotal || DASH}
                </span>
              </>
            )}
          </div>
        )
      })}

      {/* legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid rgba(255,255,255,.1)',
          fontSize: 9.5,
          fontWeight: 700,
          color: 'rgba(255,255,255,.42)',
        }}
      >
        <LegendKey radius="50%" color={ACCENT} label="Birdie" />
        <LegendKey radius="50%" color={ACCENT} label="Eagle+" double />
        <LegendKey radius={4} color={OVER} label="Bogey" />
        <LegendKey radius={4} color={OVER} label="Double+" double />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,.75)' }} />
          Stroke
        </span>
      </div>
    </div>
  )
}

function LegendKey({ radius, color, label, double = false }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: double ? 7 : 5 }}>
      <span
        style={{
          position: 'relative',
          width: 11,
          height: 11,
          flex: '0 0 auto',
          borderRadius: radius,
          border: `1.5px solid ${color}`,
        }}
      >
        {double && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: radius === '50%' ? '50%' : 6,
              border: `1.5px solid ${color}`,
            }}
          />
        )}
      </span>
      {label}
    </span>
  )
}
