import { isSupabaseConfigured } from './supabaseClient'
import { saveDevice, revokeDeviceByEndpoint } from './db/notifications'

/**
 * Web Push client (Phase 3). Registers the service worker, requests permission
 * (only from a user gesture — never on first load), subscribes with the VAPID
 * public key, and mirrors the subscription into notification_devices. Server-side
 * delivery lives in the send-push Edge Function.
 *
 * Everything degrades gracefully: no VAPID key, no backend, or an unsupported
 * browser simply means push is unavailable and in-app notifications keep working.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

/** True when a VAPID public key is configured (push can be offered at all). */
export const isPushConfigured = Boolean(VAPID_PUBLIC_KEY)

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** 'granted' | 'denied' | 'default' | 'unsupported'. */
export function pushPermission() {
  return isPushSupported() ? Notification.permission : 'unsupported'
}

/** iOS/iPadOS only allow Web Push from an installed (Home Screen) PWA. */
export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

/** Rough iOS detection, for the "Add to Home Screen" hint. */
export function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

/** Register the service worker (safe to call on load; does not prompt). */
export async function registerServiceWorker() {
  if (!isPushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('[push] service worker registration failed', err)
    return null
  }
}

/** Is this browser already subscribed to push? */
export async function isSubscribed() {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  return Boolean(sub)
}

/**
 * Prompt + subscribe + persist. MUST be called from a user gesture.
 * Returns { ok, reason } where reason is 'not-configured' | 'no-backend' |
 * 'unsupported' | 'denied' | 'default' | 'no-sw' | 'save-failed'.
 */
export async function enablePush() {
  if (!isPushConfigured) return { ok: false, reason: 'not-configured' }
  if (!isSupabaseConfigured) return { ok: false, reason: 'no-backend' }
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: permission } // 'denied' | 'default'

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
  if (!reg) return { ok: false, reason: 'no-sw' }
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await saveDevice({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  })
  if (error) return { ok: false, reason: 'save-failed' }
  return { ok: true }
}

/** Unsubscribe this browser and mark the device revoked server-side. */
export async function disablePush() {
  if (!isPushSupported()) return { ok: true }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (sub) {
    await revokeDeviceByEndpoint(sub.endpoint)
    await sub.unsubscribe()
  }
  return { ok: true }
}
