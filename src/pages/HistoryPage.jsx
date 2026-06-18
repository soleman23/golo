import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import { GoloWordmark, GoloBall } from '../components/shared/Logo'
import {
  playerKey, displayName, autoKey, namesByKey, myNetInRoundByKey, entryMatches,
} from '../lib/identity'

/**
 * HistoryPage — saved rounds, "glass-over-turf" (the Rounds tab).
 *
 * No design mock exists for History, so this derives from the established glass
 * vocabulary (HomePage's Recent Rounds): a course-photo backdrop, frosted round
 * rows showing your net + finish from history, and the shared bottom tab bar.
 * Inline styles match the prototype, same approach as HomePage / ScoringPage.
 *
 * Player ids regenerate per round, so "you" is resolved by identity key
 * (email/phone, else name — see lib/identity): the profile's own identity, else
 * the most-frequent player in history. Per-round net sums that identity's bet
 * payouts.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'
const BACKDROP = '/courses/sunset.png'

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

const signed = (n) => (n > 0 ? `+$${n}` : n < 0 ? `−$${-n}` : '$0')
const mcol = (n) => (n > 0 ? '#bef264' : n < 0 ? '#fb7185' : 'rgba(255,255,255,.7)')
const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
const round2 = (n) => +n.toFixed(2)

/** Total action (sum of settlement transfers) in a saved round. */
const totalAction = (r) => round2((r.settlements ?? []).reduce((sum, s) => sum + s.amount, 0))

/** Rank-1 finisher name(s) from a saved leaderboard snapshot. */
function winnerName(r) {
  const winners = (r.leaderboard ?? []).filter((e) => e.rank === 1)
  return winners.length ? winners.map((w) => w.name).join(' & ') : '—'
}

/* --------------------------------------------------------------- component */

export default function HistoryPage() {
  const navigate = useNavigate()
  const rounds = useHistoryStore((s) => s.rounds)
  const clearHistory = useHistoryStore((s) => s.clearHistory)
  const profileName = useProfileStore((s) => s.name)
  const profileNick = useProfileStore((s) => s.nickname)
  const profileEmail = useProfileStore((s) => s.email)
  const profilePhone = useProfileStore((s) => s.phone)

  // "You" = the profile's identity (email/phone/name), else the most-frequent
  // player across history. Matching is by identity key.
  const profile = { name: profileName, nickname: profileNick, email: profileEmail, phone: profilePhone }
  const meKey = useMemo(
    () => playerKey(profile) ?? autoKey(rounds),
    [profileName, profileNick, profileEmail, profilePhone, rounds] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const nameByKey = useMemo(() => namesByKey(rounds), [rounds])
  const meName = displayName(profile) || (meKey ? nameByKey[meKey] : null) || null

  // Per-round display model (history store is already newest-first).
  const items = useMemo(
    () =>
      rounds.map((r) => {
        const me = meKey ? r.leaderboard?.find((e) => entryMatches(e, meKey, meName)) : null
        return {
          roundId: r.roundId,
          course: r.course || 'Round',
          date: r.date,
          bg: COURSE_BG[r.course] ?? '/courses/course.png',
          games: (r.betResults ?? []).map((b) => b.name).join(' · ') || 'No games',
          net: myNetInRoundByKey(r, meKey),
          place: me ? `${ord(me.rank)} of ${r.leaderboard.length}` : `🏆 ${winnerName(r)}`,
          action: totalAction(r),
        }
      }),
    [rounds, meKey, meName]
  )

  const handleClear = () => {
    if (rounds.length === 0) return
    if (window.confirm('Clear all saved rounds? This cannot be undone.')) clearHistory()
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: `url('${BACKDROP}')` }} />
      <div style={S.scrim} />

      <div style={S.column}>
        {/* header --------------------------------------------------------- */}
        <div style={S.header}>
          <GoloWordmark variant="white" fontPx={16} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT }}>YOUR ROUNDS</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, letterSpacing: -0.5 }}>History</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
                {rounds.length} saved {rounds.length === 1 ? 'round' : 'rounds'}
              </div>
            </div>
            {rounds.length > 0 && (
              <button onClick={handleClear} style={S.clearBtn}>Clear all</button>
            )}
          </div>
        </div>

        {/* scroll body ---------------------------------------------------- */}
        <div style={S.scroll}>
          {items.length === 0 ? (
            <div style={S.emptyCard}>
              <GoloBall size={40} fill="#ffffff" dimple="rgba(20,40,24,.3)" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>No saved rounds yet</div>
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.55)', marginTop: 6, lineHeight: 1.5 }}>
                Finish a round and it lands here automatically — with the leaderboard, every game, and who paid whom.
              </div>
              <button onClick={() => navigate('/setup')} style={S.emptyCta}>Start a round →</button>
            </div>
          ) : (
            <>
              <div style={S.sectionRow}>
                <span style={S.sectionLabel}>ALL ROUNDS</span>
                <span style={S.sectionSub}>newest first</span>
              </div>
              {items.map((g) => (
                <button key={g.roundId} onClick={() => navigate(`/history/${g.roundId}`)} style={S.roundRow}>
                  <span style={{ ...S.roundThumb, backgroundImage: `url('${g.bg}')` }} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.course}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', flex: '0 0 auto' }}>{g.date}</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', flex: '0 0 auto' }}>·</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.games}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: mcol(g.net) }}>{signed(g.net)}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.45)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.place}</div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        {/* bottom tab bar ------------------------------------------------- */}
        <div style={S.tabWrap}>
          <div style={S.tabBar}>
            <Tab icon="⛳" label="Home" onClick={() => navigate('/')} />
            <Tab icon="📋" label="Rounds" active />
            <Tab icon="＋" label="Play" onClick={() => navigate('/setup')} />
            <Tab icon="👤" label="You" onClick={() => navigate('/you')} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- sub-components */

function Tab({ icon, label, active, onClick }) {
  const color = active ? ACCENT : 'rgba(255,255,255,.55)'
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        minHeight: 48, justifyContent: 'center', borderRadius: 14, border: 'none',
        cursor: 'pointer', background: active ? hexA(ACCENT, 0.16) : 'transparent',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, color }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color }}>{label}</span>
    </button>
  )
}

/* ------------------------------------------------------------- shared styles */

const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff',
    background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
  },
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: '50% 55%' },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.7) 0%, rgba(6,14,9,.52) 22%, rgba(6,16,10,.62) 56%, rgba(4,12,8,.92) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  header: { flex: '0 0 auto', padding: 'max(10px, env(safe-area-inset-top)) 18px 10px', textShadow: '0 2px 12px rgba(0,0,0,.4)' },
  clearBtn: { flex: '0 0 auto', minHeight: 40, padding: '0 14px', borderRadius: 12, background: 'rgba(251,113,133,.12)', border: '1px solid rgba(251,113,133,.32)', color: '#fb7185', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  scroll: { flex: 1, overflowY: 'auto', padding: '6px 16px 14px' },

  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 2px 9px' },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },
  sectionSub: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.42)' },

  roundRow: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: '1px solid rgba(255,255,255,.12)', cursor: 'pointer', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, padding: '11px 12px', marginBottom: 9 },
  roundThumb: { width: 46, height: 46, borderRadius: 12, flex: '0 0 auto', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' },

  emptyCard: { textAlign: 'center', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 24, padding: '34px 22px', marginTop: 24, boxShadow: '0 12px 32px rgba(0,0,0,.32)' },
  emptyCta: { marginTop: 18, minHeight: 50, padding: '0 22px', borderRadius: 15, background: ACCENT, color: ACCENT_DARK, border: 'none', fontSize: 15, fontWeight: 800, cursor: 'pointer', boxShadow: `0 8px 22px ${hexA(ACCENT, 0.4)}` },

  tabWrap: { flex: '0 0 auto', padding: '8px 14px max(16px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, rgba(4,12,8,0) 0%, rgba(4,12,8,.55) 60%)' },
  tabBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16,22,18,.7)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: 8 },
}
