-- Profile images: an avatar_url column on profiles plus a public Storage bucket.
-- Run after 0001/0002. Re-runnable.

-- ------------------------------------------------------ profiles.avatar_url
alter table public.profiles add column if not exists avatar_url text;

-- ------------------------------------------------------------- avatars bucket
-- Public read bucket. Each user can only write within a folder named by their
-- uid (path convention: "<uid>/<file>.jpg"), enforced by the policies below.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ----------------------------------------------------- storage.objects RLS
-- (RLS is already enabled on storage.objects in Supabase projects.)

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
