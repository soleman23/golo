import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import { GoloWordmark, GoloBall } from '../components/shared/Logo'
import {
  playerKey, hasContact, displayName, handleOf, autoKey, namesByKey, netByKey,
  myNetInRoundByKey, playedInByKey, entryMatches,
} from '../lib/identity'

/**
 * YouPage — your locker, "glass-over-turf" (Golo Golf - You).
 *
 * The design leans on things the MVP doesn't have (accounts, GHIN sync, Venmo,
 * push, per-hole differential history), so this keeps the visual language but
 * wires only real data and honestly repurposes the rest:
 *   hero        → season NET (money is the one thing history always has)
 *   form trend  → recent per-round results (net up/down), not fake differentials
 *   scoring mix → finishes (1st/2nd/3rd/4th+) from real leaderboard ranks
 *   trophy case → badges derived from real history
 *   account     → honest settings (history, identity, clear data)
 *
 * "You" is identified by email/phone (else name) — see lib/identity. It's the
 * profile's own identity, else the most-frequent player across saved history.
 * The "Edit profile" panel sets name, handle, email and phone.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'
const BACKDROP = '/courses/sunset.png'

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
const signed = (n) => (n > 0 ? `+$${n}` : n < 0 ? `−$${-n}` : '$0')
const mcol = (n) => (n > 0 ? '#bef264' : n < 0 ? '#fb7185' : 'rgba(255,255,255,.7)')
const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
const round2 = (n) => +n.toFixed(2)

const myPlace = (r, key, name) =>
  r.leaderboard?.find((e) => entryMatches(e, key, name))?.rank ?? null

/* --------------------------------------------------------------- component */

export default function YouPage() {
  const navigate = useNavigate()
  const rounds = useHistoryStore((s) => s.rounds)
  const clearHistory = useHistoryStore((s) => s.clearHistory)
  const livePlayers = useRoundStore((s) => s.players)
  const liveCourse = useRoundStore((s) => s.round?.course)
  const profileName = useProfileStore((s) => s.name)
  const profileNick = useProfileStore((s) => s.nickname)
  const profileEmail = useProfileStore((s) => s.email)
  const profilePhone = useProfileStore((s) => s.phone)
  const setIdentity = useProfileStore((s) => s.setIdentity)
  const homeClubOverride = useProfileStore((s) => s.homeClub)
  const setHomeClub = useProfileStore((s) => s.setHomeClub)
  const venmo = useProfileStore((s) => s.venmo)
  const setVenmo = useProfileStore((s) => s.setVenmo)
  const ghinSync = useProfileStore((s) => s.ghinSync)
  const setGhinSync = useProfileStore((s) => s.setGhinSync)
  const notifySettle = useProfileStore((s) => s.notifySettle)
  const notifyLive = useProfileStore((s) => s.notifyLive)
  const setNotify = useProfileStore((s) => s.setNotify)

  const [editing, setEditing] = useState(false)

  const profile = { name: profileName, nickname: profileNick, email: profileEmail, phone: profilePhone }
  // "Identity" for the requirement means a real contact (email/phone) — a
  // name-only profile still needs nudging to add one. (playerKey has a name
  // fallback for matching legacy data; that's separate.)
  const hasIdentity = hasContact(profile)

  // "You" identity key: the profile's own (email/phone/name), else the most-
  // frequent player across history, else the live round's first player.
  const meKey = useMemo(
    () => playerKey(profile) ?? autoKey(rounds) ?? (livePlayers[0] ? playerKey(livePlayers[0]) : null),
    [profileName, profileNick, profileEmail, profilePhone, rounds, livePlayers] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const nameByKey = useMemo(() => namesByKey(rounds), [rounds])
  const meName =
    displayName(profile) ||
    (meKey ? nameByKey[meKey] : null) ||
    (livePlayers[0] ? displayName(livePlayers[0]) : null) ||
    null
  const meHandle = handleOf(profile)

  const model = useMemo(() => {
    if (!meKey) return null
    const year = new Date().getFullYear()
    const seasonRounds = rounds.filter((r) => new Date(r.completedAt ?? r.date).getFullYear() === year)

    // Crew rank this season (by identity, net desc).
    const seasonNets = netByKey(seasonRounds)
    const crewKeys = new Set()
    seasonRounds.forEach((r) => (r.players ?? []).forEach((p) => {
      const k = playerKey(p)
      if (k) crewKeys.add(k)
    }))
    const crew = [...crewKeys].sort((a, b) => (seasonNets[b] ?? 0) - (seasonNets[a] ?? 0))
    const meRank = crew.indexOf(meKey) + 1

    // Hero: season money.
    const seasonNet = seasonNets[meKey] ?? 0
    const myseason = seasonRounds.filter((r) => playedInByKey(r, meKey))
    const seasonPer = myseason.map((r) => myNetInRoundByKey(r, meKey))
    const wins = seasonPer.filter((n) => n > 0).length
    const best = seasonPer.length ? Math.max(...seasonPer) : 0
    const winRate = seasonPer.length ? Math.round((100 * wins) / seasonPer.length) : 0

    // Handicap index from the live round, if you're in it (history doesn't store it).
    const liveMe = livePlayers.find((p) => meKey != null && playerKey(p) === meKey)
    const hdcp = liveMe?.handicapIndex
    const hdcpLabel = hdcp != null ? Number(hdcp).toFixed(1) : '—'

    // Home club = most-played course (history), else the live round's course.
    const courseFreq = {}
    rounds.forEach((r) => { if (r.course) courseFreq[r.course] = (courseFreq[r.course] ?? 0) + 1 })
    const homeClub =
      (homeClubOverride && homeClubOverride.trim()) ||
      Object.entries(courseFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || liveCourse || null

    // Recent results: last 10 rounds (chronological), per-round net.
    const allMine = rounds.filter((r) => playedInByKey(r, meKey))
    const recent = [...allMine].reverse().slice(-10).map((r, i, arr) => ({
      net: myNetInRoundByKey(r, meKey),
      last: i === arr.length - 1,
    }))
    const maxAbs = Math.max(1, ...recent.map((x) => Math.abs(x.net)))
    const form = recent.map((x) => ({
      net: x.net,
      h: Math.round(28 + (Math.abs(x.net) / maxAbs) * 60),
      up: x.net >= 0,
      tag: x.last ? 'now' : '',
    }))

    // Finishes (season): distribution of leaderboard place.
    const places = { 1: 0, 2: 0, 3: 0, other: 0 }
    let placed = 0
    for (const r of myseason) {
      const p = myPlace(r, meKey, meName)
      if (p == null) continue
      placed += 1
      if (p <= 3) places[p] += 1
      else places.other += 1
    }
    const pct = (n) => (placed ? Math.round((100 * n) / placed) : 0)
    const mix = [
      { label: '1st', n: places[1], color: ACCENT },
      { label: '2nd', n: places[2], color: '#2dd4bf' },
      { label: '3rd', n: places[3], color: '#60a5fa' },
      { label: '4th+', n: places.other, color: '#fb7185' },
    ].map((m) => ({ ...m, pct: pct(m.n) }))

    // Scoring mix (season): birdie+/par/bogey/double+ distribution, summed from
    // the per-hole breakdown each round now stores (older rounds lack it and
    // simply don't contribute).
    const mixAgg = { birdie: 0, par: 0, bogey: 0, double: 0 }
    for (const r of myseason) {
      const e = r.leaderboard?.find((x) => entryMatches(x, meKey, meName))
      if (!e?.mix) continue
      mixAgg.birdie += e.mix.birdie ?? 0
      mixAgg.par += e.mix.par ?? 0
      mixAgg.bogey += e.mix.bogey ?? 0
      mixAgg.double += e.mix.double ?? 0
    }
    const holesScored = mixAgg.birdie + mixAgg.par + mixAgg.bogey + mixAgg.double
    const mixPct = (n) => (holesScored ? Math.round((100 * n) / holesScored) : 0)
    const scoreMix = [
      { label: 'Birdies+', n: mixAgg.birdie, color: ACCENT },
      { label: 'Pars', n: mixAgg.par, color: '#2dd4bf' },
      { label: 'Bogeys', n: mixAgg.bogey, color: '#60a5fa' },
      { label: 'Doubles+', n: mixAgg.double, color: '#fb7185' },
    ].map((m) => ({ ...m, pct: mixPct(m.n) }))

    // Trophy case — all real, derived from history.
    const allPer = allMine.map((r) => myNetInRoundByKey(r, meKey))
    const allNet = round2(allPer.reduce((a, b) => a + b, 0))
    const bigWin = allPer.length ? Math.max(0, ...allPer) : 0
    const everFirst = allMine.some((r) => myPlace(r, meKey, meName) === 1)
    // Longest streak of consecutive money-positive rounds (chronological).
    let streak = 0
    let run = 0
    for (const n of [...allMine].reverse().map((r) => myNetInRoundByKey(r, meKey))) {
      run = n > 0 ? run + 1 : 0
      streak = Math.max(streak, run)
    }
    const badges = [
      { icon: '🏆', title: 'First win', meta: everFirst ? 'earned' : 'win a round', earned: everFirst, color: ACCENT },
      { icon: '👑', title: 'Crew leader', meta: meRank === 1 && crew.length > 1 ? 'this season' : 'lead the crew', earned: meRank === 1 && crew.length > 1, color: '#facc15' },
      { icon: '⛳', title: 'Regular', meta: `${allMine.length}/5 rounds`, earned: allMine.length >= 5, color: '#2dd4bf' },
      { icon: '💰', title: 'Big win', meta: bigWin > 0 ? signed(bigWin) : 'locked', earned: bigWin > 0, color: '#fb923c' },
      { icon: '🔥', title: 'Hot hand', meta: streak >= 3 ? `${streak} in a row` : '3 in a row', earned: streak >= 3, color: '#f472b6' },
      { icon: '📈', title: 'In the black', meta: allNet >= 0 && allMine.length > 0 ? 'all-time +' : 'locked', earned: allNet >= 0 && allMine.length > 0, color: '#60a5fa' },
    ]
    const earnedCount = badges.filter((b) => b.earned).length

    return {
      seasonNet, seasonCount: myseason.length, meRank, crewSize: crew.length,
      hdcpLabel, homeClub, winRate, wins, best,
      form, mix, placed, scoreMix, holesScored, badges, earnedCount,
      allCount: allMine.length,
    }
  }, [rounds, livePlayers, liveCourse, meKey, meName, homeClubOverride])

  const handleClear = () => {
    if (rounds.length === 0) return
    if (window.confirm('Clear all saved rounds? This cannot be undone.')) clearHistory()
  }

  const editVenmo = () => {
    const next = window.prompt('Venmo username for payouts (leave blank to unlink):', venmo ?? '')
    if (next === null) return // cancelled
    setVenmo(next)
  }

  const toggleNotify = () => {
    const on = notifySettle || notifyLive
    setNotify(!on, !on) // single tap flips both settle-up + live-round alerts
  }

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: `url('${BACKDROP}')` }} />
      <div style={S.scrim} />

      <div style={S.column}>
        {/* identity header -------------------------------------------------- */}
        <div style={S.header}>
          <GoloWordmark variant="white" fontPx={16} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT }}>YOUR LOCKER</span>
            <button onClick={() => setEditing((v) => !v)} style={S.editBtn}>{editing ? 'Done' : '✎ Edit'}</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginTop: 14 }}>
            <span style={{ ...S.avatar, width: 78, height: 78, fontSize: 30, boxShadow: `0 0 0 3px ${hexA(ACCENT, 0.5)}, 0 10px 24px rgba(0,0,0,.4)`, background: ACCENT, color: ACCENT_DARK }}>
              {meName ? initial(meName) : <GoloBall size={42} fill="#ffffff" dimple="rgba(20,40,24,.3)" />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.05 }}>{meName ?? 'Set up your profile'}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>
                {meHandle
                  ? meHandle
                  : hasIdentity
                    ? 'Your saved identity'
                    : meName
                      ? 'Auto-detected — tap Edit to add your contact'
                      : 'Play a round to get started'}
              </div>
              {meName && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: ACCENT_DARK, background: ACCENT, padding: '4px 10px', borderRadius: 9999 }}>Hdcp {model?.hdcpLabel ?? '—'}</span>
                  {model?.homeClub && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.7)', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)', padding: '4px 10px', borderRadius: 9999 }}>{model.homeClub}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* scrollable body -------------------------------------------------- */}
        <div style={S.scroll}>
          {/* profile editor */}
          {editing && (
            <div style={{ ...S.glassCard, marginBottom: 14 }}>
              <div style={S.cardKicker}>YOUR PROFILE</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 6, lineHeight: 1.45 }}>
                You're identified by your email or phone — add at least one so your rounds follow you across the crew.
              </div>

              <label style={S.fieldLabel}>FULL NAME</label>
              <input
                value={profileName ?? ''}
                onChange={(e) => setIdentity({ name: e.target.value })}
                placeholder="Your name"
                style={S.textInput}
              />

              <label style={S.fieldLabel}>HANDLE</label>
              <input
                value={profileNick ?? ''}
                onChange={(e) => setIdentity({ nickname: e.target.value })}
                placeholder="@yourhandle"
                autoCapitalize="none"
                autoCorrect="off"
                style={S.textInput}
              />

              <label style={{ ...S.fieldLabel, color: hasIdentity ? 'rgba(255,255,255,.5)' : '#fb7185' }}>
                EMAIL {hasIdentity ? '' : '· add email or phone'}
              </label>
              <input
                value={profileEmail ?? ''}
                onChange={(e) => setIdentity({ email: e.target.value })}
                placeholder="you@example.com"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                style={S.textInput}
              />

              <label style={S.fieldLabel}>PHONE</label>
              <input
                value={profilePhone ?? ''}
                onChange={(e) => setIdentity({ phone: e.target.value })}
                placeholder="(555) 123-4567"
                type="tel"
                inputMode="tel"
                style={S.textInput}
              />

              <label style={S.fieldLabel}>HOME CLUB</label>
              <input
                value={homeClubOverride ?? ''}
                onChange={(e) => setHomeClub(e.target.value)}
                placeholder={model?.homeClub ? `${model.homeClub} (auto)` : 'e.g. Tetherow'}
                style={S.textInput}
              />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 6 }}>Leave blank to auto-detect from your most-played course.</div>

              <button onClick={() => setEditing(false)} style={S.doneBtn}>Done</button>
            </div>
          )}

          {!meName ? (
            <button onClick={() => navigate('/setup')} style={S.primaryCta}>
              <span style={{ fontSize: 16, fontWeight: 800, color: ACCENT_DARK }}>Start your first round →</span>
            </button>
          ) : (
            <>
              {/* HERO · season net */}
              <div style={{ ...S.glassCard, position: 'relative', overflow: 'hidden', borderColor: hexA(ACCENT, 0.4) }}>
                <span style={{ ...S.heroGlow, background: hexA(model.seasonNet >= 0 ? ACCENT : '#fb7185', 0.4) }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: 'rgba(255,255,255,.55)' }}>NET · THIS SEASON</span>
                  {model.meRank > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: model.meRank === 1 ? ACCENT_DARK : 'rgba(255,255,255,.7)', background: model.meRank === 1 ? ACCENT : 'rgba(255,255,255,.1)', padding: '3px 9px', borderRadius: 9999 }}>
                      {ord(model.meRank)} of {model.crewSize} in crew
                    </span>
                  )}
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 8 }}>
                  <span style={{ fontSize: 60, fontWeight: 800, lineHeight: 0.92, letterSpacing: '-1.5px', color: mcol(model.seasonNet) }}>{signed(model.seasonNet)}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)', paddingBottom: 10 }}>{model.seasonNet >= 0 ? 'in the black' : 'in the red'}</span>
                </div>
                <div style={{ position: 'relative', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 8 }}>Across {model.seasonCount} rounds this season</div>
                <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 15 }}>
                  {[
                    { label: 'HANDICAP', value: model.hdcpLabel, color: '#fff', sub: 'index' },
                    { label: 'WIN RATE', value: `${model.winRate}%`, color: '#fff', sub: `${model.wins} of ${model.seasonCount}` },
                    { label: 'BEST', value: signed(model.best), color: mcol(model.best), sub: 'single round' },
                  ].map((s) => (
                    <div key={s.label} style={S.statTile}>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,.5)' }}>{s.label}</div>
                      <div style={{ fontSize: 21, fontWeight: 800, color: s.color, marginTop: 4, letterSpacing: '-0.3px' }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* RECENT RESULTS */}
              {model.form.length > 0 && (
                <>
                  <div style={S.sectionRow}>
                    <span style={S.sectionLabel}>RECENT RESULTS</span>
                    <span style={S.sectionSub}>last {model.form.length} rounds</span>
                  </div>
                  <div style={{ ...S.glassCard, borderRadius: 20, padding: '16px 16px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 7, height: 96 }}>
                      {model.form.map((f, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: f.up ? '#bef264' : '#fb7185' }}>{signed(f.net)}</span>
                          <span style={{ width: '100%', borderRadius: '7px 7px 3px 3px', height: f.h, background: f.up ? ACCENT : '#fb7185', boxShadow: f.up ? `0 4px 12px ${hexA(ACCENT, 0.4)}` : 'none' }} />
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>{f.tag}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 13, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 11, height: 11, borderRadius: 3, background: ACCENT }} />up</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 11, height: 11, borderRadius: 3, background: '#fb7185' }} />down</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.42)' }}>net per round</span>
                    </div>
                  </div>
                </>
              )}

              {/* SCORING MIX */}
              {model.holesScored > 0 && (
                <>
                  <div style={S.sectionRow}>
                    <span style={S.sectionLabel}>SCORING MIX</span>
                    <span style={S.sectionSub}>this season · {model.holesScored} holes</span>
                  </div>
                  <div style={{ ...S.glassCard, borderRadius: 20, padding: 16 }}>
                    <div style={{ display: 'flex', width: '100%', height: 16, borderRadius: 9999, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
                      {model.scoreMix.filter((m) => m.pct > 0).map((m) => (
                        <span key={m.label} style={{ height: '100%', width: `${m.pct}%`, background: m.color }} />
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 14px', marginTop: 14 }}>
                      {model.scoreMix.map((m) => (
                        <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 11, height: 11, borderRadius: 4, flex: '0 0 auto', background: m.color }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.78)', flex: 1, minWidth: 0 }}>{m.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{m.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* FINISHES */}
              {model.placed > 0 && (
                <>
                  <div style={S.sectionRow}>
                    <span style={S.sectionLabel}>FINISHES</span>
                    <span style={S.sectionSub}>this season · {model.placed} rounds</span>
                  </div>
                  <div style={{ ...S.glassCard, borderRadius: 20, padding: 16 }}>
                    <div style={{ display: 'flex', width: '100%', height: 16, borderRadius: 9999, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
                      {model.mix.filter((m) => m.pct > 0).map((m) => (
                        <span key={m.label} style={{ height: '100%', width: `${m.pct}%`, background: m.color }} />
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 14px', marginTop: 14 }}>
                      {model.mix.map((m) => (
                        <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 11, height: 11, borderRadius: 4, flex: '0 0 auto', background: m.color }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.78)', flex: 1, minWidth: 0 }}>{m.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{m.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* TROPHY CASE */}
              <div style={S.sectionRow}>
                <span style={S.sectionLabel}>TROPHY CASE</span>
                <span style={S.sectionSub}>{model.earnedCount} of {model.badges.length} earned</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9, marginBottom: 6 }}>
                {model.badges.map((b) => (
                  <div key={b.title} style={{ ...S.badge, borderColor: b.earned ? hexA(b.color, 0.4) : 'rgba(255,255,255,.1)', opacity: b.earned ? 1 : 0.5 }}>
                    <div style={{ width: 42, height: 42, margin: '0 auto', borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, background: b.earned ? hexA(b.color, 0.16) : 'rgba(255,255,255,.06)', border: `1px solid ${b.earned ? hexA(b.color, 0.4) : 'rgba(255,255,255,.1)'}`, filter: b.earned ? 'none' : 'grayscale(1)' }}>{b.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', marginTop: 8, lineHeight: 1.2 }}>{b.title}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{b.meta}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ACCOUNT & PAYOUTS */}
          <div style={S.sectionRow}>
            <span style={S.sectionLabel}>ACCOUNT &amp; PAYOUTS</span>
          </div>
          <div style={{ ...S.glassCard, borderRadius: 20, padding: '5px 4px' }}>
            <SettingRow
              icon="✎"
              title="Edit profile"
              sub={profileEmail || profilePhone || (meName ? `${meName}${hasIdentity ? '' : ' · add email or phone'}` : 'Name, handle, email, phone')}
              onClick={() => setEditing(true)}
              divider
            />
            <SettingRow
              icon="💸"
              title="Payouts"
              sub={venmo ? `Venmo · ${venmo}` : 'Link a payout method'}
              onClick={editVenmo}
              badge={venmo ? { label: 'Linked', on: true } : { label: 'Link', on: false }}
              divider
            />
            <SettingRow
              icon="🚩"
              title="Handicap"
              sub={ghinSync ? 'GHIN · auto-sync on' : 'Not connected'}
              onClick={() => setGhinSync(!ghinSync)}
              badge={ghinSync ? { label: 'Synced', on: true } : { label: 'Off', on: false }}
              divider
            />
            <SettingRow
              icon="🔔"
              title="Notifications"
              sub="Settle-up & live rounds"
              onClick={toggleNotify}
              badge={(notifySettle || notifyLive) ? { label: 'On', on: true } : { label: 'Off', on: false }}
              divider
            />
            <SettingRow icon="📋" title="Round history" sub={`${rounds.length} saved`} onClick={() => navigate('/history')} divider />
            <SettingRow icon="🗑️" title="Clear history" sub="Delete all saved rounds" onClick={handleClear} danger />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, opacity: 0.5 }}>
            <GoloWordmark variant="white" fontPx={15} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.6)' }}>MVP</span>
          </div>
        </div>

        {/* bottom tab bar --------------------------------------------------- */}
        <div style={S.tabWrap}>
          <div style={S.tabBar}>
            <Tab icon="⛳" label="Home" onClick={() => navigate('/')} />
            <Tab icon="📋" label="Rounds" onClick={() => navigate('/history')} />
            <Tab icon="＋" label="Play" onClick={() => navigate('/setup')} />
            <Tab icon="👤" label="You" active />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- sub-components */

function SettingRow({ icon, title, sub, onClick, divider, danger, badge }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, background: 'transparent', border: 'none', cursor: 'pointer', padding: '13px 12px', borderBottom: divider ? '1px solid rgba(255,255,255,.07)' : 'none', textAlign: 'left' }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: danger ? '#fb7185' : '#fff' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      {badge ? (
        <span style={{
          flex: '0 0 auto', fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '5px 11px', borderRadius: 9999,
          background: badge.on ? ACCENT : 'rgba(255,255,255,.08)',
          color: badge.on ? ACCENT_DARK : 'rgba(255,255,255,.7)',
          border: badge.on ? 'none' : '1px solid rgba(255,255,255,.16)',
        }}>{badge.label}</span>
      ) : (
        <span style={{ fontSize: 19, color: 'rgba(255,255,255,.4)', flex: '0 0 auto' }}>›</span>
      )}
    </button>
  )
}

function Tab({ icon, label, active, onClick }) {
  const color = active ? ACCENT : 'rgba(255,255,255,.55)'
  return (
    <button onClick={active ? undefined : onClick} aria-current={active ? 'page' : undefined} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minHeight: 48, justifyContent: 'center', borderRadius: 14, border: 'none', cursor: active ? 'default' : 'pointer', background: active ? hexA(ACCENT, 0.16) : 'transparent' }}>
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
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: '50% 42%' },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.62) 0%, rgba(6,14,9,.5) 18%, rgba(6,16,10,.7) 46%, rgba(4,12,8,.94) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  header: { flex: '0 0 auto', padding: 'max(10px, env(safe-area-inset-top)) 18px 14px', textShadow: '0 2px 12px rgba(0,0,0,.4)' },
  editBtn: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '7px 13px', borderRadius: 9999, cursor: 'pointer' },
  avatar: { borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff' },
  scroll: { flex: 1, overflowY: 'auto', padding: '2px 16px 14px' },

  primaryCta: { width: '100%', textAlign: 'center', border: 'none', cursor: 'pointer', background: ACCENT, borderRadius: 20, padding: '18px', marginBottom: 12, boxShadow: `0 14px 34px ${hexA(ACCENT, 0.45)}` },
  glassCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 24, padding: '20px 18px', marginBottom: 6, boxShadow: '0 12px 32px rgba(0,0,0,.3)' },
  cardKicker: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },
  fieldLabel: { display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,.5)', marginTop: 14 },
  textInput: { width: '100%', marginTop: 7, padding: '11px 13px', borderRadius: 12, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 14, fontWeight: 600, outline: 'none', boxSizing: 'border-box' },
  doneBtn: { width: '100%', marginTop: 16, padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer', background: ACCENT, color: ACCENT_DARK, fontSize: 14, fontWeight: 800 },
  heroGlow: { position: 'absolute', right: -30, top: -30, width: 150, height: 150, borderRadius: '50%', filter: 'blur(36px)', pointerEvents: 'none' },
  statTile: { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: '11px 10px' },

  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 2px 9px' },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },
  sectionSub: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.42)' },

  badge: { position: 'relative', overflow: 'hidden', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid', borderRadius: 16, padding: '13px 9px', textAlign: 'center', boxShadow: '0 6px 16px rgba(0,0,0,.2)' },

  tabWrap: { flex: '0 0 auto', padding: '8px 14px max(16px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, rgba(4,12,8,0) 0%, rgba(4,12,8,.55) 60%)' },
  tabBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16,22,18,.7)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: 8 },
}
