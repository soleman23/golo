import { useEffect } from 'react'
import useNotificationStore from '../../store/notificationStore'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

function hexA(hex, a) {
  let h = (hex || ACCENT).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(255,255,255,${a})`
  return `rgba(${r},${g},${b},${a})`
}

export default function LiveToast() {
  const toasts = useNotificationStore((s) => s.toasts)
  const dismiss = useNotificationStore((s) => s.dismissToast)

  useEffect(() => {
    if (!toasts.length) return undefined
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), t.duration ?? 5000)
    )
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  if (!toasts.length) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(390px, calc(100vw - 24px))',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            pointerEvents: 'auto',
            borderRadius: 16,
            padding: '12px 14px',
            background: 'rgba(14,20,16,.92)',
            backdropFilter: 'blur(26px)',
            WebkitBackdropFilter: 'blur(26px)',
            border: '1px solid rgba(255,255,255,.14)',
            boxShadow: `0 12px 32px rgba(0,0,0,.35), 0 0 0 1px ${hexA(ACCENT, 0.12)}`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {t.kicker && (
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: ACCENT, marginBottom: 3 }}>
                {t.kicker}
              </div>
            )}
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', lineHeight: 1.35 }}>{t.title}</div>
            {t.body && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.62)', marginTop: 3, lineHeight: 1.4 }}>
                {t.body}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            style={{
              flex: '0 0 auto',
              border: 'none',
              background: hexA(ACCENT, 0.15),
              color: ACCENT_DARK,
              fontWeight: 800,
              fontSize: 12,
              borderRadius: 9999,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            OK
          </button>
        </div>
      ))}
    </div>
  )
}
