-- Persist each player's saved handicap index on their profile.
-- Run after 0001/0002/0003. Re-runnable.

alter table public.profiles add column if not exists handicap_index numeric;
