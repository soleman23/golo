-- 0009: Live rounds — functions, RLS, Realtime.
--
-- If you already created public.live_rounds (Step A), DO NOT re-run the table section
-- (lines 14–65). Use supabase/scripts/live_rounds_finish.sql OR run from line 67 onward.
--
-- Full fresh install: run entire file (uses CREATE TABLE IF NOT EXISTS for live_rounds).

-- ------------------------------------------------------------------ cleanup (policies before functions — policies depend on is_live_member)
drop policy if exists live_events_select on public.live_round_events;
drop policy if exists live_members_insert_self on public.live_round_members;
drop policy if exists live_members_select on public.live_round_members;
drop policy if exists live_rounds_update_scorer on public.live_rounds;
drop policy if exists live_rounds_select_member on public.live_rounds;

drop function if exists public.fetch_claimable_live_rounds();
drop function if exists public.peek_live_round(text);
drop function if exists public.complete_live_round(uuid);
drop function if exists public.patch_live_round(uuid, jsonb, text, jsonb);
drop function if exists public.join_live_round(text, text);
drop function if exists public.start_live_round(uuid, jsonb, text);
drop function if exists public.is_live_member(uuid);
drop function if exists public.is_live_scorer(uuid);

-- ------------------------------------------------------------------ tables (live_rounds must already exist — do not recreate here)
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regclass('public.live_rounds') is null then
    raise exception 'public.live_rounds missing. Run 0008_live_rounds.sql or Step A CREATE TABLE first.';
  end if;
end $$;

create table if not exists public.live_round_members (
  id              uuid primary key default extensions.gen_random_uuid(),
  live_round_id   uuid not null references public.live_rounds (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('scorer', 'player', 'viewer')),
  player_key      text,
  slot_player_id  uuid,
  joined_at       timestamptz not null default now(),
  unique (live_round_id, user_id)
);

create index if not exists live_members_round_idx on public.live_round_members (live_round_id);
create index if not exists live_members_user_idx on public.live_round_members (user_id);
create unique index if not exists live_members_slot_key_idx
  on public.live_round_members (live_round_id, player_key)
  where player_key is not null;

create table if not exists public.live_round_events (
  id              uuid primary key default extensions.gen_random_uuid(),
  live_round_id   uuid not null references public.live_rounds (id) on delete cascade,
  type            text not null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists live_events_round_idx on public.live_round_events (live_round_id, created_at desc);

-- ------------------------------------------------------------------ helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.player_key_from_player_json(p jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p->>'guest', 'false') = 'true' then null
    when nullif(lower(trim(p->>'email')), '') is not null
      then 'e:' || lower(trim(p->>'email'))
    when length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) >= 7
      then 'p:' || regexp_replace(p->>'phone', '\D', '', 'g')
    when nullif(lower(trim(p->>'name')), '') is not null
      then 'n:' || lower(trim(p->>'name'))
    else null
  end;
$$;

-- Dynamic SQL so CREATE FUNCTION succeeds even if the editor reorders statements
create or replace function public.is_live_scorer(lrid uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  found boolean;
begin
  execute $q$
    select exists (
      select 1 from public.live_rounds
      where id = $1 and scorer_user_id = auth.uid() and status = 'live'
    )
  $q$ into found using lrid;
  return coalesce(found, false);
end;
$$;

create or replace function public.is_live_member(lrid uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  found boolean;
begin
  execute $q$
    select exists (
      select 1 from public.live_round_members
      where live_round_id = $1 and user_id = auth.uid()
    )
  $q$ into found using lrid;
  return coalesce(found, false);
end;
$$;

-- ------------------------------------------------------------------------ RPCs
create or replace function public.start_live_round(
  p_round_id uuid,
  p_state jsonb,
  p_course_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.live_rounds where id = p_round_id) then
    if not exists (
      select 1 from public.live_rounds
       where id = p_round_id and owner_id = uid and status = 'live'
    ) then
      raise exception 'live round already exists';
    end if;
    select invite_code into code from public.live_rounds where id = p_round_id;
    return jsonb_build_object('id', p_round_id, 'invite_code', code);
  end if;

  loop
    code := public.gen_invite_code();
    exit when not exists (select 1 from public.live_rounds where invite_code = code);
    attempts := attempts + 1;
    if attempts > 12 then
      raise exception 'could not generate invite code';
    end if;
  end loop;

  insert into public.live_rounds (id, owner_id, scorer_user_id, invite_code, status, state, course_name)
  values (p_round_id, uid, uid, code, 'live', p_state, p_course_name);

  insert into public.live_round_members (live_round_id, user_id, role)
  values (p_round_id, uid, 'scorer');

  insert into public.live_round_events (live_round_id, type, payload)
  values (p_round_id, 'round_started', jsonb_build_object('course_name', p_course_name));

  return jsonb_build_object('id', p_round_id, 'invite_code', code);
end;
$$;

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
begin
  if uid is null then
    raise exception 'not authenticated';
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
    select (elem->>'id')::uuid, public.player_key_from_player_json(elem)
      into slot_id, slot_key
      from jsonb_array_elements(lr_state->'players') elem
     where public.player_key_from_player_json(elem) = trim(p_claim_player_key)
     limit 1;

    if slot_id is not null then
      if exists (
        select 1 from public.live_round_members
        where live_round_id = lr_id and player_key = slot_key
      ) then
        raise exception 'slot already claimed';
      end if;
      member_role := 'player';
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

create or replace function public.patch_live_round(
  p_id uuid,
  p_state jsonb,
  p_event_type text default null,
  p_event_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_live_scorer(p_id) then
    raise exception 'not authorized to patch live round';
  end if;

  update public.live_rounds
     set state = p_state
   where id = p_id and status = 'live';

  if p_event_type is not null and length(trim(p_event_type)) > 0 then
    insert into public.live_round_events (live_round_id, type, payload)
    values (p_id, trim(p_event_type), coalesce(p_event_payload, '{}'::jsonb));
  end if;
end;
$$;

create or replace function public.complete_live_round(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_live_scorer(p_id) then
    raise exception 'not authorized to complete live round';
  end if;

  update public.live_rounds
     set status = 'complete'
   where id = p_id;

  insert into public.live_round_events (live_round_id, type, payload)
  values (p_id, 'round_finished', '{}'::jsonb);
end;
$$;

create or replace function public.peek_live_round(p_invite_code text)
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
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select id, invite_code, state, course_name
    into lr_id, lr_invite, lr_state, lr_course
    from public.live_rounds
   where upper(invite_code) = upper(trim(p_invite_code))
     and status = 'live';

  if lr_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'live_round_id', lr_id,
    'course_name', lr_course,
    'invite_code', lr_invite,
    'state', lr_state,
    'already_member', exists (
      select 1 from public.live_round_members m
      where m.live_round_id = lr_id and m.user_id = uid
    ),
    'member_role', (
      select m.role from public.live_round_members m
      where m.live_round_id = lr_id and m.user_id = uid
      limit 1
    )
  );
end;
$$;

create or replace function public.fetch_claimable_live_rounds()
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof public.profiles%rowtype;
  my_key text;
begin
  if uid is null then return; end if;

  select * into prof from public.profiles where id = uid;
  if prof is null then return; end if;

  my_key := public.player_key_from_player_json(
    jsonb_build_object(
      'email', prof.email,
      'phone', prof.phone,
      'name', prof.name,
      'guest', false
    )
  );

  if my_key is null then return; end if;

  return query
  select jsonb_build_object(
    'live_round_id', lr.id,
    'invite_code', lr.invite_code,
    'course_name', lr.course_name,
    'started_at', lr.started_at,
    'player_key', my_key,
    'slot_player_id', (elem->>'id')
  )
  from public.live_rounds lr
  cross join lateral jsonb_array_elements(lr.state->'players') elem
  where lr.status = 'live'
    and public.player_key_from_player_json(elem) = my_key
    and not exists (
      select 1 from public.live_round_members m
      where m.live_round_id = lr.id and m.player_key = my_key
    )
    and not exists (
      select 1 from public.live_round_members m
      where m.live_round_id = lr.id and m.user_id = uid
    );
end;
$$;

-- --------------------------------------------------------------------- RLS
alter table public.live_rounds enable row level security;
alter table public.live_round_members enable row level security;
alter table public.live_round_events enable row level security;

drop policy if exists live_rounds_select_member on public.live_rounds;
create policy live_rounds_select_member on public.live_rounds
  for select using (public.is_live_member(id) or owner_id = auth.uid());

drop policy if exists live_rounds_update_scorer on public.live_rounds;
create policy live_rounds_update_scorer on public.live_rounds
  for update using (scorer_user_id = auth.uid()) with check (scorer_user_id = auth.uid());

drop policy if exists live_members_select on public.live_round_members;
create policy live_members_select on public.live_round_members
  for select using (public.is_live_member(live_round_id) or user_id = auth.uid());

drop policy if exists live_members_insert_self on public.live_round_members;
create policy live_members_insert_self on public.live_round_members
  for insert with check (user_id = auth.uid());

drop policy if exists live_events_select on public.live_round_events;
create policy live_events_select on public.live_round_events
  for select using (public.is_live_member(live_round_id));

drop trigger if exists live_rounds_set_updated_at on public.live_rounds;
create trigger live_rounds_set_updated_at
  before update on public.live_rounds
  for each row execute function public.set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.live_rounds;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_round_events;
exception when duplicate_object then null;
end $$;

grant execute on function public.start_live_round(uuid, jsonb, text) to authenticated;
grant execute on function public.join_live_round(text, text) to authenticated;
grant execute on function public.patch_live_round(uuid, jsonb, text, jsonb) to authenticated;
grant execute on function public.complete_live_round(uuid) to authenticated;
grant execute on function public.peek_live_round(text) to authenticated;
grant execute on function public.fetch_claimable_live_rounds() to authenticated;

do $$
begin
  raise notice 'DONE — live rounds migration applied successfully.';
end $$;
