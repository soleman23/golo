import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import AppHeader from '../../components/shared/AppHeader'
import useAdmin from '../../hooks/useAdmin'
import { adminDeskStats } from '../../lib/db/admin'

const ACCENT = '#d4f23a'
const BG = "url('/courses/sunset.png')"

const TABS = [
  { to: '/admin/players', label: 'Players' },
  { to: '/admin/courses', label: 'Courses' },
  { to: '/admin/games', label: 'Games' },
]

function StatCell({ value, label, accentValue }) {
  return (
    <div style={S.statCell}>
      <div style={{ ...S.statValue, ...(accentValue ? { color: ACCENT } : null) }}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  )
}

export default function AdminLayout() {
  const { isAdmin, loading, email, name } = useAdmin()
  const location = useLocation()
  const [refreshKey, setRefreshKey] = useState(0)
  const [stats, setStats] = useState(null)

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!isAdmin) return undefined
    let active = true
    adminDeskStats().then((res) => {
      if (!active || res.error) return
      setStats(res.stats)
    })
    return () => {
      active = false
    }
  }, [isAdmin, refreshKey])

  const pillLabel = useMemo(() => {
    if (email) return email
    if (name) return name
    return 'Admin'
  }, [email, name])

  const ctx = useMemo(
    () => ({ refreshKey, refresh, stats }),
    [refreshKey, refresh, stats],
  )

  if (loading) {
    return (
      <div style={S.root}>
        <div style={S.backdrop} />
        <div style={S.scrim} />
      </div>
    )
  }

  if (!isAdmin) return <Navigate to="/" replace />

  const hideChrome = location.pathname.match(/^\/admin\/players\/[^/]+$/)
  const headerTitle = hideChrome ? 'Player' : ''
  const headerKicker = hideChrome ? '' : "COMMISSIONER'S DESK"
  const headerBack = hideChrome ? '/admin/players' : '/you'

  return (
    <>
      <div style={S.root}>
        <div style={S.backdrop} />
        <div style={S.scrim} />
        <div style={S.column}>
          <AppHeader
            accent={ACCENT}
            backTo={headerBack}
            logo="wordmark"
            rightAction="refresh"
            onRightAction={refresh}
            kicker={headerKicker}
            title={headerTitle}
            contextPill={hideChrome ? '' : pillLabel}
            pillAlign="right"
            showTitle
          />

          {!hideChrome && (
            <>
              <div style={S.statsBar}>
                <StatCell
                  value={stats ? String(stats.activePlayers) : '—'}
                  label="ACTIVE"
                />
                <div style={S.statDivider} />
                <StatCell
                  value={stats ? `${stats.adminCount}/${stats.adminSeatsCap}` : '—'}
                  label="SEATS"
                  accentValue
                />
                <div style={S.statDivider} />
                <StatCell
                  value={stats ? String(stats.roundsPosted) : '—'}
                  label="POSTED"
                />
              </div>

              <nav style={S.tabs} aria-label="Admin sections">
                {TABS.map((tab) => (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    style={({ isActive }) => ({
                      ...S.tab,
                      ...(isActive ? S.tabActive : null),
                    })}
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </nav>
            </>
          )}

          <div className="golo-scroll" style={S.body}>
            <Outlet context={ctx} />
          </div>
        </div>
      </div>
    </>
  )
}

const S = {
  root: {
    position: 'fixed',
    inset: 0,
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    backgroundImage: BG,
    backgroundSize: 'cover',
    backgroundPosition: '50% 40%',
    filter: 'brightness(0.55)',
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(180deg, rgba(8,14,12,.55) 0%, rgba(8,14,12,.82) 45%, rgba(6,10,9,.94) 100%)',
  },
  column: {
    position: 'relative',
    zIndex: 1,
    height: '100%',
    width: '100%',
    maxWidth: 1080,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    padding: '0 0 max(10px, env(safe-area-inset-bottom))',
  },
  statsBar: {
    flex: '0 0 auto',
    margin: '0 16px 10px',
    display: 'flex',
    alignItems: 'stretch',
    background: 'rgba(20,28,24,.55)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    border: '1px solid rgba(255,255,255,.13)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    padding: '12px 8px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: -0.3,
  },
  statLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,.45)',
  },
  statDivider: {
    width: 1,
    background: 'rgba(255,255,255,.12)',
    margin: '10px 0',
  },
  tabs: {
    flex: '0 0 auto',
    margin: '0 16px 12px',
    display: 'flex',
    gap: 6,
    padding: 5,
    background: 'rgba(20,28,24,.55)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: '1px solid rgba(255,255,255,.13)',
    borderRadius: 14,
    overflowX: 'auto',
  },
  tab: {
    flex: '0 0 auto',
    padding: '10px 16px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 800,
    color: 'rgba(255,255,255,.78)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  tabActive: {
    background: ACCENT,
    color: '#13250a',
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '0 16px 24px',
  },
}
