import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useProfileStore from '../store/profileStore'
import useAuthStore from '../store/authStore'
import { hasContact } from '../lib/identity'
import { GoloWordmark } from '../components/shared/Logo'
import { CheckIcon } from '../components/shared/GoloIcons'
import BackButton from '../components/shared/BackButton'

/**
 * OnboardingPage — first-run flow, "glass-over-turf" (Golo Golf - Onboarding).
 *
 * Three screens: WELCOME → SIGN IN (provider placeholders for local-only mode) →
 * SET UP YOUR LOCKER (verified contact identity). When Supabase auth is enabled,
 * App routes straight to the locker step (`lockerOnly`) with signup email prefilled.
 *
 * The route gate lives in App; finishing marks `onboarded` so the flow never
 * nags again once a verified contact is present. Inline styles match the
 * prototype, same approach as the rest of the app.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

const TICKS = [
  'Auto settle-up after every round',
  'Live skins, Nassau & the purse',
  "Your crew's season ledger, always current",
]

/* ------------------------------------------------------------------- helpers */

function hexA(hex, a) {
  let h = (hex || ACCENT).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(255,255,255,${a})`
  return `rgba(${r},${g},${b},${a})`
}

const initial = (name) => (name || '').trim().charAt(0).toUpperCase() || '⛳'

/* ----------------------------------------------------------- provider icons */

const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true" style={{ marginTop: -2 }}>
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM262.1 104.5c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
)

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 488 512" fill="currentColor" aria-hidden="true">
    <path d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z" />
  </svg>
)

/* --------------------------------------------------------------- component */

export default function OnboardingPage({ lockerOnly = false }) {
  const navigate = useNavigate()
  const setIdentity = useProfileStore((s) => s.setIdentity)
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding)
  // Any identity already saved to the profile — used to prefill the locker so a
  // returning user confirms/edits instead of retyping.
  const profileName = useProfileStore((s) => s.name)
  const profileNick = useProfileStore((s) => s.nickname)
  const profileEmail = useProfileStore((s) => s.email)
  const profilePhone = useProfileStore((s) => s.phone)
  // When real auth is on, the user already signed up — skip the welcome/sign-in
  // screens and go straight to the locker, pre-filling the email they used.
  const authEmail = useAuthStore((s) => s.user?.email ?? null)

  // Seed the locker form once, only when we land straight on it (lockerOnly). A
  // saved profile contact (email/phone) is the source of truth and brings name,
  // handle and phone along with it; email falls back to authEmail so an empty
  // profile email never clobbers the address they signed in with. The normal
  // welcome → sign-in → locker flow still starts blank. Nothing here completes
  // onboarding — that only happens when the user taps the locker CTA (finish()).
  const hasProfileContact = hasContact({ email: profileEmail, phone: profilePhone })
  const seed = lockerOnly
    ? {
        name: hasProfileContact ? (profileName ?? '') : '',
        handle: hasProfileContact ? (profileNick ?? '') : '',
        email: profileEmail || authEmail || '',
        phone: hasProfileContact ? (profilePhone ?? '') : '',
      }
    : { name: '', handle: '', email: '', phone: '' }

  const [step, setStep] = useState(lockerOnly ? 2 : 0) // 0 = welcome, 1 = sign in, 2 = locker
  const [authMode, setAuthMode] = useState('create') // create | signin (copy only)
  const [name, setNameInput] = useState(seed.name)
  const [handle, setHandle] = useState(seed.handle)
  const [email, setEmail] = useState(seed.email)
  const [phone, setPhone] = useState(seed.phone)
  const isCreate = authMode === 'create'

  // Sanitised identity from the live form — the single source of truth for BOTH
  // the CTA's enable-state (canFinish) and what actually gets saved. Trimming
  // means a whitespace-only email/phone can never count as a real contact; name
  // and handle stay optional.
  const identity = {
    name: name.trim(),
    nickname: handle.trim().replace(/^@+/, ''),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
  }
  const canFinish = hasContact(identity) // need a non-blank email or phone

  // Save ONLY if there's a real contact — no contact ⇒ bail before touching the
  // store. completeOnboarding() runs only here, from the locker CTA.
  const finish = () => {
    if (!hasContact(identity)) return
    setIdentity(identity)
    completeOnboarding()
    navigate('/', { replace: true })
  }

  /* ------------------------------------------------------ screen 1 · welcome */
  if (step === 0) {
    return (
      <div style={S.root}>
        <div style={{ ...S.backdrop, backgroundImage: "url('/courses/sunset.png')", backgroundPosition: '50% 46%' }} />
        <div style={{ ...S.scrim, background: 'linear-gradient(180deg, rgba(6,14,9,.42) 0%, rgba(6,14,9,.34) 30%, rgba(6,16,10,.72) 66%, rgba(3,10,7,.97) 100%)' }} />

        <div style={S.column}>
          <div style={{ flex: '0 0 auto', padding: 'max(18px, env(safe-area-inset-top)) 26px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, filter: 'drop-shadow(0 2px 12px rgba(0,0,0,.5))' }}>
            <BackButton />
            <GoloWordmark variant="primary" fontPx={34} />
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ flex: '0 0 auto', padding: '0 26px 22px', textShadow: '0 2px 16px rgba(0,0,0,.55)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT, marginBottom: 12 }}>GOLF, BUT SETTLED</div>
            <h2 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.02, letterSpacing: -1.2, margin: 0, color: '#fff' }}>Keep the bets honest.</h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'rgba(255,255,255,.82)', margin: '14px 0 0', maxWidth: 300 }}>
              Skins, Nassau, the whole purse — Golo tracks every dollar so the only thing left to argue about is your swing.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 20 }}>
              {TICKS.map((t) => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <CheckIcon size={22} style={{ filter: `drop-shadow(0 4px 10px ${hexA(ACCENT, 0.45)})` }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: '0 0 auto', padding: '0 22px max(26px, env(safe-area-inset-bottom))' }}>
            <button onClick={() => { setAuthMode('create'); setStep(1) }} style={S.primaryCta}>Get started</button>
            <button onClick={() => { setAuthMode('signin'); setStep(1) }} style={S.linkBtn}>
              Already play with Golo? <span style={{ color: ACCENT, fontWeight: 800 }}>Sign in</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------ screen 2 · sign in */
  if (step === 1) {
    return (
      <div style={S.root}>
        <div style={{ ...S.backdrop, backgroundImage: "url('/courses/course.png')", backgroundPosition: '50% 30%' }} />
        <div style={{ ...S.scrim, background: 'linear-gradient(180deg, rgba(6,14,9,.7) 0%, rgba(5,12,8,.86) 40%, rgba(3,10,7,.97) 100%)' }} />

        <div style={S.column}>
          {/* nav */}
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'max(14px, env(safe-area-inset-top)) 18px 0' }}>
            <BackButton onClick={() => setStep(0)} />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.55)' }}>STEP 1 OF 2</span>
            <span style={{ width: 72 }} />
          </div>

          {/* body */}
          <div style={{ ...S.scroll, display: 'flex', flexDirection: 'column', padding: '14px 22px 18px' }}>
            <div style={{ flex: '0 0 auto', marginBottom: 22 }}>
              <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, margin: 0, color: '#fff' }}>
                {isCreate ? 'Create your account' : 'Welcome back'}
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,.62)', margin: '9px 0 0' }}>
                {isCreate
                  ? 'Two taps from your first settled round — keeps your crew and your ledger together.'
                  : 'Pick your season up right where you left it — every round and ledger is waiting.'}
              </p>
            </div>

            {/* providers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <button onClick={() => setStep(2)} style={S.providerBtn}><AppleIcon /> Continue with Apple</button>
              <button onClick={() => setStep(2)} style={S.providerBtn}><GoogleIcon /> Continue with Google</button>
              <button onClick={() => setStep(2)} style={S.providerGlassBtn}><span aria-hidden="true" style={{ fontSize: 16 }}>✆</span> Continue with phone</button>
            </div>

            <div style={{ flex: 1 }} />

            {/* trust + legal + switch */}
            <div style={{ marginTop: 24 }}>
              <div style={S.noteCard}>
                <span style={{ fontSize: 15 }}>🔒</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.8)', lineHeight: 1.4 }}>
                  Golo never posts for you and never charges a card. Settle-up always needs your tap.
                </span>
              </div>
              <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,.45)', textAlign: 'center', margin: '14px 4px 0' }}>
                By continuing you agree to Golo's Terms of Service &amp; Privacy Policy.
              </p>
              <button onClick={() => setAuthMode(isCreate ? 'signin' : 'create')} aria-pressed={!!isCreate} style={{ ...S.linkBtn, marginTop: 12 }}>
                {isCreate ? 'Already play with Golo? ' : 'New to Golo? '}
                <span style={{ color: ACCENT, fontWeight: 800 }}>{isCreate ? 'Sign in' : 'Create an account'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* -------------------------------------------------- screen 3 · set up locker */
  // @handle preview: the entered handle, else a slug of the name, else nothing.
  const handlePreview = identity.nickname
    ? `@${identity.nickname}`
    : identity.name
      ? `@${identity.name.toLowerCase().replace(/\s+/g, '')}`
      : null
  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: "url('/courses/turf.png')", backgroundPosition: '50% 40%' }} />
      <div style={{ ...S.scrim, background: 'linear-gradient(180deg, rgba(6,14,9,.66) 0%, rgba(5,12,8,.84) 38%, rgba(3,10,7,.97) 100%)' }} />

      <div style={S.column}>
        {/* nav + progress */}
        <div style={{ flex: '0 0 auto', padding: 'max(14px, env(safe-area-inset-top)) 22px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {lockerOnly ? (
              <BackButton />
            ) : (
              <BackButton onClick={() => setStep(1)} />
            )}
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.55)' }}>{lockerOnly ? 'ONE LAST STEP' : 'STEP 2 OF 2'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT }}>almost there</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <span style={{ flex: 1, height: 4, borderRadius: 9999, background: ACCENT }} />
            <span style={{ flex: 1, height: 4, borderRadius: 9999, background: ACCENT }} />
          </div>
        </div>

        {/* body */}
        <div style={S.scroll}>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, margin: 0, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>Set up your locker</h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'rgba(255,255,255,.6)', margin: '8px 0 18px' }}>
            Add your email or phone — that's how Golo knows which player is you across every round, the crew ledger, and settle-up. Name and handle are optional.
          </p>

          <div style={S.lockerCard}>
            <div style={{ ...S.avatar, width: 64, height: 64, fontSize: 26, background: canFinish ? ACCENT : 'rgba(255,255,255,.1)', color: canFinish ? ACCENT_DARK : 'rgba(255,255,255,.5)', boxShadow: `0 0 0 3px ${hexA(ACCENT, 0.5)}` }}>
              {initial(identity.name || identity.nickname)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="onboard-name" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,.5)' }}>NAME</label>
              <input
                id="onboard-name"
                value={name}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                autoComplete="off"
                autoCapitalize="words"
                maxLength={24}
                style={S.nameInput}
              />
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>
                {handlePreview ?? 'Pick anything your crew will recognise'}
              </div>
            </div>
          </div>

          {/* identity fields */}
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@handle (optional)"
            aria-label="Handle"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            style={S.lockerField}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            style={S.lockerField}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            aria-label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            style={S.lockerField}
          />
          <div style={{ ...S.noteCard, marginTop: 14 }}>
            <span style={{ fontSize: 15 }}>🔒</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.8)', lineHeight: 1.45 }}>
              No card, no fees. Everything — scores, bets and your ledger — stays on this phone, and settle-up always needs your tap.
            </span>
          </div>
        </div>

        {/* CTA */}
        <div style={S.footer}>
          <button
            onClick={() => canFinish && finish()}
            disabled={!canFinish}
            aria-disabled={!canFinish}
            style={{ ...S.primaryCta, opacity: canFinish ? 1 : 0.5, cursor: canFinish ? 'pointer' : 'not-allowed', boxShadow: canFinish ? S.primaryCta.boxShadow : 'none' }}
          >
            Enter Golo
          </button>
          {!canFinish && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.55)', textAlign: 'center', margin: '10px 2px 0' }}>
              Add an email or phone to continue.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- shared styles */

const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff',
    background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
  },
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover' },
  scrim: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  scroll: { flex: 1, overflowY: 'auto', padding: '16px 20px 18px' },


  primaryCta: { width: '100%', background: ACCENT, border: 'none', color: ACCENT_DARK, fontSize: 16, fontWeight: 800, padding: 16, borderRadius: 16, cursor: 'pointer', boxShadow: `0 14px 30px ${hexA(ACCENT, 0.45)}` },
  linkBtn: { width: '100%', marginTop: 14, background: 'transparent', border: 'none', textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.7)', cursor: 'pointer' },

  providerBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, background: '#fff', border: 'none', color: '#0a0a0a', fontSize: 15.5, fontWeight: 800, padding: 15, borderRadius: 15, cursor: 'pointer', boxShadow: '0 10px 26px rgba(0,0,0,.34)' },
  providerGlassBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, background: 'rgba(255,255,255,.08)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15.5, fontWeight: 800, padding: 15, borderRadius: 15, cursor: 'pointer' },
  avatar: { borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 },
  lockerCard: { display: 'flex', alignItems: 'center', gap: 15, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '15px 16px', marginBottom: 11, boxShadow: '0 8px 22px rgba(0,0,0,.26)' },
  nameInput: { display: 'block', width: '100%', marginTop: 2, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: -0.3, padding: 0 },
  lockerField: { width: '100%', boxSizing: 'border-box', marginTop: 10, minHeight: 50, borderRadius: 14, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', padding: '0 15px', outline: 'none' },
  noteCard: { display: 'flex', alignItems: 'center', gap: 9, background: hexA(ACCENT, 0.08), border: `1px solid ${hexA(ACCENT, 0.32)}`, borderRadius: 13, padding: '11px 13px' },

  footer: { flex: '0 0 auto', padding: '6px 20px max(24px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, rgba(3,10,7,0) 0%, rgba(3,10,7,.6) 50%)' },
}
