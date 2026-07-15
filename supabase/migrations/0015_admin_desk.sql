-- Commissioner's Desk: soft-deactivate players, desk stats, profile + live admin RPCs.
-- Run after 0013_complete_live_round_any_member.sql. Re-runnable for development.

alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------- admin_me
-- Extend to return identity for the desk header pill.
drop function if exists public.admin_me();
create function public.admin_me()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles%rowtype;
begin
  if uid is null then
    return jsonb_build_object('is_admin', false);
  end if;

  select * into row from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('is_admin', false);
  end if;

  return jsonb_build_object(
    'is_admin', coalesce(row.is_admin, false),
    'email', row.email,
    'name', row.name
  );
end;
$$;

grant execute on function public.admin_me() to authenticated;

-- ----------------------------------------------------------- desk stats
drop function if exists public.admin_desk_stats();
create function public.admin_desk_stats()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  active_players bigint;
  admin_count bigint;
  rounds_posted bigint;
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  select count(*) into active_players
    from public.profiles
   where onboarded = true
     and is_active = true;

  select count(*) into admin_count
    from public.profiles
   where is_admin = true;

  select count(*) into rounds_posted
    from public.rounds;

  return jsonb_build_object(
    'active_players', active_players,
    'admin_count', admin_count,
    'admin_seats_cap', 2,
    'rounds_posted', rounds_posted
  );
end;
$$;

grant execute on function public.admin_desk_stats() to authenticated;

-- ------------------------------------------------------ list profiles
drop function if exists public.admin_list_profiles(text, int, int);
create function public.admin_list_profiles(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(p_search, '')));
  q_esc text;
  lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  off int := greatest(0, coalesce(p_offset, 0));
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if length(q) > 0 then
    q_esc := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  return query
  select jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'name', p.name,
    'nickname', p.nickname,
    'phone', p.phone,
    'home_club', p.home_club,
    'handicap_index', p.handicap_index,
    'is_admin', p.is_admin,
    'is_active', p.is_active,
    'onboarded', p.onboarded,
    'ghin_number', p.ghin_number,
    'ghin_connected_at', p.ghin_connected_at,
    'created_at', p.created_at,
    'round_count', (
      select count(*)::int
        from public.round_participants rp
       where rp.user_id = p.id
    )
  )
  from public.profiles p
  where (
    length(q) = 0
    or lower(coalesce(p.name, '')) like '%' || q_esc || '%' escape '\'
    or lower(coalesce(p.nickname, '')) like '%' || q_esc || '%' escape '\'
    or lower(coalesce(p.email, '')) like '%' || q_esc || '%' escape '\'
    or lower(coalesce(p.home_club, '')) like '%' || q_esc || '%' escape '\'
  )
  order by p.is_admin desc, p.name nulls last, p.created_at desc
  limit lim
  offset off;
end;
$$;

grant execute on function public.admin_list_profiles(text, int, int) to authenticated;

-- ------------------------------------------------------- get profile
drop function if exists public.admin_get_profile(uuid);
create function public.admin_get_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if p_user_id is null then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'name', p.name,
      'nickname', p.nickname,
      'phone', p.phone,
      'home_club', p.home_club,
      'venmo', p.venmo,
      'handicap_index', p.handicap_index,
      'is_admin', p.is_admin,
      'is_active', p.is_active,
      'onboarded', p.onboarded,
      'ghin_number', p.ghin_number,
      'ghin_connected_at', p.ghin_connected_at,
      'ghin_last_sync_at', p.ghin_last_sync_at,
      'ghin_sync', p.ghin_sync,
      'notify_live', p.notify_live,
      'notify_settle', p.notify_settle,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'round_count', (
        select count(*)::int
          from public.round_participants rp
         where rp.user_id = p.id
      ),
      'rounds_owned', (
        select count(*)::int
          from public.rounds r
         where r.owner_id = p.id
      )
    )
    from public.profiles p
    where p.id = p_user_id
  );
end;
$$;

grant execute on function public.admin_get_profile(uuid) to authenticated;

-- ---------------------------------------------------- update profile
drop function if exists public.admin_update_profile(uuid, jsonb);
create function public.admin_update_profile(
  p_user_id uuid,
  p_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fields jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile not found';
  end if;

  -- Whitelist only: handicap_index, is_active, name, nickname.
  update public.profiles
     set name = case
           when fields ? 'name' then nullif(trim(fields ->> 'name'), '')
           else name
         end,
         nickname = case
           when fields ? 'nickname' then nullif(trim(fields ->> 'nickname'), '')
           else nickname
         end,
         handicap_index = case
           when fields ? 'handicap_index' then
             case
               when fields ->> 'handicap_index' is null
                    or nullif(trim(fields ->> 'handicap_index'), '') is null
                 then null
               else (fields ->> 'handicap_index')::numeric
             end
           else handicap_index
         end,
         is_active = case
           when fields ? 'is_active' then coalesce((fields ->> 'is_active')::boolean, true)
           else is_active
         end,
         updated_at = now()
   where id = p_user_id;

  return public.admin_get_profile(p_user_id);
end;
$$;

grant execute on function public.admin_update_profile(uuid, jsonb) to authenticated;

-- ------------------------------------------------- list live rounds
drop function if exists public.admin_list_live_rounds(text);
create function public.admin_list_live_rounds(p_status text default 'live')
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  st text := lower(trim(coalesce(p_status, 'live')));
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if st not in ('live', 'complete', 'all') then
    st := 'live';
  end if;

  return query
  select jsonb_build_object(
    'id', lr.id,
    'invite_code', lr.invite_code,
    'course_name', lr.course_name,
    'status', lr.status,
    'scorer_user_id', lr.scorer_user_id,
    'scorer_name', sp.name,
    'scorer_email', sp.email,
    'owner_id', lr.owner_id,
    'member_count', (
      select count(*)::int
        from public.live_round_members m
       where m.live_round_id = lr.id
    ),
    'started_at', lr.started_at,
    'updated_at', lr.updated_at
  )
  from public.live_rounds lr
  left join public.profiles sp on sp.id = lr.scorer_user_id
  where st = 'all' or lr.status = st
  order by lr.started_at desc
  limit 100;
end;
$$;

grant execute on function public.admin_list_live_rounds(text) to authenticated;

-- ------------------------------------------ force complete live round
drop function if exists public.admin_force_complete_live_round(uuid);
create function public.admin_force_complete_live_round(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if p_id is null then
    raise exception 'live_round_id required';
  end if;

  update public.live_rounds
     set status = 'complete'
   where id = p_id
     and status = 'live';

  if found then
    insert into public.live_round_events (live_round_id, type, payload)
    values (p_id, 'round_finished', jsonb_build_object('forced_by_admin', true));
  end if;
end;
$$;

grant execute on function public.admin_force_complete_live_round(uuid) to authenticated;

-- -------------------------------------- gate join for inactive players
create or replace function public.join_live_round(
  p_invite_code text,
  p_claim_player_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lr_id uuid;
  lr_invite text;
  lr_state jsonb;
  lr_course text;
  slot_id uuid;
  slot_key text;
  member_role text;
  caller_active boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(is_active, true) into caller_active
    from public.profiles
   where id = uid;

  if caller_active is distinct from true then
    raise exception 'account inactive';
  end if;

  select id, invite_code, state, course_name
    into lr_id, lr_invite, lr_state, lr_course
    from public.live_rounds
   where upper(invite_code) = upper(trim(p_invite_code))
     and status = 'live';

  if lr_id is null then
    raise exception 'live round not found';
  end if;

  if exists (
    select 1 from public.live_round_members
    where live_round_id = lr_id and user_id = uid
  ) then
    return (
      select jsonb_build_object(
        'live_round_id', m.live_round_id,
        'role', m.role,
        'invite_code', lr_invite,
        'state', lr_state,
        'course_name', lr_course,
        'already_member', true
      )
      from public.live_round_members m
      where m.live_round_id = lr_id and m.user_id = uid
    );
  end if;

  member_role := 'viewer';
  slot_id := null;
  slot_key := null;

  if p_claim_player_key is not null and length(trim(p_claim_player_key)) > 0 then
    select public.player_key_from_player_json(
             jsonb_build_object('email', email, 'phone', phone, 'name', name, 'guest', false)
           )
      into slot_key
      from public.profiles
     where id = uid;

    if slot_key is not null then
      select s.slot_id
        into slot_id
        from public.live_round_slots s
       where s.live_round_id = lr_id and s.player_key = slot_key
       limit 1;

      if slot_id is not null then
        if exists (
          select 1 from public.live_round_members
          where live_round_id = lr_id and player_key = slot_key
        ) then
          raise exception 'slot already claimed';
        end if;
        member_role := 'player';
      else
        slot_key := null;
      end if;
    end if;
  end if;

  insert into public.live_round_members (live_round_id, user_id, role, player_key, slot_player_id)
  values (lr_id, uid, member_role, slot_key, slot_id);

  insert into public.live_round_events (live_round_id, type, payload)
  values (
    lr_id,
    'player_joined',
    jsonb_build_object('role', member_role, 'player_key', slot_key)
  );

  return jsonb_build_object(
    'live_round_id', lr_id,
    'role', member_role,
    'invite_code', lr_invite,
    'state', lr_state,
    'course_name', lr_course,
    'player_key', slot_key,
    'slot_player_id', slot_id
  );
end;
$$;

grant execute on function public.join_live_round(text, text) to authenticated;

-- -------------------------------- exclude inactive from player search
create or replace function public.search_verified_players(
  p_query text,
  p_limit int default 20
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  q text := lower(trim(coalesce(p_query, '')));
  q_esc text;
  q_digits text := regexp_replace(q, '\D', '', 'g');
  lim int := greatest(1, least(coalesce(p_limit, 20), 25));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if length(q) < 2 then
    return;
  end if;

  q_esc := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'nickname', p.nickname,
    'handicap_index', p.handicap_index,
    'email_masked', public.mask_email(p.email),
    'phone_masked', public.mask_phone(p.phone),
    'has_email', nullif(trim(p.email), '') is not null,
    'has_phone', nullif(trim(p.phone), '') is not null
  )
  from public.profiles p
  where p.id != uid
    and p.onboarded = true
    and coalesce(p.is_active, true) = true
    and (
      nullif(trim(p.email), '') is not null
      or nullif(trim(p.phone), '') is not null
    )
    and (
      lower(coalesce(p.name, '')) like '%' || q_esc || '%' escape '\'
      or lower(coalesce(p.nickname, '')) like '%' || q_esc || '%' escape '\'
      or lower(coalesce(p.email, '')) like '%' || q_esc || '%' escape '\'
      or (length(q_digits) >= 3 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || q_digits || '%')
    )
  order by p.name nulls last, p.nickname nulls last
  limit lim;
end;
$$;

grant execute on function public.search_verified_players(text, int) to authenticated;

create or replace function public.get_player_contact(p_id uuid)
returns jsonb
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

  return (
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'nickname', p.nickname,
      'email', p.email,
      'phone', p.phone,
      'handicap_index', p.handicap_index
    )
    from public.profiles p
    where p.id = p_id
      and p.id != uid
      and p.onboarded = true
      and coalesce(p.is_active, true) = true
  );
end;
$$;

grant execute on function public.get_player_contact(uuid) to authenticated;
