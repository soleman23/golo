import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import useHistoryStore from '../store/historyStore'
import { getCourseImage } from '../lib/courseImages'
import { betGlyphName } from '../engines/betResults'
import { Icon } from '../components/shared/GoloIcons'
import AppHeader from '../components/shared/AppHeader'

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

const COURSE_FALLBACK_BG = 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)'

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
const asArray = (value) => (Array.isArray(value) ? value : [])
const layeredCourseBg = (bg) => `url(${bg}), ${COURSE_FALLBACK_BG}`
const round2 = (n) => {
  const value = Number(n)
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}
const money = (n) => `$${Math.abs(round2(n))}`
const signed = (n) => {
  const v = round2(n)
  if (v > 0) return `+$${v}`
  if (v < 0) return `−$${Math.abs(v)}`
  return '$0'
}
const ncd = (n) => {
  const value = round2(n)
  return value > 0 ? '#bef264' : value < 0 ? '#fb7185' : 'rgba(255,255,255,.72)'
}
const vpl = (n) => {
  const value = round2(n)
  return value === 0 ? 'E' : value > 0 ? `+${value}` : `${value}`
}
const safeRecord = (value) => (value && typeof value === 'object' ? value : {})
const roundDateLabel = (r) => {
  const raw = r?.date ?? r?.completedAt
  if (!raw) return 'Date unknown'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return String(raw)
  return r?.date || date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  if (typeof document === 'undefined') return false
  let ta
  try {
    ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    if (ta?.parentNode) {
      ta.parentNode.removeChild(ta)
    }
  }
}

/* --------------------------------------------------------------- component */

export default function HistoryDetailPage() {
  const { roundId } = useParams()
  const navigate = useNavigate()
  const round = useHistoryStore((s) => asArray(s.rounds).find((r) => r?.roundId === roundId))
  const removeRound = useHistoryStore((s) => s.removeRound)

  const [expanded, setExpanded] = useState({})
  const [toast, setToast] = useState('')

  // Round was deleted or the id is bad — back to the list.
  if (!round) return <Navigate to="/history" replace />

  const players = asArray(round.players)
  const playerById = Object.fromEntries(players.filter((p) => p?.id != null).map((p) => [p.id, p]))
  const colorOf = (id) => playerById[id]?.color // saved snapshots store only {id,name}; may be undefined
  const nameOf = (id) => playerById[id]?.name ?? '—'

  const leaderboard = asArray(round.leaderboard)
  const betResults = asArray(round.betResults)
  const settlements = asArray(round.settlements)
  const totalAction = round2(settlements.reduce((sum, s) => {
    const amount = Number(s?.amount)
    return Number.isFinite(amount) ? sum + amount : sum
  }, 0))
  const winners = leaderboard.filter((e) => Number(e?.rank) === 1)
  const winnerNames = winners.map((w) => w?.name).filter(Boolean)
  const backdrop = getCourseImage(round)
  const summaryText = typeof round.summaryText === 'string' ? round.summaryText : ''
  const courseLabel = round.course || 'Saved round'
  const dateLabel = roundDateLabel(round)

  const toggleGame = (i) => setExpanded((e) => ({ ...e, [i]: !e[i] }))

  const doShare = async () => {
    if (!summaryText) {
      setToast('Couldn’t copy summary.')
      setTimeout(() => setToast(''), 1800)
      return
    }
    const copied = await copyText(summaryText)
    setToast(copied ? 'Summary copied — paste it in the group chat' : 'Couldn’t copy summary.')
    setTimeout(() => setToast(''), 1800)
  }

  const handleDelete = () => {
    if (window.confirm('Delete this round from history?')) {
      removeRound(round.roundId)
      navigate('/history', { replace: true })
    }
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: layeredCourseBg(backdrop), backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={S.scrim} />

      <div style={S.column}>
        <AppHeader
          accent={ACCENT}
          backTo="/history"
          logo="wordmark"
          rightAction="pin"
          kicker="FINAL"
          title={courseLabel}
          contextPill={`${dateLabel} · ${round.holes ?? 18} holes`}
        />

        {/* scroll body ---------------------------------------------------- */}
        <div className="golo-scroll" style={S.scroll}>
          {/* LEADERBOARD */}
          <div style={S.sectionLabel}>FINAL LEADERBOARD</div>
          {winnerNames.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 800, color: '#fff', margin: '4px 2px 10px' }}>
              <Icon name="leader" size={16} color={ACCENT} /> {winnerNames.join(' & ')}
            </div>
          )}
          {leaderboard.length === 0 ? (
            <div style={S.emptyCard}>No saved leaderboard.</div>
          ) : (
            <>
              {leaderboard.map((e, i) => (
                <div
                  key={`${e?.name ?? 'player'}-${e?.rank ?? i}`}
                  style={{ ...S.lbRow, border: `1px solid ${Number(e?.rank) === 1 ? hexA(ACCENT, 0.5) : 'rgba(255,255,255,.12)'}` }}
                >
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,.5)', width: 16, flex: '0 0 auto', textAlign: 'center' }}>{e?.rank ?? '–'}</span>
                  <span style={{ ...S.avatar, width: 34, height: 34, fontSize: 14, background: '#2dd4bf' }}>{initial(e?.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e?.name || 'Player'}</span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: '0 0 auto' }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', width: 40, textAlign: 'right' }}>{e?.gross ?? '–'}</span>
                    <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', width: 30, textAlign: 'right' }}>{e?.net ?? '–'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.6)', width: 34, textAlign: 'right' }}>{vpl(e?.toPar ?? 0)}</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '2px 4px 0', fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: 'rgba(255,255,255,.35)' }}>
                <span style={{ width: 40, textAlign: 'right' }}>GROSS</span>
                <span style={{ width: 30, textAlign: 'right' }}>NET</span>
                <span style={{ width: 34, textAlign: 'right' }}>PAR</span>
              </div>
            </>
          )}

          {/* GAMES */}
          <div style={{ ...S.sectionLabel, margin: '20px 2px 9px' }}>THE GAMES</div>
          {betResults.length === 0 ? (
            <div style={S.emptyCard}>No saved game breakdown.</div>
          ) : (
            betResults.map((b, i) => {
              const open = !!expanded[i]
              const payouts = safeRecord(b?.payouts)
              const pot = round2(Object.values(payouts).reduce((s, v) => {
                const value = Number(v)
                return value > 0 ? s + value : s
              }, 0))
              const chips = Object.entries(payouts)
                .map(([id, v]) => ({ id, v: round2(v), color: colorOf(id), name: nameOf(id) }))
                .sort((a, c) => c.v - a.v)
              const lines = asArray(b?.lines).filter((line) => line != null)
              const glyph = betGlyphName(b?.type)
              return (
                <div key={i} style={S.gameCard}>
                  <button onClick={() => toggleGame(i)} aria-expanded={!!open} style={S.gameHead}>
                    <span style={S.gameIcon}>{glyph ? <Icon name={glyph} size={20} color={ACCENT} /> : (b?.icon ?? '🎲')}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#fff' }}>{b?.name || 'Saved game'}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b?.headline || 'Saved game result'}</div>
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
            <div style={S.emptyCard}>No payouts recorded.</div>
          ) : (
            settlements.map((s, i) => (
              <div key={`${s?.from}-${s?.to}-${i}`} style={S.transferRow}>
                <span style={{ ...S.avatar, width: 32, height: 32, fontSize: 13, boxShadow: 'none', background: colorOf(s?.from) ?? '#2dd4bf' }}>{initial(nameOf(s?.from))}</span>
                <span style={{ fontSize: 18, color: 'rgba(255,255,255,.45)', flex: '0 0 auto' }}>→</span>
                <span style={{ ...S.avatar, width: 32, height: 32, fontSize: 13, boxShadow: 'none', background: colorOf(s?.to) ?? '#2dd4bf' }}>{initial(nameOf(s?.to))}</span>
                <div style={{ flex: 1, minWidth: 0, marginLeft: 2 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(s?.from)} pays {nameOf(s?.to)}</div>
                </div>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', flex: '0 0 auto' }}>{money(s?.amount)}</span>
              </div>
            ))
          )}

          {/* MANAGE */}
          <button onClick={handleDelete} style={S.deleteBtn}>Delete this round</button>
        </div>

        {/* footer --------------------------------------------------------- */}
        {summaryText && (
          <div style={S.footer}>
            <button onClick={doShare} style={S.shareBtn}>↗ Share summary</button>
          </div>
        )}
      </div>

      {/* SHARE TOAST */}
      {toast && (
        <div style={S.toastWrap}>
          <div style={S.toast}>{toast}</div>
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
  scroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 16px 14px' },

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
