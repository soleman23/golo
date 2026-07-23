/**
 * verify-game-invites.mjs — structural assertions over migration 0033
 * (game invites + the respond_betting_terms rewrite).
 *
 * SCOPE: this is a static check of the migration SQL, not an integration test.
 * It runs hermetically (no network, no credentials) so it can live in `npm test`
 * alongside the other pure verifiers, and it guards the invariants that are easy
 * to break by editing SQL by hand — above all that a redefined notif_category
 * still carries EVERY previously mapped type (dropping one silently re-routes
 * those notifications to the fallback category).
 *
 * The behavioural end-to-end pass (two accounts: invite → accept → membership +
 * slot claim → betting terms → send-back-with-comment) is a manual/staging step
 * documented in docs/NOTIFICATIONS_PLAN.md — it needs two real sessions and the
 * migration applied, neither of which exists in CI.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repoRoot } from './_shared.mjs'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    passed += 1
    return
  }
  failed += 1
  console.error('FAIL:', msg)
}

const migrations = resolve(repoRoot, 'supabase/migrations')
const sql = readFileSync(resolve(migrations, '0033_game_invites.sql'), 'utf8')
const sql0024 = readFileSync(resolve(migrations, '0024_push_delivery.sql'), 'utf8')
const sql0025 = readFileSync(resolve(migrations, '0025_betting_terms.sql'), 'utf8')

/* ------------------------------------------------------------ table + RLS */

assert(/create table if not exists public\.game_invites/.test(sql),
  'game_invites is created idempotently')
assert(/unique \(round_id, invitee_id\)/.test(sql),
  'one invite per player per round is enforced by a unique constraint')
assert(/alter table public\.game_invites enable row level security/.test(sql),
  'RLS is enabled on game_invites')
assert(/check \(status in \('pending', 'accepted', 'declined', 'expired', 'cancelled'\)\)/.test(sql),
  'invite status is constrained to the known lifecycle values')

// The browser must never write invites directly — only the definer RPCs do.
const invitePolicies = sql.match(/create policy \w+ on public\.game_invites\s+for (\w+)/g) ?? []
assert(invitePolicies.length === 1, 'game_invites has exactly one policy')
assert(/for select/.test(invitePolicies[0] ?? ''), 'the only game_invites policy is SELECT')
assert(!/on public\.game_invites\s+for (insert|update|delete|all)/.test(sql),
  'game_invites has no client insert/update/delete policy — writes go through RPCs')
assert(/using \(invitee_id = auth\.uid\(\) or inviter_id = auth\.uid\(\)\)/.test(sql),
  'only the two parties to an invite can read it')

/* ------------------------------------------- notif_category carries forward */

// Every type mapped by an earlier migration must still be mapped here, or its
// notifications silently fall through to the generic category.
function mappedTypes(text) {
  const body = text.slice(text.lastIndexOf('function public.notif_category'))
  const end = body.indexOf('$$;')
  return new Set([...body.slice(0, end).matchAll(/when '([a-z_]+)'/g)].map((m) => m[1]))
}

const prior = new Set([...mappedTypes(sql0024), ...mappedTypes(sql0025)])
const now = mappedTypes(sql)
assert(prior.size > 0, 'baseline notif_category cases were found in 0024/0025')
for (const t of prior) {
  assert(now.has(t), `notif_category still maps '${t}' (regression guard)`)
}
assert(now.has('game_invite_received') && now.has('game_invite_responded'),
  'notif_category maps both new invite types')
assert(/when 'betting_terms_requested' then 'betting'/.test(sql)
  && /when 'betting_terms_responded' then 'betting'/.test(sql),
  "the betting types keep the 'betting' category")

/* --------------------------------------------------- respond_betting_terms */

assert(/drop function if exists public\.respond_betting_terms\(uuid, boolean\)/.test(sql),
  'the old two-arg respond_betting_terms is dropped before the rewrite')
assert(/p_comment text default null/.test(sql),
  'p_comment defaults to null so existing two-arg PostgREST calls still resolve')
assert(/add column if not exists decline_comment text/.test(sql),
  'decline_comment is added to round_betting_acceptances')
assert(/'betting_terms_responded'/.test(sql),
  'respond_betting_terms inserts the organizer notification 0025 never sent')
assert(/v_creator <> uid/.test(sql),
  'the responder is never self-notified')

/* --------------------------------------------------------- invite RPC rules */

assert(/p\.onboarded = true/.test(sql) && /nullif\(trim\(p\.email\), ''\) is not null/.test(sql),
  'send_game_invites reuses the 0011 verified predicate (onboarded + reachable)')
assert(/if v_id = uid then\s+continue;/.test(sql),
  'send_game_invites never invites the organizer themselves')
assert(/'already_member'/.test(sql) && /'already_invited'/.test(sql),
  'send_game_invites skips (not errors on) existing members and duplicate invites')

assert(/for update;/.test(sql),
  'respond_game_invite locks the invite row against a double-tap race')
assert(/if v_status <> 'pending' then/.test(sql),
  'a already-responded invite returns the settled state instead of double-applying')
assert(/status = 'expired'/.test(sql),
  'responding after the round ended expires the invite')
assert(/player_key_from_player_json/.test(sql),
  'accepting derives the roster key server-side, like join_live_round')
assert(/v_role := case when v_slot is not null then 'player' else 'viewer' end/.test(sql),
  "role 'player' requires a claimed slot; otherwise viewer")
assert(/v_slot := null;\s*-- already claimed/.test(sql),
  'a slot already claimed falls back to viewer rather than raising')

/* ------------------------------------------------------------ payload hygiene */

// Notification payloads are readable by their recipient; never put contact PII
// in them (mirrors the 0023 fan-out's stripping).
const payloads = [...sql.matchAll(/jsonb_build_object\(([^;]*?)\)\s*,\s*\n\s*'(?:invite|lr)/g)]
  .map((m) => m[1])
for (const p of payloads) {
  assert(!/'email'|'phone'|player_key/.test(p),
    'notification payloads carry no email/phone/player_key')
}
assert(!/payload[^\n]*p\.email|payload[^\n]*p\.phone/.test(sql),
  'no profile contact column is written into a payload')

/* ------------------------------------------------------------------- grants */

assert(/revoke all on function[\s\S]*?from public, anon, authenticated;/.test(sql),
  'the 0020 revoke-then-grant hardening is applied')

// Isolate the `grant execute ... to authenticated;` statement and check exactly
// which functions it names — client RPCs in, internal helpers out.
const grantMatch = sql.match(/grant execute on function([\s\S]*?)to authenticated;/)
assert(!!grantMatch, 'a grant-execute-to-authenticated block exists')
const grantBlock = grantMatch?.[1] ?? ''

for (const fn of [
  'send_game_invites',
  'respond_game_invite',
  'invite_status_for_round',
  'my_upcoming_games',
  'respond_betting_terms',
]) {
  assert(grantBlock.includes(`public.${fn}(`), `${fn} is granted to authenticated`)
}
assert(!grantBlock.includes('notif_category'),
  'notif_category stays internal — no client EXECUTE')
// The rewritten signature must be the one granted, not a stale two-arg form.
assert(/public\.respond_betting_terms\(uuid, boolean, text\)/.test(grantBlock),
  'the three-arg respond_betting_terms is the granted signature')

/* -------------------------------------------------------------- conventions */

assert(/set search_path = public/.test(sql), 'functions pin search_path')
assert((sql.match(/security definer/g) ?? []).length >= 5,
  'the client-facing RPCs are SECURITY DEFINER')
assert((sql.match(/\$\$/g) ?? []).length % 2 === 0, 'dollar-quoting is balanced')

/* ------------------------------------------------------------------- results */

console.log(`verify-game-invites: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
