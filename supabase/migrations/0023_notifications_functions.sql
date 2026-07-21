-- 0023 — Notifications: RLS policies, server-side fan-out trigger, Realtime, grants.
--
-- Requires 0022_notifications.sql (tables + indexes + RLS enable).
-- Idempotent: drops policies/trigger/functions up front and recreates everything.
--
-- Security model (matches the live-rounds RPCs + 0020 grant hardening):
--   * The browser NEVER inserts a notification. Rows are created only by the
--     fan-out trigger below, which runs SECURITY DEFINER after an insert into
--     public.live_round_events, checks round membership, and honours each
--     recipient's preferences. This satisfies "the browser must not be allowed
--     to create arbitrary notifications for other people".
--   * A signed-in player can read/update only their OWN notifications, and
--     create/update/disable only their OWN devices and preferences (RLS below).
--   * New functions are internal (trigger + helper), so EXECUTE is revoked from
--     public/anon/authenticated at the end (0020 pattern).

-- ------------------------------------------------------------------- cleanup
drop trigger if exists live_events_fan_out_notifications on public.live_round_events;
drop function if exists public.fan_out_live_event_notifications();
drop function if exists public.notif_in_app_enabled(uuid, text);

drop policy if exists notifications_select_own       on public.notifications;
drop policy if exists notifications_update_own       on public.notifications;
drop policy if exists notification_devices_all_own   on public.notification_devices;
drop policy if exists notification_prefs_all_own     on public.notification_preferences;

-- ----------------------------------------------------------------------- RLS
-- notifications: read + update (mark read / archive) your own rows only. No
-- insert policy (trigger-only) and no delete policy (archive via update; rows
-- are retained for audit).
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- devices + preferences: a user fully manages their own rows.
create policy notification_devices_all_own on public.notification_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_prefs_all_own on public.notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- notification_deliveries: RLS on, NO policy by design — only the definer
-- trigger / service_role sender writes it. Clients never read delivery history.

-- --------------------------------------------------------------------- helpers
-- Resolve whether a recipient wants a category IN-APP. Falls back to the legacy
-- profiles.notify_live / profiles.notify_settle booleans when no per-category
-- preference row exists yet, so existing choices carry over untouched.
-- SECURITY DEFINER so the fan-out trigger can read OTHER users' prefs/profiles.
create or replace function public.notif_in_app_enabled(p_uid uuid, p_category text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select in_app_enabled from public.notification_preferences
       where user_id = p_uid and event_type = p_category),
    case when p_category = 'settle' or p_category = 'payments'
      then (select notify_settle from public.profiles where id = p_uid)
      else (select notify_live   from public.profiles where id = p_uid)
    end,
    true
  );
$$;

-- ----------------------------------------------------------------- fan-out
-- After every live_round_events insert, create ONE durable notification per
-- round member (except the actor). auth.uid() is still the real end user here:
-- SECURITY DEFINER switches the executing ROLE but not the request JWT, so it
-- correctly identifies who caused the event (the scorer, or the joiner for
-- player_joined) and skips self-notifying.
--
-- Coalescing: score/side-game events reuse a per-round dedupe_key, so repeated
-- changes bump ONE row (re-surfaced as unread) instead of flooding the inbox.
-- Per-hole / per-join events use unique keys, so their ON CONFLICT never fires.
-- Defensive by construction — it only inserts, never raises, so it can't abort
-- the scorer's score-sync transaction.
create or replace function public.fan_out_live_event_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_type      text := new.type;
  v_category  text;
  v_title     text;
  v_message   text;
  v_action    text := '/scoring';
  v_dedupe    text;
  v_course    text;
  v_player    text := coalesce(new.payload->>'playerName', 'A player');
  v_hole      text := new.payload->>'hole';
  v_score     text := new.payload->>'newScore';
begin
  -- Only meaningful, member-facing events become durable notifications.
  -- round_started (only the scorer is a member yet), round_updated and
  -- state_updated (internal sync churn) are intentionally skipped.
  if v_type not in ('score_updated', 'hole_changed', 'side_game_flagged',
                    'round_finished', 'player_joined') then
    return new;
  end if;

  select course_name into v_course from public.live_rounds where id = new.live_round_id;

  if v_type = 'score_updated' then
    v_category := 'live_score';
    v_title    := 'Scores updated';
    v_message  := case
      when v_hole is not null and v_score is not null
        then v_player || ' made ' || v_score || ' on hole ' || v_hole
      else 'A score was updated' end;
    v_dedupe   := 'score';
  elsif v_type = 'hole_changed' then
    v_category := 'live_score';
    v_title    := 'Now on hole ' || coalesce(v_hole, '—');
    v_message  := coalesce(v_course, 'The group') || ' moved to the next hole';
    -- Coalesced per round (not per hole) so the inbox holds ONE row that bumps to
    -- the current hole, instead of a fresh notification for all 18.
    v_dedupe   := 'hole';
  elsif v_type = 'side_game_flagged' then
    v_category := 'game_changes';
    v_title    := 'Side game updated';
    v_message  := 'A side game was flagged in ' || coalesce(v_course, 'your round');
    v_dedupe   := 'sidegame';
  elsif v_type = 'round_finished' then
    v_category := 'settle';
    v_title    := 'Round finished';
    v_message  := 'Head to Settle Up to review the payouts.';
    v_action   := '/payouts';
    v_dedupe   := 'finished';
  elsif v_type = 'player_joined' then
    v_category := 'game_changes';
    v_title    := 'Someone joined the round';
    v_message  := case when new.payload->>'role' = 'player'
      then 'A roster player claimed their spot.'
      else 'A viewer is watching the round.' end;
    v_dedupe   := 'join:' || new.id::text;
  end if;

  insert into public.notifications
    (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
  select
    m.user_id,
    v_type,
    v_title,
    v_message,
    new.live_round_id,
    v_actor,
    v_action,
    -- Strip identity keys before the payload becomes readable by OTHER members'
    -- notification rows. player_joined events carry player_key ('e:<email>' /
    -- 'p:<phone>'); email/phone are stripped defensively for any future event.
    (new.payload - 'player_key' - 'email' - 'phone')
      || jsonb_build_object('course_name', v_course),
    'lr:' || new.live_round_id::text || ':' || v_dedupe
  from public.live_round_members m
  where m.live_round_id = new.live_round_id
    and (v_actor is null or m.user_id <> v_actor)
    and public.notif_in_app_enabled(m.user_id, v_category)
  on conflict (user_id, dedupe_key) where dedupe_key is not null
  do update set
    created_at = now(),
    read_at    = null,
    title      = excluded.title,
    message    = excluded.message,
    payload    = excluded.payload;

  return new;
end;
$$;

create trigger live_events_fan_out_notifications
  after insert on public.live_round_events
  for each row execute function public.fan_out_live_event_notifications();

-- ------------------------------------------------------------------ Realtime
-- Phase 2 subscribes each signed-in user to inserts on their own notifications.
-- Realtime enforces RLS per subscriber, so no player receives another's rows;
-- the client additionally filters user_id=eq.<uid>. Devices + deliveries are
-- deliberately NOT published.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------- grants
-- Both new functions are internal: notif_in_app_enabled is called only from the
-- trigger body (runs as the definer), and the trigger function is invoked by the
-- trigger itself (Postgres checks EXECUTE at CREATE TRIGGER time, not fire time).
-- Neither is reachable over PostgREST, so strip EXECUTE from every caller role,
-- matching the 0020 hardening. Tables inherit Supabase's default authenticated
-- privileges and are governed by the RLS policies above — no explicit grants.
revoke all on function
  public.notif_in_app_enabled(uuid, text),
  public.fan_out_live_event_notifications()
from public, anon, authenticated;

do $$
begin
  raise notice 'DONE — notifications foundation (0022/0023) applied successfully.';
end $$;
