import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import useHistoryStore from '../store/historyStore'
import BackButton from '../components/shared/BackButton'

/**
 * HistoryDetailPage — one saved round, "glass-over-turf".
 *
 * The read-only counterpart to PayoutsPage: renders the stored snapshot
 * (leaderboard, every game, who paid whom, share text) in the same glass
 * vocabulary — frosted leaderboard rows, expandable game cards, transfer rows.
 * Everything is read from the saved entry; no engines run here.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'

const COURSE_BG = {
  'Pinehurst No.2': '/courses/course.png',
  'Harbor Dunes': '/courses/sunset.png',
  'Lincoln Park': '/courses/turf.png',
  'Tetherow': '/courses/tetherow.jpg',
  'Lost Tracks Golf Course': '/courses/losttracks.webp',
}

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

const initial = (name) => (name || '').trim().charAt(0).toUpperCase() || '?'
const round2 = (n) => Math.round(n * 100) / 100 // cents — matches the live Payout page & History list
const money = (n) => `$${Math.abs(round2(n))}`
const signed = (n) => {
  const v = round2(n)
  if (v > 0) return `+$${v}`
  if (v < 0) return `−$${-v}`
  return '$0'
}
const ncd = (n) => (n > 0 ? '#bef264' : n < 0 ? '#fb7185' : 'rgba(255,255,255,.72)')
const vpl = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`)

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/* --------------------------------------------------------------- component */

export default function HistoryDetailPage() {
  const { roundId } = useParams()
  const navigate = useNavigate()
  const round = useHistoryStore((s) => s.rounds.find((r) => r.roundId === roundId))
  const removeRound = useHistoryStore((s) => s.removeRound)

  const [expanded, setExpanded] = useState({})
  const [toast, setToast] = useState(false)

  // Round was deleted or the id is bad — back to the list.
  if (!round) return <Navigate to="/history" replace />

  const players = round.players ?? []
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]))
  const colorOf = (id) => playerById[id]?.color // saved snapshots store only {id,name}; may be undefined
  const nameOf = (id) => playerById[id]?.name ?? '—'

  const leaderboard = round.leaderboard ?? []
  const betResults = round.betResults ?? []
  const settlements = round.settlements ?? []
  const totalAction = round2(settlements.reduce((sum, s) => sum + s.amount, 0))
  const winners = leaderboard.filter((e) => e.rank === 1)
  const backdrop = COURSE_BG[round.course] ?? '/courses/course.png'

  const toggleGame = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }))

  const doShare = async () => {
    if (!round.summaryText) return
    await copyText(round.summaryText)
    setToast(true)
    setTimeout(() => setToast(false), 1800)
  }

  const handleDelete = () => {
    if (window.confirm('Delete this round from history?')) {
      removeRound(round.roundId)
      navigate('/history', { replace: true })
    }
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: `url('${backdrop}')` }} />
      <div style={S.scrim} />

      <div style={S.column}>
        {/* header --------------------------------------------------------- */}
        <div style={S.header}>
          <div style={{ marginBottom: 12 }}>
            <BackButton />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT }}>FINAL</span>
            <div style={S.coursePill}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: ACCENT }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {round.course || 'Round'}
              </span>
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8, letterSpacing: -0.5 }}>{round.course || 'Round'}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
            {round.date} · {round.holes ?? 18} holes
          </div>
        </div>

        {/* scroll body ---------------------------------------------------- */}
        <div style={S.scroll}>
          {/* LEADERBOARD */}
          <div style={S.sectionLabel}>FINAL LEADERBOARD</div>
          {winners.length > 0 && (
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: '4px 2px 10px' }}>
              🏆 {winners.map((w) => w.name).join(' & ')}
            </div>
          )}
          {leaderboard.map((e) => (
            <div
              key={e.name}
              style={{ ...S.lbRow, border: `1px solid ${e.rank === 1 ? hexA(ACCENT, 0.5) : 'rgba(255,255,255,.12)'}` }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,.5)', width: 16, flex: '0 0 auto', textAlign: 'center' }}>{e.rank}</span>
              <span style={{ ...S.avatar, width: 34, height: 34, fontSize: 14, background: '#2dd4bf' }}>{initial(e.name)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: '0 0 auto' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', width: 40, textAlign: 'right' }}>{e.gross || '–'}</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', width: 30, textAlign: 'right' }}>{e.net || '–'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.6)', width: 34, textAlign: 'right' }}>{vpl(e.toPar ?? 0)}</span>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '2px 4px 0', fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: 'rgba(255,255,255,.35)' }}>
            <span style={{ width: 40, textAlign: 'right' }}>GROSS</span>
            <span style={{ width: 30, textAlign: 'right' }}>NET</span>
            <span style={{ width: 34, textAlign: 'right' }}>PAR</span>
          </div>

          {/* GAMES */}
          <div style={{ ...S.sectionLabel, margin: '20px 2px 9px' }}>THE GAMES</div>
          {betResults.length === 0 ? (
            <div style={S.emptyCard}>No games on this round.</div>
          ) : (
            betResults.map((b, i) => {
              const open = !!expanded[i]
              const pot = round2(Object.values(b.payouts ?? {}).reduce((s, v) => (v > 0 ? s + v : s), 0))
              const chips = Object.entries(b.payouts ?? {})
                .map(([id, v]) => ({ id, v, color: colorOf(id), name: nameOf(id) }))
                .sort((a, c) => c.v - a.v)
              const lines = b.lines ?? []
              return (
                <div key={i} style={S.gameCard}>
                  <button onClick={() => toggleGame(i)} style={S.gameHead}>
                    <span style={S.gameIcon}>{b.icon ?? '🎲'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#fff' }}>{b.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.headline}</div>
                    </div>
                    {pot > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT, flex: '0 0 auto' }}>${pot} pot</span>}
                    {lines.length > 0 && <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', flex: '0 0 auto', width: 14, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>}
                  </button>

                  {chips.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
                      {chips.map((c) => (
                        <span key={c.id} style={S.netChip}>
                          <span style={{ ...S.avatar, width: 22, height: 22, fontSize: 10, boxShadow: 'none', background: c.color ?? '#2dd4bf' }}>{initial(c.name)}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: ncd(c.v) }}>{signed(c.v)}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {open && lines.length > 0 && (
                    <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,.1)' }}>
                      {lines.map((line, j) => (
                        <div key={j} style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.62)', padding: '6px 0', lineHeight: 1.35 }}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* SETTLE UP */}
          <div style={S.sectionRow}>
            <span style={S.sectionLabel}>WHO PAID WHOM</span>
            {settlements.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)' }}>${totalAction} action</span>}
          </div>
          {settlements.length === 0 ? (
            <div style={S.emptyCard}>All square — nobody owed anybody.</div>
          ) : (
            settlements.map((s, i) => (
              <div key={`${s.from}-${s.to}-${i}`} style={S.transferRow}>
                <span style={{ ...S.avatar, width: 32, height: 32, fontSize: 13, boxShadow: 'none', background: colorOf(s.from) ?? '#2dd4bf' }}>{initial(nameOf(s.from))}</span>
                <span style={{ fontSize: 18, color: 'rgba(255,255,255,.45)', flex: '0 0 auto' }}>→</span>
                <span style={{ ...S.avatar, width: 32, height: 32, fontSize: 13, boxShadow: 'none', background: colorOf(s.to) ?? '#2dd4bf' }}>{initial(nameOf(s.to))}</span>
                <div style={{ flex: 1, minWidth: 0, marginLeft: 2 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(s.from)} pays {nameOf(s.to)}</div>
                </div>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', flex: '0 0 auto' }}>{money(s.amount)}</span>
              </div>
            ))
          )}

          {/* MANAGE */}
          <button onClick={handleDelete} style={S.deleteBtn}>Delete this round</button>
        </div>

        {/* footer --------------------------------------------------------- */}
        {round.summaryText && (
          <div style={S.footer}>
            <button onClick={doShare} style={S.shareBtn}>↗ Share summary</button>
          </div>
        )}
      </div>

      {/* SHARE TOAST */}
      {toast && (
        <div style={S.toastWrap}>
          <div style={S.toast}>Summary copied — paste it in the group chat</div>
        </div>
      )}
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
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: '50% 60%' },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.74) 0%, rgba(6,14,9,.6) 26%, rgba(6,16,10,.66) 58%, rgba(4,12,8,.9) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  header: { flex: '0 0 auto', padding: 'max(10px, env(safe-area-inset-top)) 18px 12px', textShadow: '0 2px 12px rgba(0,0,0,.4)' },
  coursePill: { display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.16)', padding: '6px 12px', borderRadius: 9999, maxWidth: 210, minWidth: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '4px 16px 14px' },

  avatar: { borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', boxShadow: '0 0 0 2px rgba(255,255,255,.25)' },

  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '20px 2px 9px' },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },

  lbRow: { display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 14, padding: '9px 12px', marginBottom: 8 },

  gameCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 18, padding: '13px 14px', marginBottom: 11, boxShadow: '0 8px 22px rgba(0,0,0,.26)' },
  gameHead: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' },
  gameIcon: { width: 40, height: 40, borderRadius: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' },
  netChip: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 5px', borderRadius: 9999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' },

  transferRow: { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: '11px 13px', marginBottom: 9 },
  emptyCard: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 15, lineHeight: 1.5 },

  deleteBtn: { width: '100%', minHeight: 50, marginTop: 22, borderRadius: 15, background: 'rgba(251,113,133,.1)', border: '1px solid rgba(251,113,133,.3)', color: '#fb7185', fontSize: 14, fontWeight: 800, cursor: 'pointer' },

  footer: { flex: '0 0 auto', padding: '10px 16px max(18px, env(safe-area-inset-bottom))' },
  shareBtn: { width: '100%', minHeight: 54, borderRadius: 16, background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 96, display: 'flex', justifyContent: 'center', zIndex: 50, pointerEvents: 'none' },
  toast: { background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 14, padding: '12px 18px', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 12px 30px rgba(0,0,0,.5)' },
}
