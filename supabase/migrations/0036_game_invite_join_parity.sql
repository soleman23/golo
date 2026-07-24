-- 0036 — Game-invite join parity: re-invite, viewer→player, player_joined, hydrate.
--
-- Fixes gaps left by 0033 without rewriting that migration:
--   A) Declined/expired/cancelled invites can be re-sent (upsert + inbox bump).
--   B) Accept upgrades an existing viewer to player when a free slot matches.
--   C) Accept emits live_round_events.player_joined like join_live_round.
--   D) Accept (and already-accepted while live) returns join-shaped hydrate fields.
--   E) my_upcoming_games includes invite_code + membership role for the locker.
--
-- Idempotent: CREATE OR REPLACE on the three RPCs + revoke/grant EXECUTE.

-- --------------------------------------------------------------------- send
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
      continue;
    end if;

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
      select 1 from public.profiles p
       where p.id = v_id and coalesce(p.is_active, true) is distinct from true
    ) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name, 'reason', 'inactive');
      continue;
    end if;

    if exists (
      select 1 from public.live_round_members m
       where m.live_round_id = p_round_id and m.user_id = v_id
    ) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name, 'reason', 'already_member');
      continue;
    end if;

    -- New invite, or resurrect declined/expired/cancelled. Pending/accepted stay skipped.
    insert into public.game_invites (round_id, inviter_id, invitee_id, status, responded_at, created_at)
    values (p_round_id, uid, v_id, 'pending', null, now())
    on conflict (round_id, invitee_id) do update
      set inviter_id   = excluded.inviter_id,
          status       = 'pending',
          responded_at = null,
          created_at   = now()
    where public.game_invites.status in ('declined', 'expired', 'cancelled')
    returning id into v_invite_id;

    if v_invite_id is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name, 'reason', 'already_invited');
      continue;
    end if;

    -- Re-invite must resurface the inbox row (same invite UUID → same dedupe_key).
    insert into public.notifications
      (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
    values (
      v_id, 'game_invite_received', 'Game invite',
      v_inviter_name || ' invited you to ' || coalesce(v_course, 'a round'),
      p_round_id, uid, '/notifications',
      jsonb_build_object('invite_id', v_invite_id, 'round_id', p_round_id, 'inviter_name', v_inviter_name),
      'invite:' || v_invite_id::text)
    on conflict (user_id, dedupe_key) where dedupe_key is not null
    do update set
      created_at    = now(),
      read_at       = null,
      title         = excluded.title,
      message       = excluded.message,
      payload       = excluded.payload,
      actor_user_id = excluded.actor_user_id,
      round_id      = excluded.round_id;

    v_invited := v_invited + 1;
  end loop;

  return jsonb_build_object('invited', v_invited, 'skipped', v_skipped);
end;
$$;

-- ------------------------------------------------------------------- respond
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
  v_invite_code    text;
  v_state          jsonb;
  v_key            text;
  v_slot           uuid;
  v_role           text := 'viewer';
  v_prev_role      text;
  v_emit_join      boolean := false;
  v_responder_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Mirror join_live_round: deactivated accounts cannot accept into a live round.
  if exists (
    select 1 from public.profiles p
     where p.id = uid and coalesce(p.is_active, true) is distinct from true
  ) then
    raise exception 'account inactive';
  end if;

  select gi.round_id, gi.inviter_id, gi.status
    into v_round, v_inviter, v_status
    from public.game_invites gi
   where gi.id = p_invite_id and gi.invitee_id = uid
   for update;

  if not found then
    raise exception 'invite not found';
  end if;

  -- Already responded — benign refresh; if accepted + still live, return hydrate fields.
  if v_status <> 'pending' then
    if v_status = 'accepted' then
      select status, course_name, invite_code, state
        into v_round_status, v_course, v_invite_code, v_state
        from public.live_rounds where id = v_round;
      if v_round_status = 'live' then
        select coalesce(m.role, 'viewer') into v_role
          from public.live_round_members m
         where m.live_round_id = v_round and m.user_id = uid;
        return jsonb_build_object(
          'status', 'accepted',
          'already', true,
          'live_round_id', v_round,
          'role', coalesce(v_role, 'viewer'),
          'invite_code', v_invite_code,
          'state', v_state,
          'course_name', v_course
        );
      end if;
    end if;
    return jsonb_build_object('status', v_status, 'already', true);
  end if;

  select status, course_name, invite_code, state
    into v_round_status, v_course, v_invite_code, v_state
    from public.live_rounds where id = v_round;

  if v_round_status is distinct from 'live' then
    update public.game_invites set status = 'expired', responded_at = now()
     where id = p_invite_id;
    return jsonb_build_object('status', 'expired', 'message', 'This game is no longer live.');
  end if;

  if p_accept then
    update public.game_invites set status = 'accepted', responded_at = now()
     where id = p_invite_id;

    select m.role into v_prev_role
      from public.live_round_members m
     where m.live_round_id = v_round and m.user_id = uid;

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
           and m.user_id is distinct from uid
      ) then
        v_slot := null;  -- already claimed by someone else → viewer
      end if;
    end if;

    v_role := case when v_slot is not null then 'player' else 'viewer' end;

    begin
      insert into public.live_round_members (live_round_id, user_id, role, player_key, slot_player_id)
      values (v_round, uid, v_role,
              case when v_slot is not null then v_key else null end, v_slot)
      on conflict (live_round_id, user_id) do update
        set role           = excluded.role,
            player_key     = excluded.player_key,
            slot_player_id = excluded.slot_player_id
      where public.live_round_members.role = 'viewer'
        and excluded.role = 'player'
        and excluded.slot_player_id is not null;
    exception when unique_violation then
      -- Slot claimed in a race with join_live_round / another Accept → viewer.
      v_slot := null;
      v_role := 'viewer';
      insert into public.live_round_members (live_round_id, user_id, role, player_key, slot_player_id)
      values (v_round, uid, 'viewer', null, null)
      on conflict (live_round_id, user_id) do nothing;
    end;

    select coalesce(m.role, v_role) into v_role
      from public.live_round_members m
     where m.live_round_id = v_round and m.user_id = uid;

    v_emit_join := (v_prev_role is null)
      or (v_prev_role = 'viewer' and v_role = 'player');

    if v_emit_join then
      -- role only — never write e:/p: player_key into member-readable events.
      insert into public.live_round_events (live_round_id, type, payload)
      values (v_round, 'player_joined', jsonb_build_object('role', v_role));
    end if;
  else
    update public.game_invites set status = 'declined', responded_at = now()
     where id = p_invite_id;
  end if;

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

  update public.notifications
     set read_at = now()
   where user_id = uid and read_at is null
     and type = 'game_invite_received'
     and payload->>'invite_id' = p_invite_id::text;

  if p_accept then
    return jsonb_build_object(
      'status', 'accepted',
      'live_round_id', v_round,
      'role', v_role,
      'invite_code', v_invite_code,
      'state', v_state,
      'course_name', v_course
    );
  end if;

  return jsonb_build_object('status', 'declined', 'role', v_role);
end;
$$;

-- ----------------------------------------------------------- my_upcoming_games
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
    'invite_code',    lr.invite_code,
    'role', (
      select m.role from public.live_round_members m
       where m.live_round_id = lr.id and m.user_id = uid
       limit 1
    ),
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

-- ------------------------------------ betting enqueue on viewer→player upgrade
-- 0025's trigger is AFTER INSERT only, so Accept upgrading an existing viewer
-- never created a pending acceptance. Fire on role changes too, but only when
-- the member newly becomes a betting participant.
create or replace function public.enqueue_betting_acceptance_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terms_id uuid;
  v_version  integer;
  v_creator  uuid;
begin
  if TG_OP = 'UPDATE' and old.role in ('player', 'scorer') then
    return new;  -- already a betting participant
  end if;

  if new.role not in ('player', 'scorer') then
    return new;
  end if;

  select id, version, created_by into v_terms_id, v_version, v_creator
    from public.round_betting_terms
   where round_id = new.live_round_id and superseded_at is null
   order by version desc
   limit 1;

  if v_terms_id is null then
    return new;
  end if;

  insert into public.round_betting_acceptances (round_id, terms_id, user_id, status, accepted_at)
  values (new.live_round_id, v_terms_id, new.user_id,
          case when new.user_id = v_creator then 'accepted' else 'pending' end,
          case when new.user_id = v_creator then now() else null end)
  on conflict (terms_id, user_id) do nothing;

  if new.user_id <> v_creator then
    insert into public.notifications
      (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
    values (new.user_id, 'betting_terms_requested',
            'Betting terms are ready for review',
            'Review and accept the betting terms for your round.',
            new.live_round_id, v_creator,
            '/betting/' || new.live_round_id::text,
            jsonb_build_object('terms_id', v_terms_id, 'version', v_version),
            'lr:' || new.live_round_id::text || ':betting:' || v_terms_id::text)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists live_member_betting_acceptance on public.live_round_members;
create trigger live_member_betting_acceptance
  after insert or update of role on public.live_round_members
  for each row execute function public.enqueue_betting_acceptance_on_join();

-- --------------------------------------------------------------------- grants
revoke all on function
  public.send_game_invites(uuid, uuid[]),
  public.respond_game_invite(uuid, boolean),
  public.my_upcoming_games(),
  public.enqueue_betting_acceptance_on_join()
from public, anon, authenticated;

grant execute on function
  public.send_game_invites(uuid, uuid[]),
  public.respond_game_invite(uuid, boolean),
  public.my_upcoming_games()
to authenticated;

do $$
begin
  raise notice 'DONE — game invite join parity (0036) applied.';
end $$;
