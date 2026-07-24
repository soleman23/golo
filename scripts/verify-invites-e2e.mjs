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
 * It relies on migrations 0034–0037 for table privileges, invite join parity,
 * and get_profile_names: without explicit grants a freshly-provisioned database
 * denies every client read regardless of RLS, so a pass here also proves those
 * migrations cover what the client actually touches.
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
  const A = await makeUser('organizer', 'Ann Organizer')   // organizer/scorer
  const B = await makeUser('invitee', 'Bob Invitee')       // gets a roster slot
  const C = await makeUser('outsider', 'Cal Outsider')     // non-party, for RLS
  const D = await makeUser('decliner', 'Dee Decliner')     // decline → re-invite
  const E = await makeUser('viewer', 'Eve Viewer')         // viewer then accept upgrade

  const roundId = crypto.randomUUID()
  const slotB = crypto.randomUUID()
  const slotD = crypto.randomUUID()
  const slotE = crypto.randomUUID()
  // Roster carries emails so the server derives slot keys invitees can claim.
  const roster = [
    { id: crypto.randomUUID(), name: A.name, email: A.email, guest: false },
    { id: slotB, name: B.name, email: B.email, guest: false },
    { id: slotD, name: D.name, email: D.email, guest: false },
    { id: slotE, name: E.name, email: E.email, guest: false },
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

  // The inbox gates Accept/Deny on the invite's own status, not on the
  // notification's read state — marking a row read must not strand a pending
  // invite. Both halves of that contract are asserted here.
  const { data: pendingBefore } = await B.select('game_invites', 'select=id,status&status=eq.pending')
  assert(pendingBefore?.length === 1 && pendingBefore[0].id === inviteId,
    'the invitee can read their own pending invite (backs the inbox buttons)')
  await B.update('notifications', `id=eq.${inviteNotif.id}`, { read_at: new Date().toISOString() })
  const { data: pendingAfterRead } = await B.select('game_invites', 'select=id&status=eq.pending')
  assert(pendingAfterRead?.length === 1,
    'marking the notification read leaves the invite pending and answerable')
  await B.update('notifications', `id=eq.${inviteNotif.id}`, { read_at: null })

  // Re-inviting while still pending is a no-op skip, not an error or a duplicate.
  const { data: again } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [B.id] })
  assert(again?.invited === 0 && again?.skipped?.[0]?.reason === 'already_invited',
    'a duplicate pending invite is skipped, not duplicated')

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

  /* ---------------------------------------------- decline → re-invite (D) */
  const { data: sentD } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [D.id] })
  assert(sentD?.invited === 1, 'Dee was invited')
  const { data: dInvites } = await D.select('game_invites', 'select=id,status&status=eq.pending')
  const dInviteId = dInvites?.[0]?.id
  assert(!!dInviteId, 'Dee can read her pending invite')
  const { data: dec } = await D.rpc('respond_game_invite', { p_invite_id: dInviteId, p_accept: false })
  assert(dec?.status === 'declined', `Dee declined (got ${dec?.status})`)
  const { data: reinv } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [D.id] })
  assert(reinv?.invited === 1, `after decline, re-invite counts as invited (got ${reinv?.invited}, skipped ${JSON.stringify(reinv?.skipped)})`)
  const { data: dPending } = await D.select('game_invites', 'select=id,status&status=eq.pending')
  assert(dPending?.length === 1 && dPending[0].id === dInviteId,
    're-invite resurrects the same invite row to pending')
  const { data: dNotifs } = await D.select('notifications', 'select=id,read_at&type=eq.game_invite_received')
  assert((dNotifs?.length ?? 0) >= 1 && dNotifs.some((n) => !n.read_at),
    're-invite resurfaces an unread invite notification')
  const { data: dAcc } = await D.rpc('respond_game_invite', { p_invite_id: dInviteId, p_accept: true })
  assert(dAcc?.status === 'accepted' && dAcc?.role === 'player',
    `Dee accepts after re-invite as player (got ${dAcc?.status}/${dAcc?.role})`)
  assert(!!dAcc?.invite_code && !!dAcc?.state && dAcc?.live_round_id === roundId,
    'Dee accept returns hydrate fields (invite_code + state + live_round_id)')

  /* ----------------------------------------------------------- accept flow */
  const { data: acc, error: accErr } = await B.rpc('respond_game_invite', { p_invite_id: inviteId, p_accept: true })
  assert(!accErr, `invitee accepted${accErr ? ` (${accErr.message})` : ''}`)
  assert(acc?.status === 'accepted', `status is accepted (got ${acc?.status})`)
  assert(acc?.role === 'player', `accepting claimed the roster slot → role player (got ${acc?.role})`)
  assert(!!acc?.invite_code && !!acc?.state && acc?.live_round_id === roundId,
    'accept returns join-shaped hydrate fields for scoring entry')

  const mem = sql(`select user_id, role, player_key, slot_player_id from public.live_round_members
                   where live_round_id = '${roundId}' and user_id = '${B.id}'`)
  assert(mem?.length === 1, 'membership row created')
  assert(mem?.[0]?.role === 'player' && mem?.[0]?.slot_player_id === slotB,
    'the membership claims the matching slot (role player ⟺ owns a slot)')

  const joins = sql(`select type, payload from public.live_round_events
                     where live_round_id = '${roundId}' and type = 'player_joined'`)
  assert((joins?.length ?? 0) >= 1, `player_joined event emitted on accept (got ${joins?.length})`)
  assert(joins?.some((e) => e.payload?.role === 'player'),
    'player_joined payload includes role player when slot claimed')

  const { data: aNotifs } = await A.select('notifications', 'select=type,title,message&type=eq.game_invite_responded')
  assert((aNotifs?.length ?? 0) >= 1, 'organizer notified of the response')
  assert(aNotifs?.some((n) => n.title === 'Invite accepted' && /Bob Invitee is in for Tetherow/.test(n.message ?? '')),
    'accept copy is right for Bob')

  const { data: reread } = await B.select('notifications', `select=read_at&id=eq.${inviteNotif.id}`)
  assert(!!reread?.[0]?.read_at, 'the invitee’s own invite notification was marked read')

  // Double-respond must not double-apply, but still returns hydrate fields.
  const { data: dup, error: dupErr } = await B.rpc('respond_game_invite', { p_invite_id: inviteId, p_accept: true })
  assert(!dupErr && dup?.already === true, 'responding twice returns the settled state, not an error')
  assert(!!dup?.invite_code && !!dup?.state, 'already-accepted refresh still returns hydrate fields')

  const { data: pendingAfterAccept } = await B.select('game_invites', 'select=id&status=eq.pending')
  assert((pendingAfterAccept?.length ?? 0) === 0,
    'once answered the invite leaves the pending set (buttons drop away)')

  // Already a member → skipped on a further invite.
  const { data: postJoin } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [B.id] })
  assert(postJoin?.skipped?.[0]?.reason === 'already_member',
    'inviting an existing member is skipped as already_member')

  /* --------------------------------------- viewer then Accept upgrades (E) */
  // Join as viewer (no claim key) via share-link path, then force a pending
  // invite (send_game_invites skips already_member) and Accept to upgrade.
  const inviteCodeRow = sql(`select invite_code from public.live_rounds where id = '${roundId}'`)
  const inviteCode = inviteCodeRow?.[0]?.invite_code
  const { data: joinedE, error: joinEErr } = await E.rpc('join_live_round', {
    p_invite_code: inviteCode, p_claim_player_key: null,
  })
  assert(!joinEErr && joinedE?.role === 'viewer',
    `Eve joined as viewer via share link (got ${joinedE?.role}${joinEErr ? ` / ${joinEErr.message}` : ''})`)
  const eBefore = sql(`select role, slot_player_id from public.live_round_members
                       where live_round_id = '${roundId}' and user_id = '${E.id}'`)
  assert(eBefore?.[0]?.role === 'viewer' && !eBefore?.[0]?.slot_player_id,
    'Eve is a viewer with no slot before Accept')
  const { data: sentE } = await A.rpc('send_game_invites', { p_round_id: roundId, p_invitee_ids: [E.id] })
  assert(sentE?.skipped?.[0]?.reason === 'already_member',
    'inviting an existing viewer is skipped as already_member')
  exec(`insert into public.game_invites (round_id, inviter_id, invitee_id, status)
        values ('${roundId}', '${A.id}', '${E.id}', 'pending')
        on conflict (round_id, invitee_id) do update
          set status = 'pending', responded_at = null`)
  const eInvite = sql(`select id from public.game_invites where round_id = '${roundId}' and invitee_id = '${E.id}'`)
  const eInviteId = eInvite?.[0]?.id
  const { data: eAcc, error: eAccErr } = await E.rpc('respond_game_invite', { p_invite_id: eInviteId, p_accept: true })
  assert(!eAccErr && eAcc?.role === 'player',
    `viewer→player upgrade on Accept (got ${eAcc?.role}${eAccErr ? ` / ${eAccErr.message}` : ''})`)
  const eMem = sql(`select role, slot_player_id from public.live_round_members
                    where live_round_id = '${roundId}' and user_id = '${E.id}'`)
  assert(eMem?.[0]?.role === 'player' && eMem?.[0]?.slot_player_id === slotE,
    'Eve membership upgraded to player with matching slot')
  const eBet = sql(`select status from public.round_betting_acceptances
                    where round_id = '${roundId}' and user_id = '${E.id}'`)
  // Terms are finalized AFTER Eve upgrades in this script — no acceptance yet is OK.
  // Covered separately by reproduce-viewer-upgrade-betting.mjs (terms-first ordering).
  void eBet

  const joinPayloads = sql(`select payload from public.live_round_events
                            where live_round_id = '${roundId}' and type = 'player_joined'`)
  assert(joinPayloads.every((e) => !e.payload?.player_key),
    'player_joined event payloads carry no player_key')

  /* ------------------------------------------------ get_profile_names (0037) */
  const { data: names, error: namesErr } = await A.rpc('get_profile_names', { p_ids: [A.id, B.id, E.id] })
  assert(!namesErr && (names?.length ?? 0) >= 2,
    `get_profile_names returns other players' names${namesErr ? ` (${namesErr.message})` : ''}`)
  assert(names?.some((p) => p.id === B.id && (p.name === 'Bob Invitee' || p.nickname)),
    'organizer can resolve Bob’s display name via get_profile_names')

  /* ------------------------------------------------------- betting terms */
  const terms = { scoringType: 'stroke', scoring: 'net', bets: [{ type: 'nassau', amount: 5 }] }
  const { data: fin, error: finErr } = await A.rpc('finalize_betting_terms', {
    p_round_id: roundId, p_terms: terms, p_max_exposure: null,
  })
  assert(!finErr, `terms finalized${finErr ? ` (${finErr.message})` : ''}`)
  const termsId = fin?.terms_id

  const { data: active1 } = await A.rpc('is_betting_active', { p_round_id: roundId })
  assert(active1 === false, 'bet is not active while acceptances are pending')

  const { data: bBetNotif } = await B.select('notifications', 'select=type&type=eq.betting_terms_requested')
  assert((bBetNotif?.length ?? 0) >= 1,
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

  // D and E also need to accept for the bet to go active (roster players with membership).
  const dAccRow = sql(`select terms_id from public.round_betting_acceptances
                       where round_id = '${roundId}' and user_id = '${D.id}' and status = 'pending'`)
  if (dAccRow?.[0]?.terms_id) {
    await D.rpc('respond_betting_terms', { p_terms_id: dAccRow[0].terms_id, p_accept: true })
  }
  const eAccRow = sql(`select terms_id from public.round_betting_acceptances
                       where round_id = '${roundId}' and user_id = '${E.id}' and status = 'pending'`)
  if (eAccRow?.[0]?.terms_id) {
    await E.rpc('respond_betting_terms', { p_terms_id: eAccRow[0].terms_id, p_accept: true })
  }

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
  assert(!!upcoming?.[0]?.invite_code && upcoming?.[0]?.role === 'player',
    'upcoming game includes invite_code + membership role')
  assert(!JSON.stringify(upcoming ?? []).includes('@golo.test'),
    'my_upcoming_games leaks no contact details')

  const { data: statuses } = await A.rpc('invite_status_for_round', { p_round_id: roundId })
  assert(statuses?.some((s) => s.name === 'Bob Invitee' && s.status === 'accepted'),
    'invite_status_for_round reports Bob’s response')
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
