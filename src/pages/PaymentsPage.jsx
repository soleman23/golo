import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import { hexA } from '../lib/colors'
import AppHeader from '../components/shared/AppHeader'
import { fetchProfileNames } from '../lib/db/betting'
import {
  fetchPaymentRequests,
  markPaymentSent,
  confirmPaymentReceived,
  disputePayment,
  subscribeToPaymentRequests,
} from '../lib/db/payments'

/**
 * PaymentsPage — the durable, server-backed settlement screen (Phase 5), reached
 * post-round from a payment notification. Two-step, role-enforced: the payer
 * marks a request sent, the recipient confirms receipt; either can dispute.
 * Amounts live here (inside the authenticated app), never in push text.
 */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

const STATUS = {
  pending: { label: 'Requested', color: 'rgba(255,255,255,.72)', bg: 'rgba(255,255,255,.08)' },
  viewed: { label: 'Viewed', color: 'rgba(255,255,255,.72)', bg: 'rgba(255,255,255,.08)' },
  marked_sent: { label: 'Marked sent', color: ACCENT, bg: hexA(ACCENT, 0.14) },
  confirmed: { label: 'Confirmed', color: '#bef264', bg: 'rgba(190,242,100,.14)' },
  disputed: { label: 'Disputed', color: '#fb7185', bg: 'rgba(251,113,133,.14)' },
  cancelled: { label: 'Cancelled', color: 'rgba(255,255,255,.4)', bg: 'rgba(255,255,255,.05)' },
}

const money = (n) => `$${Math.abs(Math.round((Number(n) || 0) * 100) / 100)}`
const initial = (name) => (name || '').trim().charAt(0).toUpperCase() || '?'

export default function PaymentsPage() {
  const { roundId } = useParams()
  const myUid = useAuthStore((s) => s.user?.id ?? null)

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const data = await fetchPaymentRequests(roundId)
    setRows(data)
    const ids = [...new Set(data.flatMap((r) => [r.payer_user_id, r.recipient_user_id]))]
    setNames(await fetchProfileNames(ids))
    setLoading(false)
  }, [roundId])

  useEffect(() => { load() }, [load])
  useEffect(
    () => subscribeToPaymentRequests(roundId, () => fetchPaymentRequests(roundId).then(setRows)),
    [roundId],
  )

  const act = async (fn, id) => {
    setBusyId(id)
    setError(null)
    const { error: err } = await fn(id)
    if (err) setError(typeof err === 'string' ? err : err.message ?? 'Something went wrong.')
    else await load()
    setBusyId(null)
  }

  const iPay = useMemo(() => rows.filter((r) => r.payer_user_id === myUid), [rows, myUid])
  const iCollect = useMemo(() => rows.filter((r) => r.recipient_user_id === myUid), [rows, myUid])
  const others = useMemo(
    () => rows.filter((r) => r.payer_user_id !== myUid && r.recipient_user_id !== myUid),
    [rows, myUid],
  )

  const nameOf = (uid) => names[uid] ?? 'Player'
  const statusPill = (s) => {
    const st = STATUS[s] ?? STATUS.pending
    return <span style={{ fontSize: 11.5, fontWeight: 800, color: st.color, background: st.bg, padding: '4px 10px', borderRadius: 9999, flex: '0 0 auto' }}>{st.label}</span>
  }

  const row = (r, mode) => {
    const otherUid = mode === 'pay' ? r.recipient_user_id : r.payer_user_id
    const name = nameOf(otherUid)
    const busy = busyId === r.id
    const canSend = mode === 'pay' && (r.status === 'pending' || r.status === 'viewed')
    const canConfirm = mode === 'collect' && ['pending', 'viewed', 'marked_sent'].includes(r.status)
    const canDispute = ['pending', 'viewed', 'marked_sent'].includes(r.status)
    return (
      <div key={r.id} style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ ...S.avatar, background: '#2dd4bf' }}>{initial(name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mode === 'pay' ? `Pay ${name}` : mode === 'collect' ? `${name} owes you` : `${nameOf(r.payer_user_id)} → ${nameOf(r.recipient_user_id)}`}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: mode === 'collect' ? '#bef264' : '#fff', marginTop: 1 }}>{money(r.amount)}</div>
          </div>
          {statusPill(r.status)}
        </div>
        {(canSend || canConfirm || canDispute) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {canSend && <button type="button" disabled={busy} onClick={() => act(markPaymentSent, r.id)} style={S.primary}>{busy ? '…' : 'Mark as sent'}</button>}
            {canConfirm && <button type="button" disabled={busy} onClick={() => act(confirmPaymentReceived, r.id)} style={S.primary}>{busy ? '…' : 'Confirm received'}</button>}
            {canDispute && <button type="button" disabled={busy} onClick={() => act(disputePayment, r.id)} style={S.dispute}>Dispute</button>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: 'url(/courses/turf.png), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)' }} />
      <div style={S.scrim} />
      <div style={S.column}>
        <AppHeader accent={ACCENT} backTo="/" logo="wordmark" rightAction="pin" kicker="SETTLE UP" title="Payments" />
        <div className="golo-scroll" style={S.scroll}>
          {loading ? (
            <div style={S.empty}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={S.empty}>No payment requests for this round.</div>
          ) : (
            <>
              {iPay.length > 0 && <div style={S.label}>YOU OWE</div>}
              {iPay.map((r) => row(r, 'pay'))}
              {iCollect.length > 0 && <div style={S.label}>OWED TO YOU</div>}
              {iCollect.map((r) => row(r, 'collect'))}
              {others.length > 0 && <div style={S.label}>ALL SETTLEMENTS</div>}
              {others.map((r) => row(r, 'other'))}
            </>
          )}
          {error && <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fb7185', marginTop: 10 }}>{error}</div>}
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.4)', margin: '16px 2px 0', lineHeight: 1.45 }}>
            Send money the way you normally do — GoLo just tracks who’s marked a payment sent and who’s confirmed it.
          </div>
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
  label: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', margin: '18px 2px 9px' },
  card: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 16, padding: '13px 15px', marginBottom: 10 },
  avatar: { flex: '0 0 auto', width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, color: '#fff' },
  primary: { flex: 1, minHeight: 46, borderRadius: 13, border: 'none', background: ACCENT, color: ACCENT_DARK, fontSize: 14, fontWeight: 800, cursor: 'pointer' },
  dispute: { flex: '0 0 auto', minHeight: 46, padding: '0 16px', borderRadius: 13, border: '1px solid rgba(251,113,133,.5)', background: 'rgba(251,113,133,.12)', color: '#fb7185', fontSize: 14, fontWeight: 800, cursor: 'pointer' },
  empty: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 18, textAlign: 'center', marginTop: 10 },
}
