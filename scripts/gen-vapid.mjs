/**
 * Generate a VAPID keypair for Web Push (Phase 3). Run once:
 *
 *   node scripts/gen-vapid.mjs
 *
 * Then wire the keys up:
 *   - PUBLIC key  → .env.local as VITE_VAPID_PUBLIC_KEY (safe to ship in the client).
 *   - PRIVATE key → a Supabase secret for the send-push Edge Function, e.g.:
 *       npx --no-install supabase secrets set \
 *         VAPID_PUBLIC_KEY=<public> \
 *         VAPID_PRIVATE_KEY=<private> \
 *         VAPID_SUBJECT=mailto:you@example.com
 *
 * The private key is a secret — never commit it or put it in the frontend bundle.
 * Keys are P-256 (prime256v1), the curve the Web Push VAPID spec requires.
 */
import { webcrypto as crypto } from 'node:crypto'

const kp = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

// Public key = 65-byte uncompressed EC point (0x04 || X || Y), base64url — the
// exact form pushManager.subscribe({ applicationServerKey }) expects.
const rawPub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey))
// Private key = the 32-byte scalar 'd' from the JWK, already base64url — the
// form the web-push sender expects.
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)

const publicKey = rawPub.toString('base64url')
const privateKey = jwk.d

console.log('\nVAPID keypair (P-256) — keep the private key secret.\n')
console.log('  VITE_VAPID_PUBLIC_KEY (client / .env.local):')
console.log('    ' + publicKey + '\n')
console.log('  VAPID_PRIVATE_KEY (Supabase secret, server only):')
console.log('    ' + privateKey + '\n')
