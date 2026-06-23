-- Persist whether a user finished the first-run "set up your locker" step, so a
-- returning user signing in on a fresh device/session skips straight to Home
-- instead of being asked to set up a locker they already have.
-- Run after 0001-0005. Re-runnable.

alter table public.profiles add column if not exists onboarded boolean not null default false;

-- Backfill: match the app's hasContact() gate. Name/handle alone do not count
-- as a completed locker because the app requires email or a valid phone.
update public.profiles
   set onboarded = true
 where onboarded = false
   and (
     nullif(btrim(email), '') is not null
     or length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 7
   );
