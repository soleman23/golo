-- 0010 — Live scorer auth: static is_live_scorer, explicit auth check on patch,
-- allow owner OR scorer to re-register an existing live round.
-- Run in Supabase SQL editor after 0008 + 0009.

create or replace function public.is_live_scorer(lrid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.live_rounds
     where id = lrid
       and status = 'live'
       and (scorer_user_id = auth.uid() or owner_id = auth.uid())
  );
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

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

create or replace function public.start_live_round(
  p_round_id uuid,
  p_state jsonb,
  p_roster jsonb default '[]'::jsonb,
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
       where id = p_round_id
         and status = 'live'
         and (owner_id = uid or scorer_user_id = uid)
    ) then
      raise exception 'live round already exists';
    end if;
    update public.live_rounds
       set state = p_state,
           scorer_user_id = uid,
           course_name = coalesce(p_course_name, course_name)
     where id = p_round_id
       and status = 'live'
       and (owner_id = uid or scorer_user_id = uid);
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

  insert into public.live_round_slots (live_round_id, slot_id, player_key)
  select p_round_id, (elem->>'id')::uuid, public.player_key_from_player_json(elem)
    from jsonb_array_elements(coalesce(p_roster, '[]'::jsonb)) elem
   where nullif(elem->>'id', '') is not null
     and public.player_key_from_player_json(elem) is not null
  on conflict (live_round_id, slot_id) do nothing;

  insert into public.live_round_events (live_round_id, type, payload)
  values (p_round_id, 'round_started', jsonb_build_object('course_name', p_course_name));

  return jsonb_build_object('id', p_round_id, 'invite_code', code);
end;
$$;

grant execute on function public.is_live_scorer(uuid) to authenticated;
grant execute on function public.patch_live_round(uuid, jsonb, text, jsonb) to authenticated;
grant execute on function public.start_live_round(uuid, jsonb, jsonb, text) to authenticated;

do $$
begin
  raise notice 'DONE — 0010 live scorer auth fix applied.';
end $$;
