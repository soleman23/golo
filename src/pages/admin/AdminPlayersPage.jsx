import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminListProfiles, adminUpdateProfile } from '../../lib/db/admin'
import { formatHandicap } from '../../engines/handicap'
import useAdminDesk from './useAdminDesk'

const ACCENT = '#d4f23a'
const DARK = '#13250a'
const PLAYER_COLORS = ['#2dd4bf', '#60a5fa', '#fb923c', '#c084fc', '#f472b6', '#facc15']

function colorFor(id, index) {
  if (!id) return PLAYER_COLORS[index % PLAYER_COLORS.length]
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PLAYER_COLORS[hash % PLAYER_COLORS.length]
}

function initialOf(profile) {
  const src = (profile.name || profile.nickname || profile.email || '?').trim()
  return src.charAt(0).toUpperCase()
}

function handleOf(profile) {
  const nick = (profile.nickname || '').trim()
  if (nick) return nick.startsWith('@') ? nick : `@${nick}`
  const email = (profile.email || '').trim()
  if (email.includes('@')) return `@${email.split('@')[0]}`
  return ''
}

function subline(profile) {
  const bits = []
  if (profile.isAdmin) bits.push('Admin')
  const handle = handleOf(profile)
  if (handle) bits.push(handle)
  if (profile.homeClub) bits.push(profile.homeClub)
  return bits.join(' · ')
}

function Toggle({ on, disabled, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        ...S.toggle,
        background: on ? ACCENT : 'rgba(255,255,255,.18)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        style={{
          ...S.toggleKnob,
          transform: on ? 'translateX(18px)' : 'translateX(0)',
          background: on ? DARK : '#fff',
        }}
      />
    </button>
  )
}

export default function AdminPlayersPage() {
  const navigate = useNavigate()
  const { refreshKey, refresh } = useAdminDesk()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    adminListProfiles({ search: query, limit: 100 }).then((res) => {
      if (!active) return
      setLoading(false)
      if (res.error) {
        setError(res.error.message || 'Could not load players.')
        return
      }
      setProfiles(res.profiles)
    })
    return () => {
      active = false
    }
  }, [query, refreshKey])

  const bumpHandicap = async (profile, delta) => {
    const current = profile.handicapIndex == null ? 0 : Number(profile.handicapIndex)
    const next = Math.round((current + delta) * 10) / 10
    setBusyId(profile.id)
    const res = await adminUpdateProfile(profile.id, { handicapIndex: next })
    setBusyId(null)
    if (res.error) {
      setError(res.error.message || 'Could not update handicap.')
      return
    }
    setProfiles((list) => list.map((p) => (p.id === profile.id ? res.profile : p)))
    refresh()
  }

  const setActive = async (profile, isActive) => {
    setBusyId(profile.id)
    const res = await adminUpdateProfile(profile.id, { isActive })
    setBusyId(null)
    if (res.error) {
      setError(res.error.message || 'Could not update player.')
      return
    }
    setProfiles((list) => list.map((p) => (p.id === profile.id ? res.profile : p)))
    refresh()
  }

  return (
    <div style={S.wrap}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search players"
        style={S.search}
      />
      {error && <div style={S.error}>{error}</div>}
      {loading && profiles.length === 0 && <div style={S.muted}>Loading players…</div>}
      {!loading && profiles.length === 0 && <div style={S.muted}>No players found.</div>}

      <div style={S.list}>
        {profiles.map((profile, index) => {
          const busy = busyId === profile.id
          const hcp = formatHandicap(profile.handicapIndex)
          return (
            <div key={profile.id} style={S.card}>
              <div
                style={{ ...S.avatar, background: colorFor(profile.id, index) }}
              >
                {initialOf(profile)}
              </div>
              <div style={S.info}>
                <div style={S.nameRow}>
                  <span style={S.name}>{profile.name || 'Unnamed'}</span>
                </div>
                <div style={S.sub}>{subline(profile) || 'No handle'}</div>
              </div>
              <div style={S.stepper}>
                <button
                  type="button"
                  aria-label="Decrease handicap"
                  disabled={busy}
                  onClick={() => bumpHandicap(profile, -1)}
                  style={S.stepBtn}
                >
                  −
                </button>
                <span style={S.stepValue}>{hcp}</span>
                <button
                  type="button"
                  aria-label="Increase handicap"
                  disabled={busy}
                  onClick={() => bumpHandicap(profile, 1)}
                  style={S.stepBtn}
                >
                  +
                </button>
              </div>
              <Toggle
                on={profile.isActive}
                disabled={busy}
                onChange={(next) => setActive(profile, next)}
              />
              <button
                type="button"
                aria-label={`Open ${profile.name || 'player'}`}
                onClick={() => navigate(`/admin/players/${profile.id}`)}
                style={S.chevron}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" stroke="rgba(255,255,255,.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const S = {
  wrap: { display: 'grid', gap: 10 },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 48,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,.15)',
    background: 'rgba(20,28,24,.55)',
    color: '#fff',
    padding: '0 14px',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: 'inherit',
    outline: 'none',
  },
  error: {
    borderRadius: 12,
    padding: 12,
    background: 'rgba(127,29,29,.38)',
    border: '1px solid rgba(251,113,133,.45)',
    color: '#fecdd3',
    fontSize: 13,
    fontWeight: 700,
  },
  muted: {
    color: 'rgba(255,255,255,.55)',
    fontSize: 14,
    fontWeight: 700,
    padding: '8px 2px',
  },
  list: { display: 'grid', gap: 8 },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 10px',
    borderRadius: 18,
    background: 'rgba(20,28,24,.55)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    border: '1px solid rgba(255,255,255,.13)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 16,
    color: '#0a1a12',
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 6 },
  name: {
    fontSize: 15,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: 650,
    color: 'rgba(255,255,255,.55)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  stepper: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flex: '0 0 auto',
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.14)',
    background: 'rgba(255,255,255,.1)',
    color: '#fff',
    fontSize: 18,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  stepValue: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: 800,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 999,
    border: 'none',
    padding: 3,
    cursor: 'pointer',
    flex: '0 0 auto',
    transition: 'background .18s ease',
  },
  toggleKnob: {
    display: 'block',
    width: 20,
    height: 20,
    borderRadius: '50%',
    transition: 'transform .18s ease',
  },
  chevron: {
    width: 36,
    height: 36,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    padding: 0,
  },
}
