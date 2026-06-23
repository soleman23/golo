-- Persist whether a user finished the first-run "set up your locker" step, so a
-- returning user signing in on a fresh device/session skips straight to Home
-- instead of being asked to set up a locker they already have.
-- Run after 0001-0005. Re-runnable.

alter table public.profiles add column if not exists onboarded boolean not null default false;

-- Backfill: anyone who already has a profile identity has clearly completed the
-- locker step, so mark them onboarded. New signups default to false until they
-- finish the locker.
update public.profiles
   set onboarded = true
 where onboarded = false
   and (email is not null or phone is not null or name is not null or nickname is not null);
