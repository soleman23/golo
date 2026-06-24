-- 0008 — Live rounds: tables, indexes, extensions.
-- Run this first, then 0009_live_rounds_functions.sql (functions, RLS, grants).
-- Every object uses IF NOT EXISTS, so re-running is safe.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.live_rounds (
  id              uuid primary key,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  scorer_user_id  uuid not null references auth.users (id) on delete cascade,
  invite_code     text not null unique,
  status          text not null default 'live' check (status in ('live', 'complete')),
  state           jsonb not null default '{}'::jsonb,
  course_name     text,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists live_rounds_invite_idx on public.live_rounds (invite_code);
create index if not exists live_rounds_status_idx on public.live_rounds (status);

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
