import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useNotificationStore from '../../store/notificationStore'
import { hexA } from '../../lib/colors'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

export default function LiveToast() {
  const navigate = useNavigate()
  const toasts = useNotificationStore((s) => s.toasts)
  const dismiss = useNotificationStore((s) => s.dismissToast)
  const clearAll = useNotificationStore((s) => s.clearToasts)
  const markRead = useNotificationStore((s) => s.markRead)

  // Tapping a toast opens its deep-link (and marks the backing notification
  // read); toasts without an action just dismiss.
  const handleOpen = (t) => {
    if (t.actionUrl) {
      if (t.notificationId) markRead(t.notificationId)
      navigate(t.actionUrl)
    }
    dismiss(t.id)
  }

  useEffect(() => {
    if (!toasts.length) return undefined
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), t.duration ?? 4000)
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
      {toasts.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', pointerEvents: 'auto' }}>
          <button
            type="button"
            onClick={clearAll}
            style={{
              border: 'none',
              background: 'rgba(14,20,16,.92)',
              backdropFilter: 'blur(26px)',
              WebkitBackdropFilter: 'blur(26px)',
              boxShadow: '0 8px 22px rgba(0,0,0,.3)',
              color: 'rgba(255,255,255,.82)',
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: 0.3,
              borderRadius: 9999,
              padding: '5px 12px',
              cursor: 'pointer',
            }}
          >
            Clear all ({toasts.length})
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => handleOpen(t)}
          title={t.actionUrl ? 'Tap to open' : 'Tap to dismiss'}
          style={{
            pointerEvents: 'auto',
            cursor: 'pointer',
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
            onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}
            aria-label="Dismiss notification"
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
