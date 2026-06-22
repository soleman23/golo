-- GHIN integration: profile connection metadata, OAuth token storage, course mapping,
-- round post status. Run after 0001–0004. Re-runnable.

-- Profile fields the client may read (tokens live in ghin_connections only).
alter table public.profiles add column if not exists ghin_number text;
alter table public.profiles add column if not exists ghin_connected_at timestamptz;
alter table public.profiles add column if not exists ghin_last_sync_at timestamptz;

-- OAuth tokens — service role / edge functions only; no client SELECT policy.
create table if not exists public.ghin_connections (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.ghin_connections enable row level security;

-- Short-lived OAuth state tokens (callback validates without JWT).
create table if not exists public.ghin_oauth_states (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.ghin_oauth_states enable row level security;

-- GHIN course / tee mapping on the catalogue.
alter table public.courses add column if not exists ghin_facility_id text;
alter table public.courses add column if not exists ghin_course_id text;
alter table public.courses add column if not exists ghin_tee_sets jsonb;

-- Queryable post status on completed rounds (also mirrored in snapshot json).
alter table public.rounds add column if not exists ghin_posted_at timestamptz;
alter table public.rounds add column if not exists ghin_post_id text;
alter table public.rounds add column if not exists ghin_post_error text;

create index if not exists rounds_ghin_posted_idx on public.rounds (ghin_posted_at desc nulls last);

-- updated_at on ghin_connections
drop trigger if exists ghin_connections_set_updated_at on public.ghin_connections;
create trigger ghin_connections_set_updated_at
  before update on public.ghin_connections
  for each row execute function public.set_updated_at();

-- Purge expired OAuth states (optional cron; safe to run manually).
create or replace function public.purge_expired_ghin_oauth_states()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ghin_oauth_states where expires_at < now();
$$;
