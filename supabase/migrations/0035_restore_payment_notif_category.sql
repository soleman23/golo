-- 0035 — Restore payment arms on notif_category (regression from 0033).
--
-- 0033 redefined notif_category from 0025's cases + invite types, but 0026 had
-- already mapped payment_requested / payment_marked_sent / payment_confirmed /
-- payment_disputed → 'payments'. Those four fell through to the 'game_changes'
-- fallback, so payment prefs and push routing used the wrong category.
--
-- Idempotent: CREATE OR REPLACE. Carries every prior case (0024–0026) plus the
-- 0033 invite types.

create or replace function public.notif_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'score_updated'           then 'live_score'
    when 'hole_changed'            then 'live_score'
    when 'side_game_flagged'       then 'game_changes'
    when 'player_joined'           then 'game_changes'
    when 'round_finished'          then 'settle'
    when 'betting_terms_requested' then 'betting'
    when 'betting_terms_responded' then 'betting'
    when 'payment_requested'       then 'payments'
    when 'payment_marked_sent'     then 'payments'
    when 'payment_confirmed'       then 'payments'
    when 'payment_disputed'        then 'payments'
    when 'game_invite_received'    then 'game_changes'
    when 'game_invite_responded'   then 'game_changes'
    else 'game_changes'
  end;
$$;

-- Keep the 0020 posture: notif_category is trigger-only, not a client RPC.
revoke all on function public.notif_category(text)
from public, anon, authenticated;

do $$
begin
  raise notice 'DONE — payment notif_category arms restored (0035).';
end $$;
