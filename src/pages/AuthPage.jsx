import { hexA } from '../lib/colors'
import { useState } from 'react'
import useAuthStore from '../store/authStore'
import { GoloWordmark } from '../components/shared/Logo'

/**
 * AuthPage — email/password sign in & create account, "glass-over-turf" to match
 * the onboarding flow. This is the real gate when the Supabase backend is
 * configured: no session, no app. On success the auth store's session updates
 * and App routes the user onward (to onboarding if their profile is incomplete,
 * else Home).
 *
 * Sign-up may require email confirmation depending on the Supabase project
 * settings; when no session comes back we show a "check your inbox" state rather
 * than pretending the user is in.
 */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

export default function AuthPage() {
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const resetPassword = useAuthStore((s) => s.resetPassword)

  const [mode, setMode] = useState('signin') // 'signin' | 'create' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const isCreate = mode === 'create'
  const isForgot = mode === 'forgot'
  const emailOk = /\S+@\S+\.\S+/.test(email.trim().toLowerCase())
  const passOk = password.length >= 6
  const matchOk = !isCreate || confirm === password
  const ready = isForgot
    ? emailOk && !busy
    : emailOk && passOk && matchOk && !busy
  const showEmailHelp = email.trim().length > 0 && !emailOk
  const showPasswordHelp = password.length > 0 && !passOk
  const showMatchHelp = isCreate && confirm.length > 0 && !matchOk

  const switchMode = (next) => {
    setMode(next)
    setError(null)
    setNotice(null)
    setConfirm('')
  }

  const submit = async (e) => {
    e.preventDefault()
    const safeEmail = email.trim().toLowerCase()
    const safePassword = password
    const safeEmailOk = /\S+@\S+\.\S+/.test(safeEmail)
    const safePassOk = safePassword.length >= 6
    const safeMatchOk = !isCreate || confirm === safePassword
    if (busy) return
    if (isForgot) {
      if (!safeEmailOk) return
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const { error: err } = await resetPassword(safeEmail)
        if (err) setError(err.message || 'Could not send reset email. Try again.')
        else setNotice('Check your inbox for a password reset link.')
      } catch {
        setError('Something went wrong. Try again.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (!safeEmailOk || !safePassOk || !safeMatchOk) return

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const fn = isCreate ? signUp : signIn
      const { data, error: err } = await fn({ email: safeEmail, password: safePassword })
      if (err) {
        setError(err.message || 'Something went wrong. Try again.')
        return
      }
      // Sign-up with email confirmation returns no session — tell the user.
      if (isCreate && !data?.session) {
        setNotice('Check your inbox to confirm your email, then sign in.')
        setMode('signin')
        setPassword('')
        setConfirm('')
      }
      // On success with a session, App re-renders via the auth store and routes on.
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: "url('/courses/course.png')", backgroundPosition: '50% 30%' }} />
      <div style={S.scrim} />

      <div style={S.column}>
        <div style={S.header}>
          <GoloWordmark variant="primary" fontPx={30} />
        </div>

        <form onSubmit={submit} style={{ ...S.scroll, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '0 0 auto', marginBottom: 22, marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT, marginBottom: 10 }}>GOLF, BUT SETTLED</div>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, margin: 0, color: '#fff' }}>
              {isForgot ? 'Reset password' : isCreate ? 'Create your account' : 'Welcome back'}
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,.62)', margin: '9px 0 0' }}>
              {isForgot
                ? 'We will email you a link to choose a new password.'
                : isCreate
                  ? 'One account keeps your rounds, crew and ledger together across every device.'
                  : 'Pick your season up right where you left it.'}
            </p>
          </div>

          {notice && (
            <div style={{ ...S.noteCard, marginBottom: 14, borderColor: hexA(ACCENT, 0.4) }}>
              <span style={{ fontSize: 15 }}>✉️</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.85)', lineHeight: 1.4 }}>{notice}</span>
            </div>
          )}

          <label htmlFor="auth-email" style={S.fieldLabel}>EMAIL</label>
          <input
            id="auth-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            style={S.field}
          />
          {showEmailHelp && <div style={S.errText}>Enter a valid email.</div>}

          {!isForgot && (
            <>
          <label htmlFor="auth-password" style={S.fieldLabel}>PASSWORD</label>
          <input
            id="auth-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isCreate ? 'At least 6 characters' : 'Your password'}
            type="password"
            autoComplete={isCreate ? 'new-password' : 'current-password'}
            style={S.field}
          />
          {showPasswordHelp && <div style={S.errText}>Password must be at least 6 characters.</div>}

          {isCreate && (
            <>
              <label htmlFor="auth-confirm" style={S.fieldLabel}>CONFIRM PASSWORD</label>
              <input
                id="auth-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                type="password"
                autoComplete="new-password"
                style={S.field}
              />
              {showMatchHelp && <div style={S.errText}>Passwords do not match.</div>}
            </>
          )}
            </>
          )}

          {error && <div style={{ ...S.errText, marginTop: 12 }}>{error}</div>}

          <button type="submit" disabled={!ready || busy} style={{ ...S.primaryCta, opacity: ready && !busy ? 1 : 0.5, cursor: ready && !busy ? 'pointer' : 'not-allowed', marginTop: 20 }}>
            {busy ? 'One sec…' : isForgot ? 'Send reset link' : isCreate ? 'Create account' : 'Sign in'}
          </button>

          {!isForgot && mode === 'signin' && (
            <button type="button" onClick={() => switchMode('forgot')} style={{ ...S.linkBtn, marginTop: 10 }}>
              Forgot password?
            </button>
          )}

          {isForgot && (
            <button type="button" onClick={() => switchMode('signin')} style={{ ...S.linkBtn, marginTop: 10 }}>
              Back to sign in
            </button>
          )}

          <div style={{ flex: 1 }} />

          {!isForgot && (
          <div style={{ marginTop: 24 }}>
            <div style={S.noteCard}>
              <span style={{ fontSize: 15 }}>🔒</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.8)', lineHeight: 1.4 }}>
                Golo never posts for you and never charges a card. Settle-up always needs your tap.
              </span>
            </div>
            <button type="button" onClick={() => switchMode(isCreate ? 'signin' : 'create')} aria-pressed={!!isCreate} style={S.linkBtn}>
              {isCreate ? 'Already play with Golo? ' : 'New to Golo? '}
              <span style={{ color: ACCENT, fontWeight: 800 }}>{isCreate ? 'Sign in' : 'Create an account'}</span>
            </button>
          </div>
          )}
        </form>
      </div>
    </div>
  )
}

const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff',
    background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
  },
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover' },
  scrim: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(6,14,9,.7) 0%, rgba(5,12,8,.86) 40%, rgba(3,10,7,.97) 100%)' },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  header: { flex: '0 0 auto', padding: 'max(18px, env(safe-area-inset-top)) 26px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, filter: 'drop-shadow(0 2px 12px rgba(0,0,0,.5))' },
  scroll: { flex: 1, overflowY: 'auto', padding: '14px 22px 18px' },

  fieldLabel: { display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,.5)', marginTop: 14, marginBottom: 7 },
  field: { width: '100%', boxSizing: 'border-box', minHeight: 50, borderRadius: 14, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', padding: '0 15px', outline: 'none' },
  errText: { fontSize: 12.5, fontWeight: 700, color: '#fb7185', margin: '8px 2px 0' },

  primaryCta: { width: '100%', background: ACCENT, border: 'none', color: ACCENT_DARK, fontSize: 16, fontWeight: 800, padding: 16, borderRadius: 16, boxShadow: `0 14px 30px ${hexA(ACCENT, 0.45)}` },
  linkBtn: { width: '100%', marginTop: 14, background: 'transparent', border: 'none', textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.7)', cursor: 'pointer' },
  noteCard: { display: 'flex', alignItems: 'center', gap: 9, background: hexA(ACCENT, 0.08), border: `1px solid ${hexA(ACCENT, 0.32)}`, borderRadius: 13, padding: '11px 13px' },
}
