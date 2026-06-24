import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEBUG_LOG = path.join(__dirname, 'debug-ca0e1a.log')
const DEBUG_LOG_CURSOR = path.join(__dirname, '.cursor', 'debug-ca0e1a.log')
const INGEST_SUFFIX = '/ingest/999b8e8c-dc41-4238-a0f1-44e3652fe004'

function appendDebugLog(line) {
  for (const file of [DEBUG_LOG, DEBUG_LOG_CURSOR]) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, line)
    } catch {
      /* ignore */
    }
  }
}

/** Dev-only: persist browser debug POSTs + Supabase RPC health probe */
function debugLogPlugin() {
  return {
    name: 'golo-debug-log',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''

        if (req.method === 'GET' && url === '/__debug/live-rounds-health') {
          const env = loadEnv(server.config.mode, process.cwd(), '')
          const base = env.VITE_SUPABASE_URL
          const key = env.VITE_SUPABASE_ANON_KEY
          const entry = {
            sessionId: 'ca0e1a',
            hypothesisId: 'A',
            location: 'vite:live-rounds-health',
            message: 'supabase rpc probe',
            data: { configured: !!(base && key) },
            timestamp: Date.now(),
          }
          if (base && key) {
            try {
              const r = await fetch(`${base}/rest/v1/rpc/start_live_round`, {
                method: 'POST',
                headers: {
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  p_round_id: '00000000-0000-0000-0000-000000000001',
                  p_state: {},
                  p_course_name: null,
                }),
              })
              const text = await r.text()
              entry.data.status = r.status
              entry.data.body = text.slice(0, 200)
              entry.data.rpcExists = r.status !== 404 && !/PGRST202|Could not find the function/i.test(text)
              entry.data.needsAuth = /not authenticated|JWT/i.test(text)
            } catch (err) {
              entry.data.probeError = String(err).slice(0, 120)
            }
          }
          appendDebugLog(`${JSON.stringify(entry)}\n`)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(entry))
          return
        }

        if (req.method !== 'POST' || !url.endsWith(INGEST_SUFFIX)) return next()
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          appendDebugLog(`${body.trim()}\n`)
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    debugLogPlugin(),
  ],
})
