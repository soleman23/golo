import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import useProfileStore from '../store/profileStore'
import useLiveRoundStore from '../store/liveRoundStore'
import { playerKey, displayName, hasContact } from '../lib/identity'
import { joinLiveRound, peekLiveRound, liveRoundUserMessage } from '../lib/db/liveRounds'
import { hydrateFromServer } from '../lib/liveRoundSync'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { hexA } from '../lib/colors'
import AppHeader from '../components/shared/AppHeader'

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'
const COURSE_FALLBACK_BG = 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)'

export default function JoinRoundPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const profileName = useProfileStore((s) => s.name)
  const profileNick = useProfileStore((s) => s.nickname)
  const profileEmail = useProfileStore((s) => s.email)
  const profilePhone = useProfileStore((s) => s.phone)

  const [status, setStatus] = useState('idle') // idle | joining | error | done
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  const profile = useMemo(
    () => ({ name: profileName, nickname: profileNick, email: profileEmail, phone: profilePhone }),
    [profileName, profileNick, profileEmail, profilePhone]
  )
  const myKey = playerKey(profile)
  const canClaim = hasContact(profile) && myKey != null

  // The server matches us to a roster slot (peek redacts contact info, so we
  // can't match client-side) and returns just {id, name} when we're on it.
  const rosterMatch = preview?.my_slot ?? null

  useEffect(() => {
    if (!code || !isSupabaseConfigured || !userId) return
    let cancelled = false
    ;(async () => {
      const data = await peekLiveRound(code)
      if (cancelled) return
      if (!data) {
        setError('Live round not found or already finished.')
        setStatus('error')
        return
      }
      setPreview(data)
      if (data.already_member) setStatus('member')
    })()
    return () => { cancelled = true }
  }, [code, userId])

  async function doJoin(asPlayer) {
    if (!code) return
    setStatus('joining')
    setError('')
    const claimKey = asPlayer && canClaim ? myKey : null
    const res = await joinLiveRound(code, claimKey)
    if (res.error) {
      const msg = liveRoundUserMessage(res.error)
      setError(msg)
      setStatus('error')
      return
    }
    const data = res.data
    const liveRoundId = data.live_round_id
    const role = data.role
    const organizer = data.state?.players?.[0]?.name ?? 'Organizer'

    useLiveRoundStore.getState().setSession({
      liveRoundId,
      inviteCode: data.invite_code ?? code.toUpperCase(),
      role,
      scorerName: organizer,
    })

    hydrateFromServer(data.state)

    navigate('/scoring', { replace: true })
  }

  async function resumeMember() {
    if (!preview) return
    const liveRoundId = preview.live_round_id
    const role = preview.member_role ?? 'viewer'
    useLiveRoundStore.getState().setSession({
      liveRoundId,
      inviteCode: preview.invite_code ?? code,
      role,
      scorerName: preview.state?.players?.[0]?.name ?? 'Scorer',
    })
    hydrateFromServer(preview.state)
    navigate('/scoring', { replace: true })
  }

  if (!isSupabaseConfigured) {
    return (
      <div style={S.root}>
        <div style={S.scrim} />
        <div style={S.column}>
          <AppHeader accent={ACCENT} backTo="/" logo="wordmark" kicker="JOIN ROUND" title="Unavailable" />
          <div style={S.body}>Live rounds require the cloud backend. Run with Supabase configured.</div>
        </div>
      </div>
    )
  }

  const courseName = preview?.course_name ?? preview?.state?.round?.course ?? 'Live round'

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, background: COURSE_FALLBACK_BG }} />
      <div style={S.scrim} />

      <div style={S.column}>
        <AppHeader accent={ACCENT} backTo="/" logo="wordmark" kicker="JOIN ROUND" title={courseName} />

        <div style={S.body}>
          <div style={S.card}>
            <div style={S.kicker}>INVITE CODE</div>
            <div style={S.code}>{(code || '').toUpperCase()}</div>
            <p style={S.copy}>
              {canClaim && rosterMatch
                ? `You're on the roster as ${displayName(rosterMatch)}. Claim your spot for a live board tied to your standing.`
                : 'Join as a viewer to follow scores in real time. If your email or phone is on the roster, you can claim a player slot.'}
            </p>

            {error && <div style={S.error}>{error}</div>}

            {status === 'member' && (
              <button type="button" onClick={resumeMember} style={{ ...S.primaryBtn, marginTop: 16 }}>
                Go to live scoring →
              </button>
            )}

            {status !== 'member' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {canClaim && rosterMatch && (
                  <button
                    type="button"
                    disabled={status === 'joining'}
                    onClick={() => doJoin(true)}
                    style={S.primaryBtn}
                  >
                    {status === 'joining' ? 'Joining…' : 'Claim your spot →'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={status === 'joining'}
                  onClick={() => doJoin(false)}
                  style={canClaim && rosterMatch ? S.secondaryBtn : S.primaryBtn}
                >
                  {status === 'joining' ? 'Joining…' : canClaim && rosterMatch ? 'Watch as viewer' : 'Join round →'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const S = {
  root: {
    position: 'relative',
    minHeight: '100dvh',
    background: '#0a2418',
    color: '#fff',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  },
  backdrop: { position: 'absolute', inset: 0, opacity: 0.35 },
  scrim: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(10,36,24,.85) 100%)',
  },
  column: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 390,
    margin: '0 auto',
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
  },
  body: { flex: 1, padding: '18px 16px 32px' },
  card: {
    borderRadius: 22,
    padding: 20,
    background: 'rgba(20,28,24,.5)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${hexA('#fff', 0.13)}`,
  },
  kicker: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: ACCENT },
  code: { fontSize: 36, fontWeight: 800, letterSpacing: 4, marginTop: 6 },
  copy: { margin: '12px 0 0', fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,.65)', fontWeight: 600 },
  error: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 12,
    background: 'rgba(251,113,133,.12)',
    border: '1px solid rgba(251,113,133,.35)',
    color: '#fb7185',
    fontSize: 13,
    fontWeight: 700,
  },
  primaryBtn: {
    width: '100%',
    minHeight: 52,
    borderRadius: 16,
    border: 'none',
    background: ACCENT,
    color: ACCENT_DARK,
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: `0 8px 22px ${hexA(ACCENT, 0.4)}`,
  },
  secondaryBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,.16)',
    background: 'rgba(255,255,255,.08)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
}
