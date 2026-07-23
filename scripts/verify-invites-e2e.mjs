/**
 * verify-invites-e2e.mjs — behavioural end-to-end test for game invites (Flow A)
 * and the betting-terms response loop (Flow B), against a LOCAL Supabase.
 *
 * This is the two-account pass the hermetic verify-game-invites.mjs cannot do: it
 * creates real auth users, calls the RPCs as each of them (so auth.uid() and RLS
 * are genuinely exercised), and asserts the resulting rows.
 *
 * Talks to PostgREST/GoTrue over plain fetch rather than @supabase/supabase-js —
 * the client eagerly builds a realtime socket, which needs Node 22+ for native
 * WebSocket. This keeps the script runnable on the repo's Node 20.
 *
 * Requires the local stack — deliberately NOT in `npm test`:
 *     npx supabase start && npx supabase db reset --local
 *     npm run verify:invites-e2e
 *
 * Never point this at a remote project: it creates and deletes users.
 */

import { execFileSync } from 'node:child_process'

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY = process.env.SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

if (!/127\.0\.0\.1|localhost/.test(URL_BASE)) {
  console.error('Refusing to run against a non-local URL:', URL_BASE)
  process.exit(1)
}

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed += 1; console.log('  ok  ', msg) }
  else { failed += 1; console.error('  FAIL', msg) }
}

/** One caller (a signed-in user, or the service role). */
function actor(token, key = ANON_KEY) {
  const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  return {
    async rpc(fn, body) {
      const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) })
      const text = await r.text()
      const data = text ? JSON.parse(text) : null
      return r.ok ? { data, error: null } : { data: null, error: data ?? { message: text } }
    },
    async select(table, query = '') {
      const r = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, { headers })
      const text = await r.text()
      const data = text ? JSON.parse(text) : null
      return r.ok ? { data, error: null } : { data: null, error: data }
    },
    async insert(table, row) {
      const r = await fetch(`${URL_BASE}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify(row) })
      const text = await r.text()
      return r.ok ? { error: null } : { error: text ? JSON.parse(text) : { message: text } }
    },
    async update(table, query, patch) {
      const r = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, { method: 'PATCH', headers, body: JSON.stringify(patch) })
      const text = await r.text()
      return r.ok ? { error: null } : { error: text ? JSON.parse(text) : { message: text } }
    },
  }
}

/**
 * Admin-side setup/inspection runs as postgres over psql rather than PostgREST:
 * `service_role` has no table privileges on public.profiles (the 0018/0020
 * hardening), and the app never uses service_role anyway.
 */
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_golf-app'
function sql(query) {
  const out = execFileSync('docker', [
    'exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c',
    `select coalesce(json_agg(t), '[]'::json)::text from (${query}) t`,
  ], { encoding: 'utf8' })
  return JSON.parse(out.trim())
}
function exec(statement) {
  execFileSync('docker', [
    'exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-c', statement,
  ], { encoding: 'utf8' })
}

/**
 * Local-only fixture. Recent Supabase CLI versions ship a hardened default ACL
 * for schema public — tables created by `postgres` grant anon/authenticated only
 * Dxtm (truncate/references/trigger/maintain), NOT select/insert/update/delete.
 * Hosted projects provisioned under the older default have the full grant, which
 * is why the shipped app reads these tables today. RLS filters rows only *after*
 * table privileges are checked, so without this the client sees
 * "permission denied" everywhere and nothing under test can run.
 *
 * This restores the classic posture for the local database only. It is NOT a
 * migration — whether the repo should carry its own grants is a separate call
 * (see docs/NOTIFICATIONS_PLAN.md).
 */
function grantLocalTablePrivileges() {
  exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;
        grant usage, select on all sequences in schema public to anon, authenticated;`)
}

const stamp = Date.now()
const pw = 'test-password-123!'
const created = []

async function makeUser(tag, name) {
  const email = `${tag}.${stamp}@golo.test`
  const cr = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw, email_confirm: true }),
  })
  const cu = await cr.json()
  if (!cr.ok) throw new Error(`createUser ${tag}: ${JSON.stringify(cu)}`)
  const id = cu.id
  created.push(id)

  // The verified predicate needs onboarded + a contact on the profile.
  exec(`insert into public.profiles (id, name, email, onboarded) values ('${id}', '${name}', '${email}', true)
        on conflict (id) do update set name = excluded.name, email = excluded.email, onboarded = true`)

  const sr = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const sess = await sr.json()
  if (!sr.ok) throw new Error(`signIn ${tag}: ${JSON.stringify(sess)}`)
  return { id, email, name, ...actor(sess.access_token) }
}

async function cleanup() {
  if (process.env.KEEP) { console.log('KEEP set — leaving test users in place'); return }
  for (const id of created) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, {
      method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {})
  }
}

try {
  /* ---------------------------------------------------------------- setup */
  grantLocalTablePrivileges()
  const A = await makeUser('organizer', 'Ann Organizer')   // organizer/scorer
  const B = await makeUser('invitee', 'Bob Invitee')       // gets a roster slot
  const C = await makeUser('outsider', 'Cal Outsider')     // non-party, for RLS

  const roundId = crypto.randomUUID()
  const slotB = crypto.randomUUID()
  // Roster carries B's email so the server derives a slot key B can claim.
  const roster = [
    { id: crypto.randomUUID(), name: A.name, email: A.email, guest: false },
    { id: slotB, name: B.name, email: B.email, guest: false },
  ]
  const state = { round: { roundId }, players: roster, scores: {}, bets: [] }
  const { error: startErr } = await A.rpc('start_live_round', {
    p_round_id: roundId, p_state: state, p_roster: roster, p_course_name: 'Tetherow',
  })
  assert(!startErr, `live round started${startErr ? ` (${startErr.message})` : ''}`)

  /* ------------------------------------------------------- send invites */
  const { data: sent, error: sendErr } = await A.rpc('send_game_invites', {
    p_round_id: roundId, p_invitee_ids: [B.id],
  })
  assert(!sendErr, `send_game_invites succeeded${sendErr ? ` (${sendErr.message})` : ''}`)
  assert(sent?.invited === 1, `one invite sent (got ${sent?.invited})`)

  const { data: bNotifs, error: bNotifErr } = await B.select('notifications', 'select=id,type,message,payload,round_id&type=eq.game_invite_received')
  if (bNotifErr) console.error('   [notifications select error]', JSON.stringify(bNotifErr))
  assert(bNotifs?.length === 1, 'invitee has exactly one invite notification')
  const inviteNotif = bNotifs?.[0]
  assert(/Ann Organizer invited you to Tetherow/.test(inviteNotif?.message ?? ''),
    `invite copy names inviter + course (got "${inviteNotif?.message}")`)
  assert(!/email|phone|@golo\.test/.test(JSON.stringify(inviteNotif?.payload ?? {})),
    'invite payload carries no contact PII')
  const inviteId = inviteNotif?.payload?.invite_id

  // Re-inviting is a no-op skip, not an error or a duplicate.
  const { data: again } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [B.id] })
  assert(again?.invited === 0 && again?.skipped?.[0]?.reason === 'already_invited',
    'a duplicate invite is skipped, not duplicated')

  // Unverified users are skipped rather than erroring the whole call.
  exec(`update public.profiles set onboarded = false where id = '${C.id}'`)
  const { data: unver } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [C.id] })
  assert(unver?.invited === 0 && unver?.skipped?.[0]?.reason === 'not_verified',
    'an unverified player is skipped with a reason')
  exec(`update public.profiles set onboarded = true where id = '${C.id}'`)

  /* ------------------------------------------------------------ RLS negatives */
  const { data: cSeesInvites } = await C.select('game_invites', 'select=id')
  assert((cSeesInvites?.length ?? 0) === 0, 'a non-party user cannot read the A→B invite')
  const { data: cSeesNotifs } = await C.select('notifications', 'select=id')
  assert((cSeesNotifs?.length ?? 0) === 0, "a non-party user cannot read another's notifications")
  const { error: cInsert } = await C.insert('game_invites', { round_id: roundId, inviter_id: C.id, invitee_id: A.id })
  assert(!!cInsert, 'the browser cannot INSERT a game_invite directly')
  const { error: cNotifInsert } = await C.insert('notifications', { user_id: A.id, type: 'x', title: 'forged' })
  assert(!!cNotifInsert, 'the browser cannot INSERT a notification directly')

  // Nobody can respond on another user's behalf.
  const { error: wrongUser } = await C.rpc('respond_game_invite', { p_invite_id: inviteId, p_accept: true })
  assert(!!wrongUser, 'a third party cannot respond to someone else’s invite')

  /* ----------------------------------------------------------- accept flow */
  const { data: acc, error: accErr } = await B.rpc('respond_game_invite', { p_invite_id: inviteId, p_accept: true })
  assert(!accErr, `invitee accepted${accErr ? ` (${accErr.message})` : ''}`)
  assert(acc?.status === 'accepted', `status is accepted (got ${acc?.status})`)
  assert(acc?.role === 'player', `accepting claimed the roster slot → role player (got ${acc?.role})`)

  const mem = sql(`select user_id, role, player_key, slot_player_id from public.live_round_members
                   where live_round_id = '${roundId}' and user_id = '${B.id}'`)
  assert(mem?.length === 1, 'membership row created')
  assert(mem?.[0]?.role === 'player' && mem?.[0]?.slot_player_id === slotB,
    'the membership claims the matching slot (role player ⟺ owns a slot)')

  const { data: aNotifs } = await A.select('notifications', 'select=type,title,message&type=eq.game_invite_responded')
  assert(aNotifs?.length === 1, 'organizer notified of the response')
  assert(aNotifs?.[0]?.title === 'Invite accepted' && /Bob Invitee is in for Tetherow/.test(aNotifs?.[0]?.message ?? ''),
    `accept copy is right (got "${aNotifs?.[0]?.message}")`)

  const { data: reread } = await B.select('notifications', `select=read_at&id=eq.${inviteNotif.id}`)
  assert(!!reread?.[0]?.read_at, 'the invitee’s own invite notification was marked read')

  // Double-respond must not double-apply.
  const { data: dup, error: dupErr } = await B.rpc('respond_game_invite', { p_invite_id: inviteId, p_accept: true })
  assert(!dupErr && dup?.already === true, 'responding twice returns the settled state, not an error')

  // Already a member → skipped on a further invite.
  const { data: postJoin } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [B.id] })
  assert(postJoin?.skipped?.[0]?.reason === 'already_member',
    'inviting an existing member is skipped as already_member')

  /* ------------------------------------------------------- betting terms */
  const terms = { scoringType: 'stroke', scoring: 'net', bets: [{ type: 'nassau', amount: 5 }] }
  const { data: fin, error: finErr } = await A.rpc('finalize_betting_terms', {
    p_round_id: roundId, p_terms: terms, p_max_exposure: null,
  })
  assert(!finErr, `terms finalized${finErr ? ` (${finErr.message})` : ''}`)
  const termsId = fin?.terms_id

  const { data: active1 } = await A.rpc('is_betting_active', { p_round_id: roundId })
  assert(active1 === false, 'bet is not active while the invitee is pending')

  const { data: bBetNotif } = await B.select('notifications', 'select=type&type=eq.betting_terms_requested')
  assert((bBetNotif?.length ?? 0) === 1,
    'the member who joined via invite was asked to accept the terms')

  // Send back for review, with a comment.
  const { error: sbErr } = await B.rpc('respond_betting_terms', {
    p_terms_id: termsId, p_accept: false, p_comment: '$5 nassau is steep',
  })
  assert(!sbErr, `send-back accepted${sbErr ? ` (${sbErr.message})` : ''}`)

  const { data: aResp } = await A.select('notifications', 'select=title,message,payload&type=eq.betting_terms_responded')
  assert(aResp?.length === 1, 'organizer notified of the send-back (the 0025 gap)')
  assert(/\$5 nassau is steep/.test(aResp?.[0]?.message ?? ''),
    `the comment reaches the organizer (got "${aResp?.[0]?.message}")`)
  const storedComment = sql(`select decline_comment from public.round_betting_acceptances
                             where terms_id = '${termsId}' and user_id = '${B.id}'`)
  assert(storedComment?.[0]?.decline_comment === '$5 nassau is steep', 'the comment is stored on the acceptance')

  // Backward compatibility: the two-arg call still resolves via the default.
  const { error: twoArg } = await B.rpc('respond_betting_terms', { p_terms_id: termsId, p_accept: true })
  assert(!twoArg, `a legacy two-arg call still resolves${twoArg ? ` (${twoArg.message})` : ''}`)

  const { data: active2 } = await A.rpc('is_betting_active', { p_round_id: roundId })
  assert(active2 === true, 'bet is active once everyone has accepted')

  // Re-finalize supersedes and re-pends everyone.
  const { error: reFinErr } = await A.rpc('finalize_betting_terms', {
    p_round_id: roundId, p_terms: { ...terms, bets: [{ type: 'nassau', amount: 2 }] }, p_max_exposure: null,
  })
  assert(!reFinErr, 're-finalize succeeded')
  const { data: active3 } = await A.rpc('is_betting_active', { p_round_id: roundId })
  assert(active3 === false, 're-finalizing resets the bet to not-active')

  /* -------------------------------------------------------- upcoming games */
  const { data: upcoming } = await B.rpc('my_upcoming_games')
  assert((upcoming?.length ?? 0) === 1, `the invitee sees one upcoming game (got ${upcoming?.length})`)
  assert(upcoming?.[0]?.course_name === 'Tetherow' && upcoming?.[0]?.organizer_name === 'Ann Organizer',
    'upcoming game carries course + organizer')
  assert(upcoming?.[0]?.has_terms === true && upcoming?.[0]?.terms_status === 'pending',
    'upcoming game reflects the re-pended terms')
  assert(!JSON.stringify(upcoming ?? []).includes('@golo.test'),
    'my_upcoming_games leaks no contact details')

  const { data: statuses } = await A.rpc('invite_status_for_round', { p_round_id: roundId })
  assert(statuses?.[0]?.name === 'Bob Invitee' && statuses?.[0]?.status === 'accepted',
    'invite_status_for_round reports the response')
  assert(!JSON.stringify(statuses ?? []).includes('@golo.test'),
    'invite_status_for_round leaks no contact details')
  const { error: outsiderStatus } = await C.rpc('invite_status_for_round', { p_round_id: roundId })
  assert(!!outsiderStatus, 'a non-member cannot read the invite roster')
} catch (err) {
  failed += 1
  console.error('ERROR:', err.message)
} finally {
  await cleanup()
}

console.log(`\nverify-invites-e2e: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
