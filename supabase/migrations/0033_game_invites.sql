-- 0033 — Player-to-player game invites (Flow A) + betting-terms review comment.
--
-- Requires 0022–0025 (notifications, push delivery, betting terms). Adds a second
-- entry path into a live round alongside the existing share-link / invite-code
-- join: the organizer sends direct invites to VERIFIED players, who Accept or
-- Deny from their in-app inbox.
--
-- Security model matches the live-rounds RPCs + the 0020 grant hardening:
--   * The browser NEVER inserts a notification or a game_invite. Rows are created
--     only by the SECURITY DEFINER RPCs below (which run as the function owner and
--     bypass RLS). Clients read their own invites via the game_invites_select_party
--     policy; every write goes through a checked RPC.
--   * respond_game_invite only ever touches auth.uid()'s own invite — nobody can
--     respond for another user (mirrors respond_betting_terms).
--   * Accepting reuses join_live_round's server-side key derivation, so the
--     invariant "role 'player' ⟺ owns a scorecard slot" holds. The 0025
--     late-joiner trigger then creates the pending betting acceptance for free.
--
-- Also closes two 0025 gaps: respond_betting_terms now (a) notifies the terms
-- creator on every response and (b) carries an optional review comment.
--
-- Idempotent: IF NOT EXISTS, drop-then-recreate policies/functions. Must run
-- after 0025 (it redefines notif_category + respond_betting_terms).

-- ---------------------------------------------------------------- game_invites
-- One durable invite per (round, invitee). The two parties read it; all writes
-- go through the RPCs. status lifecycle: pending → accepted | declined | expired
-- (round no longer live) | cancelled (reserved for a future organizer action).
create table if not exists public.game_invites (
  id           uuid primary key default extensions.gen_random_uuid(),
  round_id     uuid not null references public.live_rounds (id) on delete cascade,
  inviter_id   uuid not null references auth.users (id) on delete cascade,
  invitee_id   uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (round_id, invitee_id)
);

create index if not exists game_invites_invitee_idx
  on public.game_invites (invitee_id, created_at desc);
create index if not exists game_invites_round_idx
  on public.game_invites (round_id);

alter table public.game_invites enable row level security;

-- Only the two parties can read an invite directly. Round members read each
-- other's invite STATUS (no contact fields) through invite_status_for_round.
drop policy if exists game_invites_select_party on public.game_invites;
create policy game_invites_select_party on public.game_invites
  for select to authenticated
  using (invitee_id = auth.uid() or inviter_id = auth.uid());
-- No insert/update/delete policy — all writes via the SECURITY DEFINER RPCs.

-- ---------------------------------------------- notification category wiring
-- Redefine notif_category carrying ALL existing cases (0025's version is
-- current) + the two invite types. Dropping any existing case here would
-- silently regress its category (e.g. betting → the generic fallback).
create or replace function public.notif_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'score_updated'           then 'live_score'
    when 'hole_changed'            then 'live_score'
    when 'side_game_flagged'       then 'game_changes'
    when 'player_joined'           then 'game_changes'
    when 'round_finished'          then 'settle'
    when 'betting_terms_requested' then 'betting'
    when 'betting_terms_responded' then 'betting'
    when 'game_invite_received'    then 'game_changes'
    when 'game_invite_responded'   then 'game_changes'
    else 'game_changes'
  end;
$$;

-- --------------------------------------------------------------------- RPCs
-- Send direct invites to verified players. Caller must be the round's
-- owner/scorer and the round must be live. Skips (never errors on) anyone who
-- isn't verified, is already a member, or is already invited — returning them in
-- `skipped` so the client can say "3 invited · 1 already in the game".
create or replace function public.send_game_invites(
  p_round_id uuid,
  p_invitee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_course       text;
  v_inviter_name text;
  v_invited      int := 0;
  v_skipped      jsonb := '[]'::jsonb;
  v_id           uuid;
  v_invite_id    uuid;
  v_name         text;
  v_verified     boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select course_name into v_course
    from public.live_rounds
   where id = p_round_id and status = 'live' and (owner_id = uid or scorer_user_id = uid);
  if not found then
    raise exception 'not authorized to invite for this round';
  end if;

  select coalesce(nullif(trim(name), ''), nullif(trim(nickname), ''), 'A player')
    into v_inviter_name from public.profiles where id = uid;

  foreach v_id in array coalesce(p_invitee_ids, array[]::uuid[]) loop
    if v_id = uid then
      continue;  -- never invite yourself
    end if;

    -- Verified predicate — mirrors search_verified_players (0011): onboarded and
    -- reachable by email or phone.
    select coalesce(nullif(trim(p.name), ''), nullif(trim(p.nickname), ''), 'A player'),
           (p.onboarded = true
             and (nullif(trim(p.email), '') is not null or nullif(trim(p.phone), '') is not null))
      into v_name, v_verified
      from public.profiles p where p.id = v_id;

    if not found or not coalesce(v_verified, false) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not_verified');
      continue;
    end if;

    if exists (
      select 1 from public.live_round_members m
       where m.live_round_id = p_round_id and m.user_id = v_id
    ) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name, 'reason', 'already_member');
      continue;
    end if;

    insert into public.game_invites (round_id, inviter_id, invitee_id)
    values (p_round_id, uid, v_id)
    on conflict (round_id, invitee_id) do nothing
    returning id into v_invite_id;

    if v_invite_id is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name, 'reason', 'already_invited');
      continue;
    end if;

    -- One durable inbox row. No email/phone in the payload — mirrors the 0023
    -- fan-out's PII stripping.
    insert into public.notifications
      (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
    values (
      v_id, 'game_invite_received', 'Game invite',
      v_inviter_name || ' invited you to ' || coalesce(v_course, 'a round'),
      p_round_id, uid, '/notifications',
      jsonb_build_object('invite_id', v_invite_id, 'round_id', p_round_id, 'inviter_name', v_inviter_name),
      'invite:' || v_invite_id::text)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

    v_invited := v_invited + 1;
  end loop;

  return jsonb_build_object('invited', v_invited, 'skipped', v_skipped);
end;
$$;

-- Accept or decline an invite — only ever the caller's own. Accepting joins the
-- round via the same key derivation as join_live_round; either outcome notifies
-- the organizer.
create or replace function public.respond_game_invite(
  p_invite_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_round          uuid;
  v_inviter        uuid;
  v_status         text;
  v_round_status   text;
  v_course         text;
  v_key            text;
  v_slot           uuid;
  v_role           text := 'viewer';
  v_responder_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the invite so a double-tap across two devices can't double-apply.
  select gi.round_id, gi.inviter_id, gi.status
    into v_round, v_inviter, v_status
    from public.game_invites gi
   where gi.id = p_invite_id and gi.invitee_id = uid
   for update;

  if not found then
    raise exception 'invite not found';
  end if;

  -- Already responded (another device won the race) — treat as a benign refresh.
  if v_status <> 'pending' then
    return jsonb_build_object('status', v_status, 'already', true);
  end if;

  select status, course_name into v_round_status, v_course
    from public.live_rounds where id = v_round;

  -- Round finished/removed before they answered — expire the invite.
  if v_round_status is distinct from 'live' then
    update public.game_invites set status = 'expired', responded_at = now()
     where id = p_invite_id;
    return jsonb_build_object('status', 'expired', 'message', 'This game is no longer live.');
  end if;

  if p_accept then
    update public.game_invites set status = 'accepted', responded_at = now()
     where id = p_invite_id;

    -- Derive the caller's key from their OWN profile (never trust the wire), then
    -- claim the matching roster slot. Slot taken by someone else → fall back to
    -- viewer (never raise, or Accept would fail outright).
    select public.player_key_from_player_json(
             jsonb_build_object('email', email, 'phone', phone, 'name', name, 'guest', false))
      into v_key from public.profiles where id = uid;

    if v_key is not null then
      select s.slot_id into v_slot
        from public.live_round_slots s
       where s.live_round_id = v_round and s.player_key = v_key
       limit 1;

      if v_slot is not null and exists (
        select 1 from public.live_round_members m
         where m.live_round_id = v_round and m.player_key = v_key
      ) then
        v_slot := null;  -- already claimed → viewer
      end if;
    end if;

    v_role := case when v_slot is not null then 'player' else 'viewer' end;

    insert into public.live_round_members (live_round_id, user_id, role, player_key, slot_player_id)
    values (v_round, uid, v_role,
            case when v_slot is not null then v_key else null end, v_slot)
    on conflict (live_round_id, user_id) do nothing;
    -- The 0025 live_member_betting_acceptance trigger now creates the pending
    -- acceptance + notification if terms already exist. No extra code here.
  else
    update public.game_invites set status = 'declined', responded_at = now()
     where id = p_invite_id;
  end if;

  -- Notify the organizer either way (the note's "goes back to the player who
  -- requested it, saying they are not available").
  select coalesce(nullif(trim(name), ''), nullif(trim(nickname), ''), 'A player')
    into v_responder_name from public.profiles where id = uid;

  insert into public.notifications
    (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
  values (
    v_inviter, 'game_invite_responded',
    case when p_accept then 'Invite accepted' else 'Not available' end,
    case when p_accept
      then v_responder_name || ' is in for ' || coalesce(v_course, 'your round')
      else v_responder_name || ' can''t make ' || coalesce(v_course, 'your round') end,
    v_round, uid, '/notifications',
    jsonb_build_object('invite_id', p_invite_id, 'round_id', v_round,
                       'responder_name', v_responder_name, 'accepted', p_accept),
    'invite-resp:' || p_invite_id::text)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  -- Clear the invitee's own invite notification so accepting from a deep link
  -- drops the unread badge.
  update public.notifications
     set read_at = now()
   where user_id = uid and read_at is null
     and type = 'game_invite_received'
     and payload->>'invite_id' = p_invite_id::text;

  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'role', v_role);
end;
$$;

-- Non-sensitive invite roster for the organizer's "who's in" list + the
-- betting-terms readiness banner. Any round member may call it; returns no
-- email/phone (mirrors peek_live_round's redaction).
create or replace function public.invite_status_for_round(p_round_id uuid)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_live_member(p_round_id) then
    raise exception 'not a member of this round';
  end if;

  return query
  select jsonb_build_object(
    'invitee_id',   gi.invitee_id,
    'name',         coalesce(nullif(trim(p.name), ''), nullif(trim(p.nickname), ''), 'Player'),
    'status',       gi.status,
    'responded_at', gi.responded_at
  )
  from public.game_invites gi
  join public.profiles p on p.id = gi.invitee_id
  where gi.round_id = p_round_id
  order by gi.created_at asc;
end;
$$;

-- The locker's "Upcoming games": rounds I accepted an invite to, or where I'm a
-- member still owing a betting acceptance. Carries the terms status so the card
-- renders its pill in one round-trip.
create or replace function public.my_upcoming_games()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  return query
  with mine as (
    select gi.round_id from public.game_invites gi
     where gi.invitee_id = uid and gi.status = 'accepted'
    union
    select a.round_id
      from public.round_betting_acceptances a
      join public.round_betting_terms t on t.id = a.terms_id
     where a.user_id = uid and a.status = 'pending' and t.superseded_at is null
  )
  select jsonb_build_object(
    'round_id',       lr.id,
    'course_name',    lr.course_name,
    'status',         lr.status,
    'organizer_name', coalesce(nullif(trim(op.name), ''), nullif(trim(op.nickname), ''), 'Organizer'),
    'started_at',     lr.started_at,
    'has_terms', exists (
      select 1 from public.round_betting_terms t
       where t.round_id = lr.id and t.superseded_at is null
    ),
    'terms_status', (
      select a.status
        from public.round_betting_acceptances a
        join public.round_betting_terms t on t.id = a.terms_id
       where a.round_id = lr.id and a.user_id = uid and t.superseded_at is null
       order by t.version desc
       limit 1
    )
  )
  from mine
  join public.live_rounds lr on lr.id = mine.round_id
  join public.profiles op on op.id = lr.owner_id
  where lr.status = 'live'
  order by lr.started_at desc;
end;
$$;

-- ------------------------------------------ betting-terms response (rewrite)
-- Close 0025 gaps #3 (organizer never told about responses) and #4 (no review
-- comment). New three-arg signature; two-arg PostgREST calls still resolve via
-- the p_comment default. Drop the old signature first.
alter table public.round_betting_acceptances
  add column if not exists decline_comment text;

drop function if exists public.respond_betting_terms(uuid, boolean);

create or replace function public.respond_betting_terms(
  p_terms_id uuid,
  p_accept boolean,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_round          uuid;
  v_creator        uuid;
  v_version        integer;
  v_responder_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select round_id, created_by, version
    into v_round, v_creator, v_version
    from public.round_betting_terms
   where id = p_terms_id and superseded_at is null;
  if v_round is null then
    raise exception 'betting terms not found or superseded';
  end if;

  update public.round_betting_acceptances
     set status          = case when p_accept then 'accepted' else 'declined' end,
         accepted_at     = case when p_accept then now() else accepted_at end,
         declined_at     = case when p_accept then declined_at else now() end,
         decline_comment = case when p_accept then null else p_comment end
   where terms_id = p_terms_id and user_id = uid;

  if not found then
    raise exception 'not a betting participant for these terms';
  end if;

  -- Notify the terms creator (organizer). Defensive: never self-notify.
  if v_creator is not null and v_creator <> uid then
    select coalesce(nullif(trim(name), ''), nullif(trim(nickname), ''), 'A player')
      into v_responder_name from public.profiles where id = uid;

    insert into public.notifications
      (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
    values (
      v_creator, 'betting_terms_responded',
      case when p_accept then 'Terms accepted' else 'Terms sent back for review' end,
      case when p_accept
        then v_responder_name || ' accepted the betting terms.'
        else v_responder_name || ' asked you to review the betting terms.'
             || case when nullif(trim(coalesce(p_comment, '')), '') is not null
                     then ' “' || trim(p_comment) || '”' else '' end
      end,
      v_round, uid, '/betting/' || v_round::text,
      jsonb_build_object('terms_id', p_terms_id, 'version', v_version,
                         'responder_name', v_responder_name, 'comment', p_comment, 'accepted', p_accept),
      'lr:' || v_round::text || ':betting-resp:' || p_terms_id::text || ':' || uid::text)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;
end;
$$;

-- --------------------------------------------------------------------- grants
-- Client RPCs → authenticated. notif_category stays internal (trigger-only), so
-- it is re-revoked here to keep the 0020 posture explicit after create-or-replace.
revoke all on function
  public.send_game_invites(uuid, uuid[]),
  public.respond_game_invite(uuid, boolean),
  public.invite_status_for_round(uuid),
  public.my_upcoming_games(),
  public.respond_betting_terms(uuid, boolean, text),
  public.notif_category(text)
from public, anon, authenticated;

grant execute on function
  public.send_game_invites(uuid, uuid[]),
  public.respond_game_invite(uuid, boolean),
  public.invite_status_for_round(uuid),
  public.my_upcoming_games(),
  public.respond_betting_terms(uuid, boolean, text)
to authenticated;

do $$
begin
  raise notice 'DONE — game invites + betting-response notify/comment (0033) applied.';
end $$;
