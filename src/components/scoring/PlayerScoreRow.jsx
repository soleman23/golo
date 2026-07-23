import { hexA } from '../../lib/colors'
import { initial, vpl, ncd, youBadge } from '../../lib/scoreDisplay'
import { Icon } from '../shared/GoloIcons'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

const scoreBadge = {
  fontSize: 10,
  fontWeight: 800,
  background: 'rgba(255,255,255,.12)',
  border: '1px solid rgba(255,255,255,.12)',
  padding: '2px 6px',
  borderRadius: 9999,
  flex: '0 0 auto',
  lineHeight: 1.2,
}

/**
 * Horizontal score row shared by every group size.
 * Avatar + name left, net badges center, ± score controls right.
 */
export default function PlayerScoreRow({
  entity,
  gross,
  net,
  toPar,
  points,
  subtitle,
  isMe = false,
  isWolf = false,
  readOnly = false,
  isStableford = false,
  useGrossScoring = false,
  isScramble = false,
  dense = false,
  onMinus,
  onPlus,
  onScoreTap,
}) {
  const showBadges = gross != null && !isScramble
  const btnSize = dense ? 44 : 48
  const scoreSize = dense ? 32 : 36

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: dense ? 8 : 10,
        boxSizing: 'border-box',
        minHeight: dense ? 68 : 72,
        padding: dense ? '6px 8px 6px 10px' : '8px 10px 8px 12px',
        marginBottom: dense ? 6 : 8,
        borderRadius: 16,
        border: `1px solid ${isMe ? hexA(ACCENT, 0.45) : 'rgba(255,255,255,.14)'}`,
        borderLeft: `3px solid ${entity.color ?? '#2dd4bf'}`,
        background: isMe ? hexA(ACCENT, 0.08) : 'rgba(20,28,24,.46)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 6px 20px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.1)',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: -24,
          top: -8,
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: hexA(entity.color, 0.45),
          filter: 'blur(22px)',
          pointerEvents: 'none',
        }}
      />

      <span
        style={{
          position: 'relative',
          width: dense ? 40 : 44,
          height: dense ? 40 : 44,
          borderRadius: '50%',
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: dense ? 16 : 18,
          fontWeight: 800,
          color: '#fff',
          background: entity.color ?? '#2dd4bf',
          boxShadow: `0 0 0 2px ${isMe ? ACCENT : 'rgba(255,255,255,.25)'}`,
        }}
      >
        {initial(entity.name)}
      </span>

      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: dense ? 16 : 18,
              fontWeight: 800,
              color: '#fff',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entity.name}
          </span>
          {isMe && <span style={youBadge}>YOU</span>}
          {isWolf && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: ACCENT_DARK,
                background: ACCENT,
                padding: '2px 7px',
                borderRadius: 9999,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                flex: '0 0 auto',
              }}
            >
              <Icon name="wolf" size={11} color={ACCENT_DARK} />
              Wolf
            </span>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 2,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255,255,255,.55)',
              flex: '1 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {subtitle}
          </span>
          {showBadges && (
            <>
              {isStableford ? (
                <span style={{ ...scoreBadge, color: ACCENT }}>{points} pt</span>
              ) : (
                <>
                  <span style={{ ...scoreBadge, fontWeight: 700, color: 'rgba(255,255,255,.92)' }}>
                    {useGrossScoring ? 'Gross' : 'Net'} {net}
                  </span>
                  <span style={{ ...scoreBadge, color: ncd(toPar) }}>{vpl(toPar)}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
        {readOnly ? (
          <span
            style={{
              minWidth: 36,
              fontSize: 36,
              fontWeight: 800,
              color: '#fff',
              textAlign: 'center',
              lineHeight: 1,
            }}
          >
            {gross == null ? '–' : gross}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onMinus}
              aria-label={`${entity.name} minus`}
              style={{
                width: btnSize,
                height: btnSize,
                borderRadius: '50%',
                flex: '0 0 auto',
                background: 'rgba(255,255,255,.12)',
                border: '1px solid rgba(255,255,255,.2)',
                color: '#fff',
                fontSize: dense ? 24 : 26,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              −
            </button>
            <button
              type="button"
              onClick={onScoreTap}
              aria-label={`${entity.name} score`}
              style={{
                minWidth: dense ? 36 : 40,
                height: btnSize,
                border: 'none',
                background: 'transparent',
                fontSize: scoreSize,
                fontWeight: 800,
                color: '#fff',
                cursor: 'pointer',
                lineHeight: 1,
                textShadow: '0 2px 12px rgba(0,0,0,.4)',
                fontFamily: 'inherit',
              }}
            >
              {gross == null ? '–' : gross}
            </button>
            <button
              type="button"
              onClick={onPlus}
              aria-label={`${entity.name} plus`}
              style={{
                width: btnSize,
                height: btnSize,
                borderRadius: '50%',
                flex: '0 0 auto',
                background: ACCENT,
                border: 'none',
                color: ACCENT_DARK,
                fontSize: dense ? 24 : 26,
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${hexA(ACCENT, 0.45)}`,
                fontFamily: 'inherit',
              }}
            >
              +
            </button>
          </>
        )}
      </div>
    </div>
  )
}
