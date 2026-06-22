import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import useAuthStore from '../store/authStore'
import useSyncStore from '../store/syncStore'
import { retrySyncOnLogin } from '../lib/sync'
import { getCourseImage } from '../lib/courseImages'
import { GoloWordmark, GoloBall } from '../components/shared/Logo'
import BackButton from '../components/shared/BackButton'
import {
  playerKey, displayName, autoKey, namesByKey, netByKey,
  myNetInRoundByKey, playedInByKey, entryMatches,
} from '../lib/identity'

/**
 * HomePage — the dashboard / front door, "glass-over-turf" (Golo Golf - Home).
 *
 * Greets you, gives one big way in (New round), lets you resume a running round,
 * then keeps the money honest: your net for the season / all-time, where you sit
 * in the crew, and recent rounds a tap from their settle-up. Inline styles match
 * the prototype, same approach as SetupWizard / ScoringPage.
 *
 * The MVP has no accounts, and player ids are regenerated per round, so the crew
 * ledger is aggregated by player NAME across saved history. "You" defaults to the
 * most-frequently-seen name (the design's own fallback); "this season" means the
 * current calendar year. Everything degrades to an empty state on a fresh install.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'
const BACKDROP = '/courses/sunset.png'

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
const round2 = (n) => {
  const value = Number(n)
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}
/** Signed money: +$5, −$5, $0. */
const signed = (n) => {
  const value = round2(n)
  if (value > 0) return `+$${value}`
  if (value < 0) return `−$${Math.abs(value)}`
  return '$0'
}
/** Money colour: green ahead, red down, neutral level. */
const mcol = (n) => {
  const value = round2(n)
  return value > 0 ? '#bef264' : value < 0 ? '#fb7185' : 'rgba(255,255,255,.7)'
}
const ord = (n) => {
  const value = Number(n)
  if (!Number.isFinite(value)) return '—'
  const whole = Math.trunc(value)
  const s = ['th', 'st', 'nd', 'rd']
  const v = whole % 100
  return `${whole}${s[(v - 20) % 10] || s[v] || s[0]}`
}
const asArray = (value) => (Array.isArray(value) ? value : [])
const layeredCourseBg = (bg) => `url(${bg}), ${COURSE_FALLBACK_BG}`
const roundDateLabel = (r) => {
  const raw = r?.date ?? r?.completedAt
  if (!raw) return 'Date unknown'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return String(raw)
  return r?.date || date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/* --------------------------------------------------------------- component */

export default function HomePage() {
  const navigate = useNavigate()
  const round = useRoundStore((s) => s.round)
  const livePlayers = useRoundStore((s) => s.players)
  const status = useRoundStore((s) => s.status)
  const resetRound = useRoundStore((s) => s.resetRound)
  const rounds = useHistoryStore((s) => s.rounds)
  const profileName = useProfileStore((s) => s.name)
  const profileNick = useProfileStore((s) => s.nickname)
  const profileEmail = useProfileStore((s) => s.email)
  const profilePhone = useProfileStore((s) => s.phone)
  const onboarded = useProfileStore((s) => s.onboarded)
  const authUserId = useAuthStore((s) => s.user?.id ?? null)
  const syncError = useSyncStore((s) => s.syncError)
  const syncing = useSyncStore((s) => s.syncing)

  const [view, setView] = useState('season') // 'season' | 'all'
  const safeLivePlayers = asArray(livePlayers)
  const savedRounds = asArray(rounds)

  // A round left running (not finished) is resumable.
  const resume =
    round && status === 'in_progress'
      ? {
          title: round.course || 'Current round',
          sub: `${safeLivePlayers.length || 0} players · ${round.holes || 18} holes`,
          bg: getCourseImage(round),
        }
      : null

  // "You" = the signed-in identity (email/phone, else name), else the most-
  // frequently-seen player across history. Matching is by identity key, so the
  // same person counts across rounds even if their per-round name differs.
  const profile = { name: profileName, nickname: profileNick, email: profileEmail, phone: profilePhone }
  const meKey = useMemo(
    () => playerKey(profile) ?? autoKey(savedRounds),
    [profileName, profileNick, profileEmail, profilePhone, savedRounds] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const nameByKey = useMemo(() => namesByKey(savedRounds), [savedRounds])
  const meName = displayName(profile) || (meKey ? nameByKey[meKey] : null) || null

  const startSetup = () => {
    if (round && status === 'complete') resetRound()
    navigate('/setup')
  }

  const model = useMemo(() => {
    const isSeason = view === 'season'
    const year = new Date().getFullYear()
    const scopeRounds = isSeason
      ? savedRounds.filter((r) => {
          const date = new Date(r?.completedAt ?? r?.date)
          return !Number.isNaN(date.getTime()) && date.getFullYear() === year
        })
      : savedRounds
    const scope = isSeason ? 'THIS SEASON' : 'ALL TIME'

    const nets = netByKey(scopeRounds)
    const labelFor = namesByKey(scopeRounds)

    // Crew standings (by identity, zero-sum), highest net first.
    const keys = new Set()
    scopeRounds.forEach((r) => asArray(r?.players).forEach((p) => {
      const k = playerKey(p)
      if (k) keys.add(k)
    }))
    const crew = [...keys]
      .map((k) => ({
        key: k,
        name: labelFor[k] ?? '—',
        net: nets[k] ?? 0,
        rounds: scopeRounds.filter((r) => playedInByKey(r, k)).length,
        me: k === meKey,
      }))
      .sort((a, b) => b.net - a.net)
    const meRank = crew.findIndex((c) => c.me) + 1

    // Personal ledger.
    const myRounds = meKey ? scopeRounds.filter((r) => playedInByKey(r, meKey)) : []
    const myNet = meKey ? nets[meKey] ?? 0 : 0
    const perRound = myRounds.map((r) => myNetInRoundByKey(r, meKey))
    const wins = perRound.filter((n) => n > 0).length
    const inBlack = perRound.filter((n) => n >= 0).length
    const best = perRound.length ? Math.max(...perRound) : 0
    const winRate = perRound.length ? Math.round((100 * wins) / perRound.length) : 0
    const stats = [
      { label: 'ROUNDS', value: String(myRounds.length), sub: `${wins} won` },
      { label: 'WIN RATE', value: `${winRate}%`, sub: 'net positive' },
      { label: 'BEST', value: signed(best), sub: 'single round' },
    ]

    // Recent rounds (scope, newest first — history store is already newest-first).
    const recent = scopeRounds.map((r, i) => {
      const leaderboard = asArray(r?.leaderboard)
      const games = asArray(r?.betResults).map((b) => b?.name).filter(Boolean).join(' · ') || 'No games'
      const me = meKey ? leaderboard.find((e) => entryMatches(e, meKey, meName)) : null
      const rank = Number(me?.rank)
      const place = me && leaderboard.length && Number.isFinite(rank) ? `${ord(rank)} of ${leaderboard.length}` : '—'
      const net = meKey ? myNetInRoundByKey(r, meKey) : 0
      return {
        key: r?.roundId ?? `${r?.course ?? 'round'}-${r?.date ?? r?.completedAt ?? 'unknown'}-${i}`,
        roundId: r?.roundId,
        course: r?.course || 'Saved round',
        bg: getCourseImage(r),
        date: roundDateLabel(r),
        games,
        net,
        place,
      }
    })

    return { scope, scopeCount: scopeRounds.length, myNet, inBlack, best, stats, crew, meRank, recent }
  }, [savedRounds, view, meKey, meName])

  const hasHistory = savedRounds.length > 0
  const now = new Date()
  const dateKicker = now
    .toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    .toUpperCase()
  const hour = now.getHours()
  const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const greeting = meName ? `Good ${partOfDay}, ${meName}` : 'Welcome to Golo'

  // First run only: a truly fresh install (no rounds, no chosen name, never
  // onboarded) gets the welcome flow. Existing users skip it naturally.
  if (!onboarded && !hasHistory && !profileName) {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, background: COURSE_FALLBACK_BG, backgroundImage: `url(${BACKDROP}), ${COURSE_FALLBACK_BG}`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={S.scrim} />

      <div style={S.column}>
        {/* greeting --------------------------------------------------------- */}
        <div style={S.header}>
          <div style={S.headerTop}>
            <BackButton />
            <GoloWordmark variant="white" fontPx={16} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT }}>{dateKicker}</div>
              <div style={{ fontSize: 27, fontWeight: 800, color: '#fff', marginTop: 6, letterSpacing: '-0.5px' }}>{greeting}</div>
            </div>
            <span style={{ ...S.avatar, width: 48, height: 48, boxShadow: '0 0 0 2px rgba(255,255,255,.1)', background: ACCENT, color: ACCENT_DARK }}>
              {meName ? initial(meName) : <GoloBall size={26} fill="#ffffff" dimple="rgba(20,40,24,.3)" />}
            </span>
          </div>
        </div>

        {/* scrollable body -------------------------------------------------- */}
        <div style={S.scroll}>
          {syncError && (
            <div style={S.syncBanner}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: 'rgba(255,255,255,.9)' }}>{syncError}</div>
              <button
                type="button"
                onClick={() => authUserId && retrySyncOnLogin(authUserId)}
                disabled={syncing || !authUserId}
                style={{ ...S.syncRetry, opacity: syncing ? 0.6 : 1 }}
              >
                {syncing ? 'Syncing…' : 'Retry'}
              </button>
            </div>
          )}

          {/* PRIMARY · new round */}
          <button onClick={startSetup} style={S.primaryCta}>
            <span style={S.ctaBlob} />
            <div style={{ position: 'relative', fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: 'rgba(19,37,10,.7)' }}>START SOMETHING</div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: ACCENT_DARK, letterSpacing: '-0.4px' }}>New round</span>
              <span style={S.ctaPlus}>+</span>
            </div>
            <div style={{ position: 'relative', fontSize: 13, fontWeight: 600, color: 'rgba(19,37,10,.72)', marginTop: 4 }}>Pick a course, build the group, set the games.</div>
          </button>

          {/* RESUME */}
          {resume && (
            <button onClick={() => navigate('/scoring')} style={{ ...S.resumeCard, borderColor: hexA(ACCENT, 0.45) }}>
              <span style={{ ...S.resumeThumb, background: COURSE_FALLBACK_BG, backgroundImage: layeredCourseBg(resume.bg), backgroundSize: 'cover', backgroundPosition: 'center' }}>
                <span style={S.resumeDot}>▸</span>
              </span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: ACCENT }}>PICK UP WHERE YOU LEFT OFF</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resume.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 1 }}>{resume.sub}</div>
              </div>
              <span style={{ fontSize: 20, color: 'rgba(255,255,255,.5)', flex: '0 0 auto' }}>›</span>
            </button>
          )}

          {!hasHistory ? (
            <div style={{ ...S.glassCard, marginTop: 18, textAlign: 'center', padding: '28px 20px' }}>
              <GoloBall size={40} fill="#ffffff" dimple="rgba(20,40,24,.3)" style={{ margin: '0 auto' }} />
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginTop: 8 }}>No rounds yet</div>
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.55)', marginTop: 6, lineHeight: 1.5 }}>
                Play your first round and your season ledger, crew standings and history will show up here.
              </div>
            </div>
          ) : (
            <>
              {/* LEDGER */}
              <div style={S.sectionRow}>
                <span style={S.sectionLabel}>YOUR LEDGER</span>
                <div style={S.toggle}>
                  {[{ id: 'season', label: 'Season' }, { id: 'all', label: 'All time' }].map((t) => {
                    const on = view === t.id
                    return (
                      <button key={t.id} onClick={() => setView(t.id)} aria-pressed={!!on} style={{ ...S.toggleBtn, background: on ? ACCENT : 'transparent', color: on ? ACCENT_DARK : 'rgba(255,255,255,.6)' }}>
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {model.scopeCount === 0 ? (
                <div style={{ ...S.glassCard, fontSize: 13.5, color: 'rgba(255,255,255,.5)' }}>{view === 'season' ? 'No rounds yet this season.' : 'No saved rounds yet.'}</div>
              ) : (
                <>
                  <div style={{ ...S.glassCard, position: 'relative', overflow: 'hidden', borderColor: hexA(ACCENT, 0.4) }}>
                    <span style={{ ...S.ledgerGlow, background: hexA(model.myNet >= 0 ? ACCENT : '#fb7185', 0.4) }} />
                    <div style={{ position: 'relative', fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.55)' }}>NET · {model.scope}</div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 6 }}>
                      <span style={{ fontSize: 52, fontWeight: 800, lineHeight: 0.95, letterSpacing: '-1px', color: mcol(model.myNet) }}>{signed(model.myNet)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.6)', paddingBottom: 8 }}>{model.myNet >= 0 ? 'in the black' : 'in the red'}</span>
                    </div>
                    <div style={{ position: 'relative', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 7 }}>
                      Across {model.stats[0].value} rounds · {model.inBlack} in the black · best {signed(model.best)}
                    </div>
                    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 15 }}>
                      {model.stats.map((s) => (
                        <div key={s.label} style={S.statTile}>
                          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,.5)' }}>{s.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 4, letterSpacing: '-0.3px' }}>{s.value}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>{s.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* RECENT ROUNDS */}
                  <div style={{ ...S.sectionRow, marginTop: 18 }}>
                    <span style={S.sectionLabel}>RECENT ROUNDS</span>
                    <span style={S.sectionSub}>{model.recent.length} shown</span>
                  </div>
                  {model.recent.map((g) => (
                    <button key={g.key} onClick={() => navigate(`/history/${g.roundId}`)} style={S.roundRow}>
                      <span style={{ ...S.roundThumb, background: COURSE_FALLBACK_BG, backgroundImage: layeredCourseBg(g.bg), backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.course}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{g.date}</span>
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.3)' }}>·</span>
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.games}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: mcol(g.net) }}>{signed(g.net)}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.45)' }}>{g.place}</div>
                      </div>
                    </button>
                  ))}

                  {/* THE CREW */}
                  <div style={{ ...S.sectionRow, marginTop: 18 }}>
                    <span style={S.sectionLabel}>THE CREW · {model.scope}</span>
                    {model.meRank > 0 && <span style={S.sectionSub}>you sit {ord(model.meRank)} of {model.crew.length}</span>}
                  </div>
                  {model.crew.length === 0 ? (
                    <div style={{ ...S.glassCard, fontSize: 13.5, color: 'rgba(255,255,255,.5)' }}>No crew standings yet.</div>
                  ) : (
                    model.crew.map((c, i) => (
                      <div key={c.key} style={{ ...S.crewRow, borderColor: c.me ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,.5)', width: 16, flex: '0 0 auto', textAlign: 'center' }}>{i + 1}</span>
                        <span style={{ ...S.avatar, width: 38, height: 38, fontSize: 15, boxShadow: `0 0 0 2px ${c.me ? ACCENT : 'rgba(255,255,255,.22)'}`, background: '#2dd4bf' }}>{initial(c.name)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 7 }}>
                            {c.name}
                            {c.me && <span style={S.youChip}>YOU</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>
                            {c.rounds} rounds · {signed(c.rounds ? round2(c.net / c.rounds) : 0)}/rd
                          </div>
                        </div>
                        <span style={{ fontSize: 20, fontWeight: 800, color: mcol(c.net), flex: '0 0 auto' }}>{signed(c.net)}</span>
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* bottom tab bar --------------------------------------------------- */}
        <div style={S.tabWrap}>
          <div style={S.tabBar}>
            <Tab icon="⛳" label="Home" active />
            <Tab icon="📋" label="Rounds" onClick={() => navigate('/history')} />
            <Tab icon="＋" label="Play" onClick={startSetup} />
            <Tab icon="👤" label="You" onClick={() => navigate('/you')} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- sub-components */

function Tab({ icon, label, active, disabled, onClick }) {
  const color = active ? ACCENT : disabled ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.55)'
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        minHeight: 48, justifyContent: 'center', borderRadius: 14, border: 'none',
        cursor: disabled ? 'default' : 'pointer', background: active ? hexA(ACCENT, 0.16) : 'transparent',
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
  headerTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  avatar: { borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#fff' },
  scroll: { flex: 1, overflowY: 'auto', padding: '4px 16px 14px' },

  syncBanner: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, padding: '12px 14px', borderRadius: 14, background: 'rgba(251,113,133,.12)', border: '1px solid rgba(251,113,133,.35)' },
  syncRetry: { flex: '0 0 auto', padding: '8px 12px', borderRadius: 10, border: 'none', background: ACCENT, color: ACCENT_DARK, fontSize: 12, fontWeight: 800, cursor: 'pointer' },

  primaryCta: { position: 'relative', overflow: 'hidden', display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', background: ACCENT, borderRadius: 24, padding: '20px 18px', marginBottom: 12, boxShadow: `0 14px 34px ${hexA(ACCENT, 0.45)}` },
  ctaBlob: { position: 'absolute', right: -26, top: -26, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,.22)', filter: 'blur(8px)', pointerEvents: 'none' },
  ctaPlus: { width: 46, height: 46, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: ACCENT, background: ACCENT_DARK },

  resumeCard: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: '1px solid', cursor: 'pointer', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 18, padding: '13px 14px', marginBottom: 6, boxShadow: '0 8px 22px rgba(0,0,0,.26)' },
  resumeThumb: { width: 44, height: 44, borderRadius: 13, flex: '0 0 auto', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)', position: 'relative' },
  resumeDot: { position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: '50%', background: ACCENT, border: '2px solid #14201a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: ACCENT_DARK },

  glassCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 24, padding: '20px 18px', marginBottom: 12, boxShadow: '0 12px 32px rgba(0,0,0,.32)' },
  ledgerGlow: { position: 'absolute', right: -30, top: -30, width: 150, height: 150, borderRadius: '50%', filter: 'blur(36px)', pointerEvents: 'none' },
  statTile: { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: '11px 10px' },

  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 2px 9px' },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },
  sectionSub: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.42)' },
  toggle: { display: 'flex', gap: 4, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 9999, padding: 3 },
  toggleBtn: { padding: '5px 13px', borderRadius: 9999, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800 },

  crewRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid', borderRadius: 16, padding: '11px 13px', marginBottom: 9 },
  youChip: { fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: ACCENT_DARK, background: ACCENT, padding: '2px 7px', borderRadius: 9999 },

  roundRow: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: '1px solid rgba(255,255,255,.12)', cursor: 'pointer', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, padding: '11px 12px', marginBottom: 9 },
  roundThumb: { width: 46, height: 46, borderRadius: 12, flex: '0 0 auto', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' },

  tabWrap: { flex: '0 0 auto', padding: '8px 14px max(16px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, rgba(4,12,8,0) 0%, rgba(4,12,8,.55) 60%)' },
  tabBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16,22,18,.7)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: 8 },
}
