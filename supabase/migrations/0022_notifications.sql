-- 0022 — Notifications foundation: durable per-recipient inbox tables.
--
-- Phase 1 of the GOLO notification system. This migration only creates the
-- data foundation (tables + indexes + RLS enable); the functions, RLS policies,
-- the server-side fan-out trigger, Realtime and grants live in
-- 0023_notifications_functions.sql (mirrors the 0008/0009 live-rounds split).
--
-- Every user-facing notification is ONE durable row per recipient in
-- public.notifications. Both the in-app inbox (Phase 2) and Web/PWA push
-- (Phase 3, deferred) read from the same record, so unread state stays
-- consistent across devices and native apps can be added later with no rework.
--
-- Rows are created only by the fan-out trigger (SECURITY DEFINER); the browser
-- never inserts a notification for anyone — see 0023.
--
-- Every object uses IF NOT EXISTS, so re-running is safe.

create extension if not exists pgcrypto with schema extensions;

-- --------------------------------------------------------------- notifications
-- One permanent inbox item for one recipient. `dedupe_key` (unique per user)
-- makes fan-out idempotent and lets high-frequency events (score updates) be
-- coalesced into a single row that re-surfaces instead of flooding the inbox.
create table if not exists public.notifications (
  id             uuid primary key default extensions.gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  type           text not null,
  title          text not null default '',
  message        text not null default '',
  round_id       uuid references public.live_rounds (id) on delete set null,
  actor_user_id  uuid references auth.users (id) on delete set null,
  action_url     text,
  payload        jsonb not null default '{}'::jsonb,
  dedupe_key     text,
  read_at        timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- Idempotent fan-out + coalescing arbiter. Partial (dedupe_key not null) so rows
-- without a key are never deduped.
create unique index if not exists notifications_user_dedupe_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

-- Unread-badge + inbox list. The partial index backs the "active inbox" query
-- (archived items are hidden but retained for audit).
create index if not exists notifications_user_active_idx
  on public.notifications (user_id, created_at desc)
  where archived_at is null;

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_round_idx
  on public.notifications (round_id)
  where round_id is not null;

-- ---------------------------------------------------------- notification_devices
-- A push target for one user. Provider-neutral by design: `platform`/`provider`
-- carry web now and APNs/FCM later, so Phase 3 (and future native apps) drop in
-- without a schema change. Push credentials/keys are stored here only for the
-- server sender; they are never exposed to the browser bundle.
create table if not exists public.notification_devices (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  platform          text not null default 'web'      check (platform in ('web', 'ios', 'android')),
  provider          text not null default 'web_push' check (provider in ('web_push', 'apns', 'fcm')),
  endpoint_or_token text not null,
  web_p256dh        text,
  web_auth          text,
  enabled           boolean not null default true,
  last_seen_at      timestamptz not null default now(),
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, endpoint_or_token)
);

create index if not exists notification_devices_user_idx
  on public.notification_devices (user_id)
  where revoked_at is null;

-- ------------------------------------------------------ notification_preferences
-- One row per (user, event category) controlling in-app and push delivery.
-- Categories: 'live_score', 'game_changes', 'betting', 'payments', 'settle',
-- 'reminders'. When a row is absent the fan-out falls back to the legacy
-- profiles.notify_live / profiles.notify_settle booleans (see 0023), so existing
-- user choices are preserved without a data migration.
create table if not exists public.notification_preferences (
  user_id         uuid not null references auth.users (id) on delete cascade,
  event_type      text not null,
  in_app_enabled  boolean not null default true,
  push_enabled    boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (user_id, event_type)
);

-- ------------------------------------------------------- notification_deliveries
-- Delivery + retry history per channel. Created now for a stable schema; only
-- exercised once Phase 3 (Web Push) turns on the server-side sender.
create table if not exists public.notification_deliveries (
  id              uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel         text not null default 'push',
  provider        text,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists notification_deliveries_notif_idx
  on public.notification_deliveries (notification_id);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (status)
  where status = 'pending';

-- ----------------------------------------------------------------- enable RLS
-- Policies are defined in 0023. notification_deliveries keeps RLS on with NO
-- policy (server-only, like live_round_slots) — only the definer/service_role
-- sender touches it.
alter table public.notifications            enable row level security;
alter table public.notification_devices     enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries  enable row level security;
