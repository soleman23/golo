import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import useRoundStore from '../store/roundStore'
import { hexA } from '../lib/colors'
import AppHeader from '../components/shared/AppHeader'
import {
  fetchCurrentTerms,
  fetchAcceptances,
  fetchProfileNames,
  respondBettingTerms,
  finalizeBettingTerms,
  buildTermsSnapshot,
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
  // "Declined" is surfaced as "Sent back" — the send-back-for-review path stores
  // the same status plus a comment (0033).
  declined: { label: 'Sent back', color: '#fb7185', bg: 'rgba(251,113,133,.14)' },
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
  const [reviewOpen, setReviewOpen] = useState(false) // send-back sheet
  const [comment, setComment] = useState('')

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
  const amCreator = !!terms && terms.created_by === myUid

  const respond = async (accept, note = null) => {
    if (!terms?.id || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await respondBettingTerms(terms.id, accept, note)
    if (err) {
      setError(typeof err === 'string' ? err : err.message ?? 'Could not save your response.')
    } else {
      setReviewOpen(false)
      setComment('')
      await load()
    }
    setBusy(false)
  }

  // Organizer re-locks after editing the bets: snapshots the current round state
  // as a new version, superseding the old and re-pending everyone (guide: any
  // material term change requires acceptance again).
  const reLock = async () => {
    if (!roundId || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await finalizeBettingTerms(roundId, buildTermsSnapshot(useRoundStore.getState()), null)
    if (err) setError(typeof err === 'string' ? err : err.message ?? 'Could not re-lock terms.')
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

              {amCreator && (
                <>
                  <button type="button" onClick={reLock} disabled={busy} style={S.relockBtn}>
                    {busy ? 'Re-locking…' : 'Re-lock terms · new version'}
                  </button>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.42)', margin: '4px 2px 12px', lineHeight: 1.4 }}>
                    Edited the bets? Re-lock to snapshot the new terms — everyone re-accepts.
                  </div>
                </>
              )}

              {/* my response */}
              {mine && mine.status === 'pending' && (
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button type="button" onClick={() => setReviewOpen(true)} disabled={busy} style={S.declineBtn}>Review</button>
                  <button type="button" onClick={() => respond(true)} disabled={busy} style={S.acceptBtn}>{busy ? '…' : 'Accept terms'}</button>
                </div>
              )}
              {mine && mine.status !== 'pending' && (
                <div style={{ ...S.card, marginTop: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'rgba(255,255,255,.7)' }}>
                    You {mine.status === 'accepted' ? 'accepted these terms.' : mine.status === 'declined' ? 'sent these terms back to the organizer.' : 'are no longer on the current terms.'}
                  </span>
                  {mine.status === 'declined' && (
                    <>
                      {mine.decline_comment && (
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 6, lineHeight: 1.4 }}>
                          “{mine.decline_comment}”
                        </div>
                      )}
                      <button type="button" onClick={() => respond(true)} disabled={busy} style={{ ...S.acceptBtn, marginTop: 10 }}>Change to accept</button>
                    </>
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
                  <div key={a.id} style={S.rowWrap}>
                    <div style={S.row}>
                      <span style={{ ...S.avatar, background: a.user_id === myUid ? ACCENT : '#2dd4bf', color: a.user_id === myUid ? ACCENT_DARK : '#fff' }}>{initial(name)}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}{a.user_id === myUid ? ' (you)' : ''}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: st.color, background: st.bg, padding: '4px 10px', borderRadius: 9999 }}>{st.label}</span>
                    </div>
                    {a.status === 'declined' && a.decline_comment && (
                      <div style={S.rowComment}>“{a.decline_comment}”</div>
                    )}
                  </div>
                )
              })}

              <button type="button" onClick={() => navigate('/scoring')} style={S.scoringBtn}>Go to scoring →</button>
            </>
          )}
        </div>
      </div>

      {/* send-back-for-review sheet */}
      {reviewOpen && (
        <div style={S.sheetWrap} role="dialog" aria-modal="true" aria-label="Send terms back for review">
          <div onClick={() => !busy && setReviewOpen(false)} style={S.sheetScrim} />
          <div style={S.sheet}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>Send back for review</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 6, lineHeight: 1.45 }}>
              The organizer gets a notification to double-check the terms and resubmit. Add a note if you want to say what to change.
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional — e.g. “$5 skins is too steep for me”"
              rows={3}
              maxLength={280}
              style={S.textarea}
            />
            <button type="button" onClick={() => respond(false, comment)} disabled={busy} style={{ ...S.acceptBtn, width: '100%', marginTop: 4 }}>
              {busy ? 'Sending…' : 'Send back to organizer'}
            </button>
            <button type="button" onClick={() => setReviewOpen(false)} disabled={busy} style={S.sheetCancel}>Cancel</button>
          </div>
        </div>
      )}
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
  rowWrap: { marginBottom: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '10px 13px' },
  rowComment: { fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.55)', lineHeight: 1.4, padding: '7px 13px 0 58px' },
  avatar: { flex: '0 0 auto', width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 },
  acceptBtn: { flex: 1, minHeight: 50, borderRadius: 15, border: 'none', background: ACCENT, color: ACCENT_DARK, fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  declineBtn: { flex: '0 0 auto', minHeight: 50, padding: '0 18px', borderRadius: 15, border: '1px solid rgba(251,113,133,.5)', background: 'rgba(251,113,133,.12)', color: '#fb7185', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  relockBtn: { width: '100%', minHeight: 46, borderRadius: 14, marginTop: 10, border: `1px solid ${hexA(ACCENT, 0.4)}`, background: hexA(ACCENT, 0.1), color: ACCENT, fontSize: 14, fontWeight: 800, cursor: 'pointer' },
  scoringBtn: { width: '100%', minHeight: 50, borderRadius: 15, marginTop: 18, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  empty: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 18, textAlign: 'center', marginTop: 10 },

  sheetWrap: { position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheetScrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' },
  sheet: { position: 'relative', width: '100%', maxWidth: 480, background: 'rgba(14,20,16,.94)', backdropFilter: 'blur(26px)', WebkitBackdropFilter: 'blur(26px)', borderTop: '1px solid rgba(255,255,255,.14)', borderRadius: '24px 24px 0 0', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))' },
  textarea: { width: '100%', boxSizing: 'border-box', margin: '14px 0 12px', minHeight: 84, borderRadius: 14, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', padding: '11px 13px', resize: 'vertical' },
  sheetCancel: { width: '100%', minHeight: 48, marginTop: 9, borderRadius: 14, border: 'none', background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
}
