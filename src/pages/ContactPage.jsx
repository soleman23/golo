import { useState, useEffect } from 'react'
import AppHeader from '../components/shared/AppHeader'
import useProfileStore from '../store/profileStore'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'
const BACKDROP = '/courses/course.png'
const COURSE_FALLBACK_BG = 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)'
const SUPPORT_EMAIL = 'support@gologolf.app'

export default function ContactPage() {
  const profileName = useProfileStore((s) => s.name)
  const profileEmail = useProfileStore((s) => s.email)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (profileName && !name) setName(profileName)
    if (profileEmail && !email) setEmail(profileEmail)
  }, [profileName, profileEmail, name, email])

  const canSend = name.trim() && email.trim() && message.trim()

  const send = () => {
    if (!canSend) return
    const subject = encodeURIComponent(`GoLo support — ${name.trim()}`)
    const body = encodeURIComponent(
      `From: ${name.trim()}\nEmail: ${email.trim()}\n\n${message.trim()}`
    )
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
    setSent(true)
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: `url(${BACKDROP}), ${COURSE_FALLBACK_BG}`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={S.scrim} />
      <div style={S.column}>
        <AppHeader accent={ACCENT} backTo="/you" logo="wordmark" rightAction="pin" kicker="WE'RE HERE" title="Contact support" currentPage="Contact support" />
        <div className="golo-scroll" style={S.scroll}>
          <p style={S.copy}>Tell us what's going on and we'll get back to you. Typically a reply within one business day.</p>
          <label style={S.label}>YOUR NAME</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={S.input} />
          <label style={S.label}>EMAIL</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email" style={S.input} />
          <label style={S.label}>MESSAGE</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the issue, what you expected, and what happened..." style={S.textarea} />
          {sent && (
            <div style={S.success}>
              Your email app should open with the message ready to send to {SUPPORT_EMAIL}. If it didn't, email us directly at {SUPPORT_EMAIL}.
            </div>
          )}
        </div>
        <div style={S.footer}>
          <button type="button" disabled={!canSend} onClick={send} style={{ ...S.sendBtn, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed' }}>
            Send message
          </button>
        </div>
      </div>
    </div>
  )
}

const S = {
  root: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff', background: COURSE_FALLBACK_BG },
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: '50% 40%' },
  scrim: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(6,14,9,.66) 0%, rgba(5,12,8,.84) 38%, rgba(3,10,7,.97) 100%)' },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  scroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 16px 14px' },
  copy: { fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,.68)', margin: '0 2px 16px' },
  label: { display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', margin: '0 0 8px 2px' },
  input: { width: '100%', minHeight: 52, boxSizing: 'border-box', marginBottom: 16, borderRadius: 14, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.16)', color: '#fff', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', padding: '0 15px', outline: 'none' },
  textarea: { width: '100%', minHeight: 118, boxSizing: 'border-box', marginBottom: 16, borderRadius: 14, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.16)', color: '#fff', fontSize: 16, fontWeight: 600, lineHeight: 1.5, fontFamily: 'inherit', padding: '13px 15px', resize: 'none', outline: 'none' },
  success: { borderRadius: 14, padding: 14, background: 'rgba(212,242,58,.12)', border: '1px solid rgba(212,242,58,.3)', color: 'rgba(255,255,255,.86)', fontSize: 13, fontWeight: 700, lineHeight: 1.45 },
  footer: { flex: '0 0 auto', padding: '10px 16px max(18px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, rgba(4,12,8,0) 0%, rgba(4,12,8,.7) 55%)' },
  sendBtn: { width: '100%', minHeight: 54, borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 800, background: ACCENT, color: ACCENT_DARK, boxShadow: '0 12px 30px rgba(212,242,58,.32)' },
}
