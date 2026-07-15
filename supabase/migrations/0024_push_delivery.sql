-- 0024 — Web Push delivery model (Phase 3B, DB groundwork only).
--
-- Adds per-device delivery jobs, push-eligibility helpers, and an enqueue trigger
-- so every notification that a recipient wants pushed becomes one pending job per
-- active device. The actual sender (send-push Edge Function) and the invocation
-- glue (pg_net immediate + pg_cron backstop, Vault secrets) are set up separately
-- via docs/push-setup.md — deliberately NOT here, so this migration is safe on a
-- plain `db push` even before pg_net/pg_cron/VAPID exist. Pending jobs simply
-- wait until the sender is wired up. Idempotent.

-- ---------------------------------------------------- per-device delivery jobs
-- One job per (notification, device) so a push is never sent to the same device
-- twice and each device's outcome is tracked independently.
alter table public.notification_deliveries
  add column if not exists device_id uuid references public.notification_devices (id) on delete cascade;

create unique index if not exists notification_deliveries_notif_device_idx
  on public.notification_deliveries (notification_id, device_id)
  where device_id is not null;

create index if not exists notification_deliveries_retry_idx
  on public.notification_deliveries (status, created_at)
  where status in ('pending', 'failed');

-- ------------------------------------------------------------ eligibility
-- type -> category, kept in one place so in-app + push agree.
create or replace function public.notif_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'score_updated'     then 'live_score'
    when 'hole_changed'      then 'live_score'
    when 'side_game_flagged' then 'game_changes'
    when 'player_joined'     then 'game_changes'
    when 'round_finished'    then 'settle'
    else 'game_changes'
  end;
$$;

-- Does the recipient want PUSH for this category? Conservative defaults matching
-- the guide's first-release rollout: only settle-up (round finished) pushes by
-- default; everything else is opt-in via notification_preferences.push_enabled.
create or replace function public.notif_push_enabled(p_uid uuid, p_category text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select push_enabled from public.notification_preferences
       where user_id = p_uid and event_type = p_category),
    case when p_category = 'settle' then true else false end
  );
$$;

-- ---------------------------------------------------------------- enqueue
-- After a notification is created, enqueue one pending push job per active device
-- when the recipient wants push for that category. Coalesced score/side-game
-- bumps arrive as UPDATEs (not INSERTs), so they never enqueue a push. Defensive:
-- only inserts, never raises, so it can't abort the fan-out transaction.
create or replace function public.enqueue_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.notif_push_enabled(new.user_id, public.notif_category(new.type)) then
    return new;
  end if;

  insert into public.notification_deliveries (notification_id, device_id, channel, provider, status)
  select new.id, d.id, 'push', d.provider, 'pending'
    from public.notification_devices d
   where d.user_id = new.user_id
     and d.enabled
     and d.revoked_at is null
  on conflict (notification_id, device_id) where device_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists notifications_enqueue_push on public.notifications;
create trigger notifications_enqueue_push
  after insert on public.notifications
  for each row execute function public.enqueue_push_deliveries();

-- ---------------------------------------------------------------- grants
-- Internal only (trigger + eligibility helpers). No client EXECUTE (0020 pattern).
-- The send-push Edge Function reads/writes these tables as service_role, which
-- bypasses RLS and these grants.
revoke all on function
  public.notif_category(text),
  public.notif_push_enabled(uuid, text),
  public.enqueue_push_deliveries()
from public, anon, authenticated;

do $$
begin
  raise notice 'DONE — push delivery model (0024) applied. Wire up the sender via docs/push-setup.md.';
end $$;
