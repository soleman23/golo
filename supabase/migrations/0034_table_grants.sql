-- 0034 — Make the schema's table privileges explicit.
--
-- WHY THIS EXISTS
-- Postgres checks table privileges BEFORE row-level security. A policy can only
-- narrow what a role may already touch — it can never grant access. Until now the
-- migrations relied on Supabase's historical default privileges, which granted
-- anon/authenticated full DML on every new table in `public`, leaving RLS as the
-- only visible gate.
--
-- Recent Supabase versions harden that default: tables created by `postgres` in
-- schema `public` now grant anon/authenticated only Dxtm (TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN) — no SELECT/INSERT/UPDATE/DELETE. On a database provisioned
-- under the new default, every client query fails with
-- "permission denied for table ..." no matter how correct its policy is.
--
-- The existing hosted project predates that change, so this migration is a no-op
-- there; applying it simply writes down the privileges that project already has.
-- It exists so the migration chain is SELF-CONTAINED: a fresh project, a restore,
-- a local `supabase db reset`, or a future platform default change all produce a
-- working database. 0027 already set this precedent for game_type_visibility.
--
-- POSTURE (deliberately narrower than the legacy Supabase default)
--   * Grants mirror each table's RLS policies exactly — a table with only a
--     SELECT policy gets only SELECT. Never grant a verb no policy admits.
--   * A table with NO policy is server-only: it gets NO grant, and is reached
--     solely through SECURITY DEFINER RPCs (which run as the owner and bypass
--     both). That covers live_round_slots, notification_deliveries,
--     course_scorecard_cache, ghin_connections and ghin_oauth_states.
--   * `anon` gets NOTHING. Every route in App.jsx is behind a verified session
--     and no client call is made signed-out — the same reasoning as 0020.
--   * Already-granted objects are left to the migration that owns them:
--     game_type_visibility (0027) and the public_profiles view (0018).
--
-- Re-runnable: GRANT is idempotent.

-- ------------------------------------------------------- anon stays shut out
-- Explicit, so the intent survives a platform default that would re-add these.
revoke all on table
  public.courses,
  public.rounds,
  public.round_participants,
  public.profiles,
  public.live_rounds,
  public.live_round_members,
  public.live_round_events,
  public.live_round_slots,
  public.notifications,
  public.notification_devices,
  public.notification_preferences,
  public.notification_deliveries,
  public.round_betting_terms,
  public.round_betting_acceptances,
  public.payment_requests,
  public.game_invites,
  public.course_scorecard_cache,
  public.ghin_connections,
  public.ghin_oauth_states
from anon;

-- ------------------------------------------------------- full-CRUD surfaces
-- Owner-scoped tables whose policies admit all four verbs.
grant select, insert, update, delete on table
  public.courses,
  public.rounds,
  public.round_participants,
  public.profiles
to authenticated;

-- A user fully manages their own notification devices + preferences (0023: one
-- FOR ALL policy each).
grant select, insert, update, delete on table
  public.notification_devices,
  public.notification_preferences
to authenticated;

-- ------------------------------------------------------------ read + update
-- notifications: read your own, and update them to mark read / archive (0023).
-- Rows are created only by the fan-out trigger and the invite/betting RPCs.
grant select, update on table public.notifications to authenticated;

-- live_rounds: members read; the scorer's update policy backs the sync path.
-- Creation goes through start_live_round (SECURITY DEFINER).
grant select, update on table public.live_rounds to authenticated;

-- ------------------------------------------------------------- read-only
-- Members read these; every write is an RPC. Granting only SELECT means a
-- forged INSERT fails on privileges before RLS is even consulted.
grant select on table
  public.live_round_members,
  public.live_round_events,
  public.round_betting_terms,
  public.round_betting_acceptances,
  public.payment_requests,
  public.game_invites
to authenticated;

-- ---------------------------------------------------------------- no grant
-- Intentionally omitted (server-only, no RLS policy):
--   live_round_slots         — the PII-bearing player_key map (0008)
--   notification_deliveries  — push job history, service_role sender only (0022)
--   course_scorecard_cache   — provider cache, edge functions only (0029/0031)
--   ghin_connections         — OAuth tokens (0005)
--   ghin_oauth_states        — one-shot CSRF states (0005)

do $$
begin
  raise notice 'DONE — explicit table grants (0034) applied.';
end $$;
