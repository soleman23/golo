import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import { hexA } from '../lib/colors'
import AppHeader from '../components/shared/AppHeader'
import {
  fetchCurrentTerms,
  fetchAcceptances,
  fetchProfileNames,
  respondBettingTerms,
  subscribeToAcceptances,
  summarizeTerms,
} from '../lib/db/betting'

/**
 * BettingReviewPage — the "Review betting terms" screen (Phase 4). A participant
 * reviews the frozen terms and Accepts or Declines their own inclusion; the
 * organizer (and everyone) sees each player's Pending / Accepted / Declined
 * status, live. A bet isn't binding until every included participant accepts.
 */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

const STATUS_STYLE = {
  accepted: { label: 'Accepted', color: '#bef264', bg: 'rgba(190,242,100,.14)' },
  pending: { label: 'Pending', color: 'rgba(255,255,255,.7)', bg: 'rgba(255,255,255,.08)' },
  declined: { label: 'Declined', color: '#fb7185', bg: 'rgba(251,113,133,.14)' },
  superseded: { label: 'Superseded', color: 'rgba(255,255,255,.4)', bg: 'rgba(255,255,255,.05)' },
}

const initial = (name) => (name || '').trim().charAt(0).toUpperCase() || '?'

export default function BettingReviewPage() {
  const { roundId } = useParams()
  const navigate = useNavigate()
  const myUid = useAuthStore((s) => s.user?.id ?? null)

  const [loading, setLoading] = useState(true)
  const [terms, setTerms] = useState(null)
  const [acceptances, setAcceptances] = useState([])
  const [names, setNames] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const t = await fetchCurrentTerms(roundId)
    setTerms(t)
    if (t) {
      const rows = await fetchAcceptances(t.id)
      setAcceptances(rows)
      setNames(await fetchProfileNames(rows.map((r) => r.user_id)))
    }
    setLoading(false)
  }, [roundId])

  useEffect(() => { load() }, [load])

  // Live status as participants respond.
  useEffect(() => {
    if (!terms?.id) return undefined
    return subscribeToAcceptances(terms.id, () => {
      fetchAcceptances(terms.id).then(setAcceptances)
    })
  }, [terms?.id])

  const mine = useMemo(() => acceptances.find((a) => a.user_id === myUid), [acceptances, myUid])
  const summary = useMemo(() => summarizeTerms(terms?.terms), [terms])
  const allAccepted = acceptances.length > 0 && acceptances.every((a) => a.status === 'accepted')

  const respond = async (accept) => {
    if (!terms?.id || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await respondBettingTerms(terms.id, accept)
    if (err) setError(typeof err === 'string' ? err : err.message ?? 'Could not save your response.')
    else await load()
    setBusy(false)
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: 'url(/courses/turf.png), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)' }} />
      <div style={S.scrim} />

      <div style={S.column}>
        <AppHeader accent={ACCENT} backTo={-1} logo="wordmark" rightAction="pin" kicker="BETTING" title="Review terms" />

        <div className="golo-scroll" style={S.scroll}>
          {loading ? (
            <div style={S.empty}>Loading…</div>
          ) : !terms ? (
            <div style={S.empty}>No betting terms for this round yet.</div>
          ) : (
            <>
              {/* status banner */}
              <div style={{ ...S.banner, borderColor: allAccepted ? 'rgba(190,242,100,.4)' : hexA(ACCENT, 0.4) }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: allAccepted ? '#bef264' : ACCENT }}>
                  {allAccepted ? 'BET ACTIVE' : 'AWAITING ACCEPTANCE'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.66)', marginTop: 3, lineHeight: 1.4 }}>
                  {allAccepted
                    ? 'Everyone accepted — the bet is on.'
                    : 'The bet isn’t binding until every player accepts. The round can still be played.'}
                </div>
              </div>

              {/* terms */}
              <div style={S.sectionLabel}>THE TERMS · v{terms.version}</div>
              <div style={S.card}>
                {summary.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)' }}>No games configured.</div>
                ) : (
                  summary.map((line, i) => (
                    <div key={i} style={{ fontSize: 14, fontWeight: 700, color: '#fff', padding: '7px 0', borderTop: i ? '1px solid rgba(255,255,255,.08)' : 'none' }}>{line}</div>
                  ))
                )}
                {terms.max_exposure != null && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.5)', marginTop: 8 }}>
                    Max exposure · ${terms.max_exposure}
                  </div>
                )}
              </div>

              {/* my response */}
              {mine && mine.status === 'pending' && (
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button type="button" onClick={() => respond(false)} disabled={busy} style={S.declineBtn}>Decline</button>
                  <button type="button" onClick={() => respond(true)} disabled={busy} style={S.acceptBtn}>{busy ? '…' : 'Accept terms'}</button>
                </div>
              )}
              {mine && mine.status !== 'pending' && (
                <div style={{ ...S.card, marginTop: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'rgba(255,255,255,.7)' }}>
                    You {mine.status === 'accepted' ? 'accepted these terms.' : mine.status === 'declined' ? 'declined — you’re out of the bet.' : 'are no longer on the current terms.'}
                  </span>
                  {mine.status === 'declined' && (
                    <button type="button" onClick={() => respond(true)} disabled={busy} style={{ ...S.acceptBtn, marginTop: 10 }}>Change to accept</button>
                  )}
                </div>
              )}
              {!mine && (
                <div style={{ ...S.card, marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,.6)' }}>
                  You’re not an included participant in this bet.
                </div>
              )}
              {error && <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fb7185', marginTop: 8 }}>{error}</div>}

              {/* everyone's status */}
              <div style={S.sectionLabel}>PLAYERS</div>
              {acceptances.map((a) => {
                const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.pending
                const name = names[a.user_id] ?? 'Player'
                return (
                  <div key={a.id} style={S.row}>
                    <span style={{ ...S.avatar, background: a.user_id === myUid ? ACCENT : '#2dd4bf', color: a.user_id === myUid ? ACCENT_DARK : '#fff' }}>{initial(name)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}{a.user_id === myUid ? ' (you)' : ''}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: st.color, background: st.bg, padding: '4px 10px', borderRadius: 9999 }}>{st.label}</span>
                  </div>
                )
              })}

              <button type="button" onClick={() => navigate('/scoring')} style={S.scoringBtn}>Go to scoring →</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const S = {
  root: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff', background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)' },
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: 'center' },
  scrim: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(6,14,9,.74) 0%, rgba(6,14,9,.6) 26%, rgba(6,16,10,.66) 58%, rgba(4,12,8,.9) 100%)' },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  scroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 16px 24px' },
  banner: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid', borderRadius: 18, padding: '14px 16px', marginBottom: 6 },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', margin: '18px 2px 9px' },
  card: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 16, padding: '10px 15px' },
  row: { display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '10px 13px', marginBottom: 8 },
  avatar: { flex: '0 0 auto', width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 },
  acceptBtn: { flex: 1, minHeight: 50, borderRadius: 15, border: 'none', background: ACCENT, color: ACCENT_DARK, fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  declineBtn: { flex: '0 0 auto', minHeight: 50, padding: '0 18px', borderRadius: 15, border: '1px solid rgba(251,113,133,.5)', background: 'rgba(251,113,133,.12)', color: '#fb7185', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  scoringBtn: { width: '100%', minHeight: 50, borderRadius: 15, marginTop: 18, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  empty: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 18, textAlign: 'center', marginTop: 10 },
}
