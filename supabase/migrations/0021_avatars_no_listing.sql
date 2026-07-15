-- 0019 — Stop the avatars bucket from being listable by everyone.
--
-- Supabase linter 0025 (public_bucket_allows_listing).
--
-- 0003_avatars.sql created `avatars_public_read` as `for select using (bucket_id
-- = 'avatars')` — no role restriction, no path restriction. That let anyone
-- (including anon) enumerate every object in the bucket, i.e. list the whole user
-- base by uid. A public bucket does not need this: reads go through
-- GET /storage/v1/object/public/avatars/... which bypasses RLS entirely, so
-- getPublicUrl() in src/lib/db/avatars.js keeps working with no SELECT policy at
-- all.
--
-- Scoped to the owner's own folder rather than dropped outright, because
-- upload({ upsert: true }) and remove() need to read the existing object row.
-- Path convention is "<uid>/<file>.jpg" (see 0003).
--
-- Re-runnable.

drop policy if exists avatars_public_read on storage.objects;

drop policy if exists avatars_read_own on storage.objects;
create policy avatars_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
