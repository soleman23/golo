-- GoLo backend schema: profiles, courses, rounds, round_participants.
--
-- Run this in the Supabase SQL editor (or via the Supabase CLI) against a fresh
-- project. It is idempotent enough to re-run during development: tables use
-- "if not exists" and policies are dropped before being recreated.
--
-- Identity model mirrors src/lib/identity.js: a player's stable cross-round key
-- ("e:<email>" | "p:<phone>" | "n:<name>") is stored on round_participants so we
-- can aggregate a player's history across rounds regardless of the per-round id.

-- ---------------------------------------------------------------- extensions
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ profiles
-- One row per auth user, mirroring src/store/profileStore.js.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  name          text,
  nickname      text,
  phone         text,
  home_club     text,
  venmo         text,
  ghin_sync     boolean not null default false,
  notify_settle boolean not null default true,
  notify_live   boolean not null default true,
  skins_default jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------- courses
-- The course catalogue. `id` is a stable slug (e.g. 'tetherow') for seeded
-- courses; custom courses can use any unique string (a uuid works).
create table if not exists public.courses (
  id           text primary key,
  name         text not null,
  location     text,
  holes        integer not null default 18,
  bg           text,
  pars         jsonb,
  stroke_index jsonb,
  tees         jsonb,
  is_public    boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------------------- rounds
-- One row per completed round. `snapshot` is the full self-contained payload the
-- client already builds in PayoutsPage.saveRound — the History screens render
-- straight from it, so the dedicated columns are just for querying/sorting.
create table if not exists public.rounds (
  id           uuid primary key,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  course_id    text references public.courses (id) on delete set null,
  course_name  text,
  date         date,
  holes        integer,
  scoring      text,
  scoring_type text,
  completed_at timestamptz,
  snapshot     jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists rounds_owner_idx on public.rounds (owner_id);
create index if not exists rounds_completed_idx on public.rounds (completed_at desc);

-- -------------------------------------------------------- round_participants
-- One row per player in a round, keyed by the stable identity from identity.js.
-- Powers cross-player history and season ledgers server-side. `user_id` links to
-- a profile when the participant is a registered user (so they can read rounds
-- they played in).
create table if not exists public.round_participants (
  id           uuid primary key default extensions.gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete cascade,
  player_key   text,
  display_name text,
  email        text,
  phone        text,
  user_id      uuid references public.profiles (id) on delete set null,
  gross        numeric,
  net          numeric,
  to_par       numeric,
  net_payout   numeric not null default 0,
  created_at   timestamptz not null default now(),
  unique (round_id, player_key)
);

create index if not exists rp_round_idx on public.round_participants (round_id);
create index if not exists rp_key_idx on public.round_participants (player_key);
create index if not exists rp_user_idx on public.round_participants (user_id);

-- ------------------------------------------------------- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------- security-definer access helpers
-- These bypass RLS to break the mutual rounds <-> round_participants policy
-- recursion. They only ever check the current auth.uid(), so they're safe.
create or replace function public.owns_round(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.rounds where id = rid and owner_id = auth.uid()
  );
$$;

create or replace function public.in_round(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.round_participants
    where round_id = rid and user_id = auth.uid()
  );
$$;

-- Link participants of a round (owned by the caller) to registered profiles by
-- matching email, so those users can read rounds they played in. Runs as the
-- definer to read the full profiles table; guarded by an ownership check.
create or replace function public.link_round_participants(rid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.owns_round(rid) then
    raise exception 'not authorized to link participants for this round';
  end if;
  update public.round_participants rp
     set user_id = p.id
    from public.profiles p
   where rp.round_id = rid
     and rp.user_id is null
     and rp.email is not null
     and lower(p.email) = lower(rp.email);
end;
$$;

-- ----------------------------------------------------------------- enable RLS
alter table public.profiles            enable row level security;
alter table public.courses             enable row level security;
alter table public.rounds              enable row level security;
alter table public.round_participants  enable row level security;

-- ------------------------------------------------------------ profiles RLS
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = id);

-- Limited public subset for crew lookups (name + handle only), bypassing the
-- own-row RLS above via a non-invoker view.
create or replace view public.public_profiles as
  select id, name, nickname from public.profiles;

grant select on public.public_profiles to anon, authenticated;

-- -------------------------------------------------------------- courses RLS
drop policy if exists courses_select_all on public.courses;
create policy courses_select_all on public.courses
  for select using (true);

drop policy if exists courses_insert_auth on public.courses;
create policy courses_insert_auth on public.courses
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses
  for update to authenticated using (auth.uid() = created_by) with check (auth.uid() = created_by);

drop policy if exists courses_delete_own on public.courses;
create policy courses_delete_own on public.courses
  for delete to authenticated using (auth.uid() = created_by);

-- --------------------------------------------------------------- rounds RLS
drop policy if exists rounds_select_visible on public.rounds;
create policy rounds_select_visible on public.rounds
  for select to authenticated
  using (auth.uid() = owner_id or public.in_round(id));

drop policy if exists rounds_insert_own on public.rounds;
create policy rounds_insert_own on public.rounds
  for insert to authenticated with check (auth.uid() = owner_id);

drop policy if exists rounds_update_own on public.rounds;
create policy rounds_update_own on public.rounds
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists rounds_delete_own on public.rounds;
create policy rounds_delete_own on public.rounds
  for delete to authenticated using (auth.uid() = owner_id);

-- --------------------------------------------------- round_participants RLS
drop policy if exists rp_select_visible on public.round_participants;
create policy rp_select_visible on public.round_participants
  for select to authenticated
  using (user_id = auth.uid() or public.owns_round(round_id));

drop policy if exists rp_insert_owner on public.round_participants;
create policy rp_insert_owner on public.round_participants
  for insert to authenticated with check (public.owns_round(round_id));

drop policy if exists rp_update_owner on public.round_participants;
create policy rp_update_owner on public.round_participants
  for update to authenticated using (public.owns_round(round_id)) with check (public.owns_round(round_id));

drop policy if exists rp_delete_owner on public.round_participants;
create policy rp_delete_owner on public.round_participants
  for delete to authenticated using (public.owns_round(round_id));
