/** Dev-only debug ingest (proxied via Vite to avoid browser CORS). */
const INGEST = '/__debug/ingest/999b8e8c-dc41-4238-a0f1-44e3652fe004'
const DIRECT = 'http://127.0.0.1:7471/ingest/999b8e8c-dc41-4238-a0f1-44e3652fe004'
const SESSION = 'ca0e1a'
const BUFFER_KEY = 'golo:debug:ca0e1a'
const BUFFER_MAX = 80

function postLog(entry) {
  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION },
    body: JSON.stringify(entry),
  }).catch(() => {
    fetch(DIRECT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION },
      body: JSON.stringify(entry),
    }).catch(() => {})
  })
}

export function debugLog(hypothesisId, location, message, data = {}, runId = 'pre-fix') {
  if (!import.meta.env.DEV) return
  const entry = {
    sessionId: SESSION,
    hypothesisId,
    location,
    message,
    data,
    runId,
    timestamp: Date.now(),
  }
  try {
    const buf = JSON.parse(localStorage.getItem(BUFFER_KEY) || '[]')
    buf.push(entry)
    while (buf.length > BUFFER_MAX) buf.shift()
    localStorage.setItem(BUFFER_KEY, JSON.stringify(buf))
  } catch {
    /* ignore storage errors */
  }
  console.info('[DBG-ca0e1a]', JSON.stringify(entry))
  postLog(entry)
}

/** Dev-only: probe whether live-round RPCs exist in Supabase (writes to debug-ca0e1a.log). */
export function probeLiveRoundHealth() {
  if (!import.meta.env.DEV) return
  fetch('/__debug/live-rounds-health')
    .then((r) => r.json())
    .then((data) => debugLog('A', 'debugLog.js:probeLiveRoundHealth', 'health probe', data, 'health'))
    .catch(() => {})
}

/** Re-send buffered logs (e.g. after a failed ingest during the session). */
export function flushDebugLog(runId = 'flush') {
  if (!import.meta.env.DEV) return
  try {
    const buf = JSON.parse(localStorage.getItem(BUFFER_KEY) || '[]')
    for (const entry of buf) postLog({ ...entry, runId })
  } catch {
    /* ignore */
  }
}
