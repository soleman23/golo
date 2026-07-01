import { useMemo, useState } from 'react'
import { hexA } from '../../lib/colors'
import { MULTIPLIERS } from '../../engines/pressBets'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

const chip = (on) => ({
  minHeight: 44,
  padding: '0 14px',
  borderRadius: 9999,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  background: on ? ACCENT : 'rgba(255,255,255,.06)',
  border: `1px solid ${on ? ACCENT : 'rgba(255,255,255,.18)'}`,
  color: on ? ACCENT_DARK : 'rgba(255,255,255,.85)',
})

const card = (on) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '14px 16px',
  borderRadius: 16,
  cursor: 'pointer',
  fontFamily: 'inherit',
  background: on ? hexA(ACCENT, 0.12) : 'rgba(255,255,255,.06)',
  border: `1px solid ${on ? hexA(ACCENT, 0.45) : 'rgba(255,255,255,.14)'}`,
  color: '#fff',
})

function resolveNames(target, players, teams) {
  if (target.targetTeamId) {
    const down = teams.find((t) => t.id === target.targetTeamId)
    const up = teams.find((t) => t.id === target.opponentTeamId)
    return { downName: down?.name ?? '—', upName: up?.name ?? '—', downColor: null }
  }
  const down = players.find((p) => p.id === target.targetPlayerId)
  const up = players.find((p) => p.id === target.opponentPlayerId)
  return { downName: down?.name ?? '—', upName: up?.name ?? '—', downColor: down?.color }
}

/**
 * Multi-step press flow for Overall Purse (target → multiplier → original → confirm).
 */
export default function PressSheet({
  onClose,
  targets,
  originalStake,
  currentHole,
  players,
  teams,
  onConfirm,
}) {
  const needsTargetPick = targets.length > 1
  const [step, setStep] = useState(needsTargetPick ? 'target' : 'multiplier')
  const [targetIdx, setTargetIdx] = useState(0)
  const [multiplier, setMultiplier] = useState(2)
  const [originalBetAction, setOriginalBetAction] = useState('continue')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const target = targets[targetIdx] ?? targets[0]
  const pairingNames = useMemo(
    () => (target ? resolveNames(target, players, teams) : { downName: '—', upName: '—', downColor: null }),
    [target, players, teams]
  )

  const pressStake = originalStake * multiplier
  const totalExposure = originalBetAction === 'continue' ? originalStake + pressStake : pressStake
  const startHole = currentHole + 1

  const goNext = () => {
    setError(null)
    if (step === 'target') setStep('multiplier')
    else if (step === 'multiplier') setStep('original')
    else if (step === 'original') setStep('confirm')
  }

  const goBack = () => {
    setError(null)
    if (step === 'confirm') setStep('original')
    else if (step === 'original') setStep(needsTargetPick ? 'multiplier' : 'multiplier')
    else if (step === 'multiplier' && needsTargetPick) setStep('target')
    else onClose()
  }

  const handleConfirm = async () => {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await Promise.resolve(
      onConfirm({
        multiplier,
        originalBetAction,
        targetPlayerId: target.targetPlayerId ?? null,
        targetTeamId: target.targetTeamId ?? null,
        opponentPlayerId: target.opponentPlayerId ?? null,
        opponentTeamId: target.opponentTeamId ?? null,
      })
    )
    setSubmitting(false)
    if (!result?.ok) {
      setError(result?.error ?? 'Could not create press')
      return
    }
    onClose(result.pressBet)
  }

  const stepLabel =
    step === 'target'
      ? 'Who is pressing?'
      : step === 'multiplier'
        ? 'Press multiplier'
        : step === 'original'
          ? 'Original bet'
          : 'Confirm press'

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(14,20,16,.92)',
          backdropFilter: 'blur(26px)',
          WebkitBackdropFilter: 'blur(26px)',
          borderTop: '1px solid rgba(255,255,255,.14)',
          borderRadius: '26px 26px 0 0',
          padding: '8px 0 max(18px, env(safe-area-inset-bottom))',
          maxHeight: '85%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ width: 42, height: 5, borderRadius: 9999, background: 'rgba(255,255,255,.22)', margin: '6px auto 12px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px 10px' }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: '#fff' }}>Press</span>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: 14, fontWeight: 800, color: ACCENT, background: 'none', border: 'none', minHeight: 44, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 18px 12px', flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', marginBottom: 10 }}>
            {stepLabel.toUpperCase()}
          </div>

          {step === 'target' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {targets.map((t, i) => {
                const names = resolveNames(t, players, teams)
                const on = i === targetIdx
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setTargetIdx(i)}
                    style={card(on)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {names.downColor && (
                        <span style={{ width: 14, height: 14, borderRadius: '50%', background: names.downColor, flex: '0 0 auto' }} />
                      )}
                      <span style={{ fontSize: 15, fontWeight: 800 }}>{names.downName}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 4 }}>
                      {t.margin} down vs {names.upName}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {step === 'multiplier' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {MULTIPLIERS.map((m) => (
                  <button key={m} type="button" onClick={() => setMultiplier(m)} style={{ ...chip(multiplier === m), flex: 1, minHeight: 48, fontSize: 15, fontWeight: 800 }}>
                    x{m}
                  </button>
                ))}
              </div>
              <div style={{ background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.65)', marginBottom: 6 }}>
                  <span>Original stake</span>
                  <span>${originalStake}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                  <span>Press (x{multiplier})</span>
                  <span style={{ color: ACCENT }}>${pressStake}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.55)', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)' }}>
                  <span>If continuing original</span>
                  <span>${totalExposure} exposure</span>
                </div>
              </div>
            </>
          )}

          {step === 'original' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => setOriginalBetAction('continue')} style={card(originalBetAction === 'continue')}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Keep original bet running</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>
                  Both bets run through hole {currentHole >= 1 ? (teams.length ? currentHole : currentHole) : '—'}
                </div>
              </button>
              <button type="button" onClick={() => setOriginalBetAction('close')} style={card(originalBetAction === 'close')}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Close original bet</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>
                  Settles through hole {currentHole}. Press starts hole {startHole}.
                </div>
              </button>
            </div>
          )}

          {step === 'confirm' && (
            <div style={{ background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 20, padding: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 10 }}>
                {pairingNames.downName} presses vs {pairingNames.upName}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT, marginBottom: 6 }}>
                x{multiplier} press · ${pressStake}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>
                Starts hole {startHole}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.55)' }}>
                Original: {originalBetAction === 'continue' ? 'Continue running' : `Close thru hole ${currentHole}`}
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: '#fb7185' }}>{error}</div>
          )}
        </div>

        <div style={{ padding: '8px 18px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {step === 'confirm' ? (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              style={{
                width: '100%',
                minHeight: 52,
                borderRadius: 15,
                background: ACCENT,
                color: ACCENT_DARK,
                fontSize: 16,
                fontWeight: 800,
                border: 'none',
                cursor: submitting ? 'wait' : 'pointer',
                opacity: submitting ? 0.7 : 1,
                boxShadow: `0 6px 18px ${hexA(ACCENT, 0.45)}`,
              }}
            >
              {submitting ? 'Setting press…' : 'Confirm Press'}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              style={{
                width: '100%',
                minHeight: 52,
                borderRadius: 15,
                background: ACCENT,
                color: ACCENT_DARK,
                fontSize: 16,
                fontWeight: 800,
                border: 'none',
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${hexA(ACCENT, 0.45)}`,
              }}
            >
              Continue
            </button>
          )}
          <button
            type="button"
            onClick={goBack}
            style={{
              width: '100%',
              minHeight: 44,
              borderRadius: 14,
              background: 'transparent',
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              color: 'rgba(255,255,255,.6)',
              cursor: 'pointer',
            }}
          >
            {step === 'target' || (!needsTargetPick && step === 'multiplier') ? 'Cancel' : 'Back'}
          </button>
        </div>
      </div>
    </div>
  )
}
