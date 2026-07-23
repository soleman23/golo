import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useNotificationStore, { selectUnreadCount } from '../store/notificationStore'
import useProfileStore from '../store/profileStore'
import { hexA } from '../lib/colors'
import AppHeader from '../components/shared/AppHeader'
import {
  NOTIFICATION_CATEGORIES,
  fetchPreferences,
  upsertPreference,
} from '../lib/db/notifications'

/**
 * NotificationsPage — the durable inbox (glass-over-turf), reached from the
 * header bell or the You page. Groups items under Today / Earlier, deep-links on
 * tap (marking read), archives without deleting, and hosts the split in-app
 * notification settings at the foot.
 */

const ACCENT = '#d4f23a'

const TYPE_ICON = {
  score_updated: '⛳',
  hole_changed: '🚩',
  side_game_flagged: '🎲',
  round_finished: '💸',
  player_joined: '👋',
}

function relTime(iso) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

const isToday = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const inbox = useNotificationStore((s) => s.inbox)
  const inboxReady = useNotificationStore((s) => s.inboxReady)
  const unread = useNotificationStore(selectUnreadCount)
  const hydrateInbox = useNotificationStore((s) => s.hydrateInbox)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const archive = useNotificationStore((s) => s.archive)

  const notifyLive = useProfileStore((s) => s.notifyLive)
  const notifySettle = useProfileStore((s) => s.notifySettle)

  const [prefs, setPrefs] = useState(null) // event_type → { in_app_enabled, push_enabled }

  // Refresh from the server on mount (the inbox may already be hydrated by the
  // always-on LiveNotifications bridge, but a direct visit / hard refresh needs it).
  useEffect(() => {
    hydrateInbox()
    fetchPreferences().then((rows) => {
      const map = {}
      for (const r of rows) map[r.event_type] = r
      setPrefs(map)
    })
  }, [hydrateInbox])

  const legacyFallback = { notifyLive, notifySettle }
  const inAppEnabled = (cat) => {
    const row = prefs?.[cat.key]
    if (row) return !!row.in_app_enabled
    return legacyFallback[cat.legacy] ?? true
  }

  const toggleCategory = async (cat) => {
    const next = !inAppEnabled(cat)
    setPrefs((p) => ({ ...(p ?? {}), [cat.key]: { ...(p?.[cat.key] ?? {}), in_app_enabled: next } }))
    await upsertPreference(cat.key, { in_app_enabled: next })
  }

  const { today, earlier } = useMemo(() => {
    const t = []
    const e = []
    for (const n of inbox) (isToday(n.created_at) ? t : e).push(n)
    return { today: t, earlier: e }
  }, [inbox])

  const openItem = (n) => {
    if (!n.read_at) markRead(n.id)
    if (n.action_url) navigate(n.action_url)
  }

  // Plain render helpers (not components) so state isn't reset each render.
  const renderItem = (n) => (
    <div key={n.id} style={{ ...S.item, border: `1px solid ${n.read_at ? 'rgba(255,255,255,.1)' : hexA(ACCENT, 0.4)}` }}>
      <button type="button" onClick={() => openItem(n)} style={S.itemMain} aria-label={`${n.title}. ${n.message}`}>
        <span style={S.icon}>{TYPE_ICON[n.type] ?? '🔔'}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {!n.read_at && <span style={S.unreadDot} aria-hidden="true" />}
            <span style={{ fontSize: 14.5, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
          </span>
          {n.message && (
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 2, lineHeight: 1.35 }}>{n.message}</span>
          )}
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>{relTime(n.created_at)}</span>
        </span>
      </button>
      <button type="button" onClick={() => archive(n.id)} aria-label="Archive notification" style={S.archiveBtn}>✕</button>
    </div>
  )

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: 'url(/courses/turf.png), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)' }} />
      <div style={S.scrim} />

      <div style={S.column}>
        <AppHeader accent={ACCENT} backTo={-1} logo="wordmark" rightAction="pin" kicker="INBOX" title="Notifications" showBell={false} />

        <div className="golo-scroll" style={S.scroll}>
          <div style={S.topRow}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(255,255,255,.55)' }}>
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </span>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} style={S.markAll}>Mark all read</button>
            )}
          </div>

          {!inboxReady ? (
            <div style={S.empty}>Loading…</div>
          ) : inbox.length === 0 ? (
            <div style={S.empty}>No notifications yet.</div>
          ) : (
            <>
              {today.length > 0 && <div style={S.groupLabel}>TODAY</div>}
              {today.map(renderItem)}
              {earlier.length > 0 && <div style={S.groupLabel}>EARLIER</div>}
              {earlier.map(renderItem)}
            </>
          )}

          {/* ---- in-app notification settings ---- */}
          <div style={{ ...S.groupLabel, marginTop: 22 }}>ALERT SETTINGS</div>
          <div style={S.settingsCard}>
            {NOTIFICATION_CATEGORIES.map((cat, i) => {
              const on = inAppEnabled(cat)
              return (
                <div key={cat.key} style={{ ...S.settingRow, borderBottom: i < NOTIFICATION_CATEGORIES.length - 1 ? '1px solid rgba(255,255,255,.08)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{cat.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>{cat.sub}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    role="switch"
                    aria-checked={on}
                    aria-label={`${cat.label} in-app alerts`}
                    style={{ ...S.switch, background: on ? ACCENT : 'rgba(255,255,255,.16)' }}
                  >
                    <span style={{ ...S.knob, transform: on ? 'translateX(18px)' : 'translateX(0)' }} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff',
    background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
  },
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: 'center' },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.74) 0%, rgba(6,14,9,.6) 26%, rgba(6,16,10,.66) 58%, rgba(4,12,8,.9) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  scroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 16px 24px' },

  topRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 2px 12px' },
  markAll: { border: `1px solid ${hexA(ACCENT, 0.4)}`, background: hexA(ACCENT, 0.12), color: ACCENT, fontSize: 12, fontWeight: 800, borderRadius: 9999, padding: '6px 12px', cursor: 'pointer' },

  groupLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', margin: '14px 2px 8px' },

  item: { display: 'flex', alignItems: 'stretch', gap: 4, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, marginBottom: 9, overflow: 'hidden' },
  itemMain: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 6px 12px 13px', background: 'transparent', border: 'none', cursor: 'pointer' },
  icon: { flex: '0 0 auto', width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' },
  unreadDot: { flex: '0 0 auto', width: 8, height: 8, borderRadius: '50%', background: ACCENT },
  archiveBtn: { flex: '0 0 auto', width: 40, border: 'none', borderLeft: '1px solid rgba(255,255,255,.08)', background: 'transparent', color: 'rgba(255,255,255,.4)', fontSize: 15, fontWeight: 700, cursor: 'pointer' },

  empty: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 18, textAlign: 'center' },

  settingsCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 18, padding: '4px 14px 10px' },
  settingRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' },
  switch: { flex: '0 0 auto', position: 'relative', width: 44, height: 26, borderRadius: 9999, border: 'none', cursor: 'pointer', padding: 3, transition: 'background .18s ease' },
  knob: { display: 'block', width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,.35)', transition: 'transform .18s ease' },
}
