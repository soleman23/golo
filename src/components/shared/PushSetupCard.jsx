import { useEffect, useState } from 'react'
import { hexA } from '../../lib/colors'
import {
  isPushConfigured,
  isPushSupported,
  pushPermission,
  isStandalone,
  isIos,
  isSubscribed,
  enablePush,
  disablePush,
} from '../../lib/push'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

/**
 * Push notification opt-in. Follows the guide's "ask at the right time" rule:
 * the browser permission prompt fires only after the user taps Enable — never on
 * load. Handles the denied path (keeps in-app working, shows how to re-enable)
 * and the iOS case (Web Push needs an installed Home Screen PWA).
 */
export default function PushSetupCard() {
  const [supported] = useState(() => isPushSupported())
  const [perm, setPerm] = useState(() => pushPermission())
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const sub = await isSubscribed()
      if (alive) {
        setSubscribed(sub)
        setPerm(pushPermission())
      }
    })()
    return () => { alive = false }
  }, [])

  // Not wired up at all (no VAPID key) — say so honestly rather than dangle a
  // button that can't work.
  if (!isPushConfigured) {
    return (
      <Wrap>
        <Title>Push notifications</Title>
        <Muted>Push alerts (when GoLo is closed) aren’t enabled on this build yet.</Muted>
      </Wrap>
    )
  }

  if (!supported) {
    return (
      <Wrap>
        <Title>Push notifications</Title>
        <Muted>This browser doesn’t support push. In-app alerts still work while GoLo is open.</Muted>
      </Wrap>
    )
  }

  // iOS/iPadOS: Web Push only works from the installed Home Screen app.
  if (isIos() && !isStandalone()) {
    return (
      <Wrap>
        <Title>Push notifications</Title>
        <Muted>
          On iPhone/iPad, add GoLo to your Home Screen first: tap the Share icon, then
          <b style={{ color: '#fff' }}> Add to Home Screen</b>, and open GoLo from there to enable push.
        </Muted>
      </Wrap>
    )
  }

  const onEnable = async () => {
    setBusy(true)
    setError(null)
    const res = await enablePush()
    setPerm(pushPermission())
    setSubscribed(res.ok)
    if (!res.ok && res.reason !== 'denied' && res.reason !== 'default') {
      setError('Could not enable push. Please try again.')
    }
    setBusy(false)
  }

  const onDisable = async () => {
    setBusy(true)
    setError(null)
    await disablePush()
    setSubscribed(false)
    setBusy(false)
  }

  const denied = perm === 'denied'

  return (
    <Wrap>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title>Push notifications</Title>
          <Muted>
            {subscribed
              ? 'On — you’ll get important round, betting, and payment alerts when GoLo is closed.'
              : 'Get important round, betting, and payment alerts when GoLo is closed.'}
          </Muted>
        </div>
        {subscribed ? (
          <button type="button" onClick={onDisable} disabled={busy} style={S.ghostBtn}>
            {busy ? '…' : 'Turn off'}
          </button>
        ) : (
          <button type="button" onClick={onEnable} disabled={busy || denied} style={{ ...S.enableBtn, opacity: busy || denied ? 0.55 : 1 }}>
            {busy ? 'Enabling…' : 'Enable'}
          </button>
        )}
      </div>

      {denied && !subscribed && (
        <Muted style={{ marginTop: 8, color: '#fb7185' }}>
          Notifications are blocked in your browser settings. Allow them for this site, then tap Enable again.
        </Muted>
      )}
      {error && <Muted style={{ marginTop: 8, color: '#fb7185' }}>{error}</Muted>}
    </Wrap>
  )
}

/* -------------------------------------------------------------- small pieces */

const Wrap = ({ children }) => <div style={S.card}>{children}</div>
const Title = ({ children }) => <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{children}</div>
const Muted = ({ children, style }) => (
  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 3, lineHeight: 1.45, ...style }}>{children}</div>
)

const S = {
  card: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 18, padding: '14px 16px', marginBottom: 10 },
  enableBtn: { flex: '0 0 auto', minHeight: 40, padding: '0 16px', borderRadius: 12, border: 'none', background: ACCENT, color: ACCENT_DARK, fontSize: 13.5, fontWeight: 800, cursor: 'pointer' },
  ghostBtn: { flex: '0 0 auto', minHeight: 40, padding: '0 14px', borderRadius: 12, border: `1px solid ${hexA(ACCENT, 0.4)}`, background: hexA(ACCENT, 0.12), color: ACCENT, fontSize: 13, fontWeight: 800, cursor: 'pointer' },
}
