import { useCallback, useEffect, useState } from 'react'
import { adminForceCompleteLiveRound, adminListLiveRounds } from '../../lib/db/admin'
import { GAME_TYPES, SCORING_FORMATS } from '../../lib/gameCatalog'
import useAdminDesk from './useAdminDesk'

const ACCENT = '#d4f23a'

export default function AdminGamesPage() {
  const { refreshKey, refresh } = useAdminDesk()
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await adminListLiveRounds('live')
    setLoading(false)
    if (res.error) {
      setError(res.error.message || 'Could not load live rounds.')
      return
    }
    setRounds(res.rounds)
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const copyInvite = async (code) => {
    const url = `${window.location.origin}/join/${code}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice(`Copied invite link for ${code}`)
    } catch {
      setNotice(url)
    }
  }

  const forceComplete = async (id) => {
    if (!window.confirm('Force-complete this live round? Members will lose the live session.')) return
    setBusyId(id)
    setError('')
    const res = await adminForceCompleteLiveRound(id)
    setBusyId(null)
    if (res.error) {
      setError(res.error.message || 'Could not complete round.')
      return
    }
    setNotice('Live round completed.')
    refresh()
    load()
  }

  return (
    <div style={S.wrap}>
      {(error || notice) && (
        <div style={error ? S.error : S.notice}>{error || notice}</div>
      )}

      <section style={S.section}>
        <div style={S.sectionHead}>
          <div style={S.kicker}>LIVE ROUNDS</div>
          <div style={S.sectionTitle}>Active sessions</div>
        </div>
        {loading && rounds.length === 0 && <div style={S.muted}>Loading…</div>}
        {!loading && rounds.length === 0 && (
          <div style={S.empty}>No live rounds right now.</div>
        )}
        <div style={S.list}>
          {rounds.map((round) => (
            <div key={round.id} style={S.card}>
              <div style={S.cardTop}>
                <div>
                  <div style={S.cardTitle}>{round.courseName || 'Untitled course'}</div>
                  <div style={S.cardMeta}>
                    {round.inviteCode} · {round.memberCount} members
                    {round.scorerName ? ` · ${round.scorerName}` : ''}
                  </div>
                </div>
                <span style={S.livePill}>LIVE</span>
              </div>
              <div style={S.actions}>
                <button type="button" onClick={() => copyInvite(round.inviteCode)} style={S.ghostBtn}>
                  Copy invite
                </button>
                <button
                  type="button"
                  disabled={busyId === round.id}
                  onClick={() => forceComplete(round.id)}
                  style={S.dangerBtn}
                >
                  {busyId === round.id ? 'Ending…' : 'Force finish'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={S.section}>
        <div style={S.sectionHead}>
          <div style={S.kicker}>SCORING FORMATS</div>
          <div style={S.sectionTitle}>Catalogue</div>
        </div>
        <div style={S.grid}>
          {SCORING_FORMATS.map((fmt) => (
            <div key={fmt.id} style={S.catalogCard}>
              <div style={S.catalogTitle}>{fmt.label}</div>
              <div style={S.catalogDesc}>{fmt.desc}</div>
              <div style={S.catalogId}>{fmt.id}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={S.section}>
        <div style={S.sectionHead}>
          <div style={S.kicker}>SIDE GAMES</div>
          <div style={S.sectionTitle}>Bet types</div>
        </div>
        <div style={S.grid}>
          {GAME_TYPES.map((game) => (
            <div key={game.key} style={S.catalogCard}>
              <div style={S.catalogTitle}>{game.title}</div>
              <div style={S.catalogDesc}>{game.desc}</div>
              <div style={S.catalogId}>{game.appType}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

const S = {
  wrap: { display: 'grid', gap: 22 },
  section: { display: 'grid', gap: 10 },
  sectionHead: { display: 'grid', gap: 2 },
  kicker: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.6,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: -0.3,
  },
  muted: { color: 'rgba(255,255,255,.55)', fontWeight: 700, fontSize: 14 },
  empty: {
    borderRadius: 14,
    padding: 14,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'rgba(20,28,24,.45)',
    color: 'rgba(255,255,255,.55)',
    fontWeight: 700,
    fontSize: 14,
  },
  list: { display: 'grid', gap: 8 },
  card: {
    borderRadius: 18,
    padding: 14,
    background: 'rgba(20,28,24,.55)',
    border: '1px solid rgba(255,255,255,.13)',
    display: 'grid',
    gap: 12,
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: 800 },
  cardMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: 650,
    color: 'rgba(255,255,255,.55)',
  },
  livePill: {
    flex: '0 0 auto',
    padding: '5px 10px',
    borderRadius: 999,
    background: 'rgba(212,242,58,.18)',
    color: ACCENT,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1,
  },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  ghostBtn: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,.16)',
    background: 'rgba(255,255,255,.1)',
    color: '#fff',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dangerBtn: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid rgba(251,113,133,.4)',
    background: 'rgba(127,29,29,.35)',
    color: '#fecdd3',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 8,
  },
  catalogCard: {
    borderRadius: 16,
    padding: 14,
    background: 'rgba(20,28,24,.5)',
    border: '1px solid rgba(255,255,255,.12)',
    display: 'grid',
    gap: 6,
  },
  catalogTitle: { fontSize: 15, fontWeight: 800 },
  catalogDesc: {
    fontSize: 12,
    fontWeight: 650,
    color: 'rgba(255,255,255,.58)',
    lineHeight: 1.35,
  },
  catalogId: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.6,
    color: 'rgba(212,242,58,.75)',
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
