-- Run this if public.live_rounds ALREADY EXISTS (Step A succeeded).
-- Does NOT create live_rounds — only members/events (if missing) + functions + RLS.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.live_round_members (
  id              uuid primary key default gen_random_uuid(),
  live_round_id   uuid not null references public.live_rounds (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('scorer', 'player', 'viewer')),
  player_key      text,
  slot_player_id  uuid,
  joined_at       timestamptz not null default now(),
  unique (live_round_id, user_id)
);

create table if not exists public.live_round_events (
  id              uuid primary key default gen_random_uuid(),
  live_round_id   uuid not null references public.live_rounds (id) on delete cascade,
  type            text not null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

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

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.gen_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result text := ''; i int;
begin
  for i in 1..6 loop result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1); end loop;
  return result;
end; $$;

create or replace function public.player_key_from_player_json(p jsonb)
returns text language sql immutable as $$
  select case
    when coalesce(p->>'guest', 'false') = 'true' then null
    when nullif(lower(trim(p->>'email')), '') is not null then 'e:' || lower(trim(p->>'email'))
    when length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) >= 7 then 'p:' || regexp_replace(p->>'phone', '\D', '', 'g')
    when nullif(lower(trim(p->>'name')), '') is not null then 'n:' || lower(trim(p->>'name'))
    else null end; $$;

create or replace function public.is_live_scorer(lrid uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare found boolean;
begin
  execute $q$ select exists (select 1 from public.live_rounds where id = $1 and scorer_user_id = auth.uid() and status = 'live') $q$
  into found using lrid;
  return coalesce(found, false);
end; $$;

create or replace function public.is_live_member(lrid uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare found boolean;
begin
  execute $q$ select exists (select 1 from public.live_round_members where live_round_id = $1 and user_id = auth.uid()) $q$
  into found using lrid;
  return coalesce(found, false);
end; $$;

-- (RPCs + RLS continue in 0009_live_rounds_functions.sql from line 154 — run that file
--  starting at "-- ------------------------------------------------------------------------ RPCs" through the end, in a second query.)
