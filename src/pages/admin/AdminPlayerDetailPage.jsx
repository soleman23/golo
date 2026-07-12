import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { adminGetProfile, adminUpdateProfile } from '../../lib/db/admin'
import useAdminDesk from './useAdminDesk'

const ACCENT = '#d4f23a'
const DARK = '#13250a'

export default function AdminPlayerDetailPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { refresh } = useAdminDesk()
  const [profile, setProfile] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    adminGetProfile(userId).then((res) => {
      if (!active) return
      setLoading(false)
      if (res.error || !res.profile) {
        setError(res.error?.message || 'Player not found.')
        setProfile(null)
        setDraft(null)
        return
      }
      setProfile(res.profile)
      setDraft({
        name: res.profile.name ?? '',
        nickname: res.profile.nickname ?? '',
        handicapIndex: res.profile.handicapIndex ?? '',
        isActive: res.profile.isActive,
      })
    })
    return () => {
      active = false
    }
  }, [userId])

  if (!userId) return <Navigate to="/admin/players" replace />

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError('')
    setNotice('')
    const res = await adminUpdateProfile(userId, {
      name: draft.name,
      nickname: draft.nickname,
      handicapIndex: draft.handicapIndex === '' ? null : Number(draft.handicapIndex),
      isActive: draft.isActive,
    })
    setSaving(false)
    if (res.error) {
      setError(res.error.message || 'Could not save.')
      return
    }
    setProfile(res.profile)
    setDraft({
      name: res.profile.name ?? '',
      nickname: res.profile.nickname ?? '',
      handicapIndex: res.profile.handicapIndex ?? '',
      isActive: res.profile.isActive,
    })
    setNotice('Saved.')
    refresh()
  }

  if (loading) return <div style={S.muted}>Loading…</div>
  if (!profile || !draft) {
    return (
      <div style={S.wrap}>
        <button type="button" onClick={() => navigate('/admin/players')} style={S.backLink}>
          ← Players
        </button>
        <div style={S.error}>{error || 'Player not found.'}</div>
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      <button type="button" onClick={() => navigate('/admin/players')} style={S.backLink}>
        ← Players
      </button>

      <div style={S.card}>
        <div style={S.kicker}>PLAYER</div>
        <h1 style={S.title}>{profile.name || 'Unnamed'}</h1>
        <p style={S.meta}>
          {profile.email || 'No email'}
          {profile.isAdmin ? ' · Admin' : ''}
          {profile.onboarded ? '' : ' · Not onboarded'}
        </p>
        <p style={S.meta}>
          {profile.roundCount} rounds played · {profile.roundsOwned} owned
        </p>
      </div>

      {(error || notice) && (
        <div style={error ? S.error : S.notice}>{error || notice}</div>
      )}

      <div style={S.card}>
        <label style={S.label}>
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            style={S.input}
          />
        </label>
        <label style={S.label}>
          Nickname
          <input
            value={draft.nickname}
            onChange={(e) => setDraft((d) => ({ ...d, nickname: e.target.value }))}
            style={S.input}
          />
        </label>
        <label style={S.label}>
          Handicap index
          <input
            type="number"
            step="0.1"
            value={draft.handicapIndex}
            onChange={(e) => setDraft((d) => ({ ...d, handicapIndex: e.target.value }))}
            style={S.input}
          />
        </label>
        <label style={S.switchRow}>
          <span>
            <span style={S.switchTitle}>Active</span>
            <span style={S.switchSub}>Inactive players cannot join live rounds</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.isActive}
            onClick={() => setDraft((d) => ({ ...d, isActive: !d.isActive }))}
            style={{
              ...S.toggle,
              background: draft.isActive ? ACCENT : 'rgba(255,255,255,.18)',
            }}
          >
            <span
              style={{
                ...S.knob,
                transform: draft.isActive ? 'translateX(18px)' : 'translateX(0)',
                background: draft.isActive ? DARK : '#fff',
              }}
            />
          </button>
        </label>

        <div style={S.readonly}>
          <div>Phone: {profile.phone || '—'}</div>
          <div>Home club: {profile.homeClub || '—'}</div>
          <div>GHIN: {profile.ghinNumber || (profile.ghinConnectedAt ? 'Connected' : '—')}</div>
        </div>

        <button type="button" onClick={save} disabled={saving} style={S.save}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

const S = {
  wrap: { display: 'grid', gap: 12, maxWidth: 560 },
  backLink: {
    justifySelf: 'start',
    background: 'none',
    border: 'none',
    color: ACCENT,
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  },
  card: {
    borderRadius: 20,
    padding: 16,
    background: 'rgba(20,28,24,.55)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    border: '1px solid rgba(255,255,255,.13)',
    display: 'grid',
    gap: 12,
  },
  kicker: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.6,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: -0.4,
    lineHeight: 1.1,
  },
  meta: {
    margin: 0,
    color: 'rgba(255,255,255,.58)',
    fontSize: 13,
    fontWeight: 650,
  },
  label: {
    display: 'grid',
    gap: 6,
    fontSize: 12,
    fontWeight: 800,
    color: 'rgba(255,255,255,.62)',
  },
  input: {
    minHeight: 44,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,.15)',
    background: 'rgba(255,255,255,.08)',
    color: '#fff',
    padding: '0 12px',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: 'inherit',
  },
  switchRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchTitle: { display: 'block', fontSize: 14, fontWeight: 800 },
  switchSub: { display: 'block', marginTop: 2, fontSize: 12, color: 'rgba(255,255,255,.5)', fontWeight: 650 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 999,
    border: 'none',
    padding: 3,
    cursor: 'pointer',
    flex: '0 0 auto',
  },
  knob: {
    display: 'block',
    width: 20,
    height: 20,
    borderRadius: '50%',
    transition: 'transform .18s ease',
  },
  readonly: {
    display: 'grid',
    gap: 6,
    fontSize: 13,
    fontWeight: 650,
    color: 'rgba(255,255,255,.55)',
    paddingTop: 4,
    borderTop: '1px solid rgba(255,255,255,.1)',
  },
  save: {
    minHeight: 48,
    borderRadius: 14,
    border: 'none',
    background: ACCENT,
    color: DARK,
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  muted: { color: 'rgba(255,255,255,.55)', fontWeight: 700 },
  error: {
    borderRadius: 12,
    padding: 12,
    background: 'rgba(127,29,29,.38)',
    border: '1px solid rgba(251,113,133,.45)',
    color: '#fecdd3',
    fontSize: 13,
    fontWeight: 700,
  },
  notice: {
    borderRadius: 12,
    padding: 12,
    background: 'rgba(77,95,18,.34)',
    border: '1px solid rgba(212,242,58,.34)',
    color: '#f8ffd2',
    fontSize: 13,
    fontWeight: 700,
  },
}
