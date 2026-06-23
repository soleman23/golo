-- Correct the original onboarded backfill for databases where 0006 already ran
-- with name/nickname included. The app only treats a locker as complete when
-- there is real contact info: nonblank email or a phone with at least 7 digits.
-- Re-runnable.

update public.profiles
   set onboarded = false
 where onboarded = true
   and nullif(btrim(email), '') is null
   and length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) < 7;
