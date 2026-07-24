import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useNotificationStore, { selectUnreadCount } from '../../store/notificationStore'

const DEFAULT_ACCENT = '#d4f23a'

function PinMark({ accent = DEFAULT_ACCENT, width = 28, height = 29, style }) {
  return (
    <svg width={width} height={height} viewBox="0 0 120 124" fill="none" aria-hidden="true" style={{ display: 'block', ...style }}>
      <path d="M56 20 A40 40 0 1 0 95.8 64" stroke={accent} strokeWidth="12" strokeLinecap="round" />
      <line x1="95.8" y1="64" x2="64" y2="64" stroke={accent} strokeWidth="12" strokeLinecap="round" />
      <circle cx="56" cy="58" r="15" fill="#fff" />
      <circle cx="56" cy="58" r="9" fill="none" stroke="rgba(10,36,24,0.28)" strokeWidth="2.4" />
      <line x1="56" y1="44" x2="56" y2="14" stroke={accent} strokeWidth="3.4" />
      <path d="M56 14 L86 22 L56 34 Z" fill="#fff" />
    </svg>
  )
}

function HeaderLogo({ logo = 'wordmark', accent = DEFAULT_ACCENT }) {
  if (logo === 'pin') {
    return <PinMark accent={accent} width={35} height={36} style={{ filter: 'drop-shadow(0 4px 11px rgba(0,0,0,.5))' }} />
  }

  if (logo === 'lockup') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, filter: 'drop-shadow(0 3px 9px rgba(0,0,0,.45))' }}>
        <PinMark accent={accent} width={25} height={26} />
        <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1 }}><span style={{ color: '#fff' }}>Go</span><span style={{ color: accent }}>Lo</span></span>
      </span>
    )
  }

  if (logo === 'pinWord') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 11, filter: 'drop-shadow(0 3px 9px rgba(0,0,0,.45))' }}>
        <PinMark accent={accent} width={30} height={31} />
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 3.5, color: '#fff' }}>GOLO</span>
      </span>
    )
  }

  return (
    <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1, filter: 'drop-shadow(0 3px 9px rgba(0,0,0,.45))' }}>
      <span style={{ color: '#fff' }}>Go</span><span style={{ color: accent }}>Lo</span>
    </span>
  )
}

function ContextPill({ accent = DEFAULT_ACCENT, label, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%', background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.16)', padding: '6px 13px', borderRadius: 9999, fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: accent }} />
      {label}
    </span>
  )
}

export default function AppHeader({
  accent = DEFAULT_ACCENT,
  backTo = '/',
  logo = 'wordmark',
  rightAction = 'pin',
  onRightAction,
  kicker = '',
  title = '',
  contextPill = '',
  pillAlign = 'below',
  currentPage = '',
  showTitle = true,
  titleCollapsed = false,
  showBack = true,
  style,
}) {
  const navigate = useNavigate()
  const unread = useNotificationStore(selectUnreadCount)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const hasKicker = String(kicker).trim().length > 0
  const hasPill = String(contextPill).trim().length > 0
  const pillRight = hasPill && pillAlign === 'right'
  const pillBelow = hasPill && pillAlign !== 'right'
  const menuItems = [
    { label: 'Home', to: '/' },
    { label: 'You', to: '/you' },
    {
      label: 'Notifications',
      to: '/notifications',
      ...(unread > 0 ? { badge: unread > 9 ? '9+ new' : `${unread} new` } : {}),
    },
    { label: 'Contact support', to: '/contact' },
  ]

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const goBack = () => {
    if (backTo === -1) navigate(-1)
    else navigate(backTo || '/')
  }

  const goMenu = (to) => {
    setMenuOpen(false)
    navigate(to)
  }

  return (
    <div style={{ flex: '0 0 auto', display: 'block', color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,.4)', paddingTop: 'max(8px, env(safe-area-inset-top))', ...style }}>
      <div ref={menuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '2px 14px 0', minHeight: 48 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', minWidth: 0 }}>
          {showBack ? (
            <button type="button" onClick={goBack} aria-label="Go back" style={{ flex: '0 0 auto', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.4))' }} aria-hidden="true">
                <path d="M15 4.5l-7.2 7.5 7.2 7.5" stroke={accent} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span aria-hidden="true" style={{ flex: '0 0 auto', width: 40, height: 40 }} />
          )}
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
          <HeaderLogo logo={logo} accent={accent} />
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
          <div style={{ flex: '0 0 auto', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {rightAction === 'help' && (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.4))' }} aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.62)" strokeWidth="1.8" />
                <path d="M9.4 9.1a2.6 2.6 0 0 1 4.8 1.3c0 1.7-2.2 2-2.2 3.4" stroke="rgba(255,255,255,.62)" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1.1" fill="rgba(255,255,255,.62)" />
              </svg>
            )}
            {rightAction === 'menu' && (
              <svg width="22" height="22" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.4))' }} aria-hidden="true">
                <g fill="rgba(255,255,255,.65)"><circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" /></g>
              </svg>
            )}
            {rightAction === 'pin' && (
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={unread > 0 ? `Open menu, ${unread} unread` : 'Open menu'}
                aria-expanded={menuOpen}
                style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <PinMark accent={accent} width={28} height={29} style={{ filter: 'drop-shadow(0 3px 9px rgba(0,0,0,.5))' }} />
              </button>
            )}
            {rightAction === 'refresh' && (
              <button
                type="button"
                onClick={() => onRightAction?.()}
                aria-label="Refresh"
                style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.4))' }} aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.2-5.5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M20 4v5h-5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {menuOpen && rightAction === 'pin' && (
          <div style={{ position: 'absolute', top: 48, right: 12, zIndex: 60, minWidth: 188, background: 'rgba(14,20,16,.92)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 46px rgba(0,0,0,.55)', textShadow: 'none' }}>
            {menuItems.map((item, i) => (
              <button key={item.label} type="button" onClick={() => goMenu(item.to)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', textDecoration: 'none', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', borderBottom: i < menuItems.length - 1 ? '1px solid rgba(255,255,255,.08)' : 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                {item.label}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
                  {item.badge && (
                    <span style={{ minWidth: 42, padding: '3px 7px', borderRadius: 9999, background: unread > 0 ? accent : 'rgba(255,255,255,.1)', color: unread > 0 ? '#13250a' : 'rgba(255,255,255,.5)', fontSize: 10, fontWeight: 800, lineHeight: 1.2, textAlign: 'center' }}>
                      {item.badge}
                    </span>
                  )}
                  <span style={{ color: accent, fontSize: 14, fontWeight: 800, display: item.label === currentPage ? 'inline' : 'none' }}>●</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showTitle && (
        <div style={{ overflow: 'hidden', transition: 'max-height .34s cubic-bezier(.4,0,.2,1), opacity .26s ease', maxHeight: titleCollapsed ? 0 : 160, opacity: titleCollapsed ? 0 : 1 }}>
          <div style={{ padding: '8px 18px 12px', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {hasKicker && <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: accent }}>{kicker}</div>}
              {String(title).trim().length > 0 && (
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.12, marginTop: hasKicker ? 2 : 0 }}>{title}</div>
              )}
              {pillBelow && (
                <div style={{ display: 'flex', marginTop: 10 }}>
                  <ContextPill accent={accent} label={contextPill} />
                </div>
              )}
            </div>
            {pillRight && <ContextPill accent={accent} label={contextPill} style={{ flex: '0 0 auto', maxWidth: '60%' }} />}
          </div>
        </div>
      )}
    </div>
  )
}
