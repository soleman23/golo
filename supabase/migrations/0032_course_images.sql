-- Course photos: remote/cached image fields on public.courses, a public
-- Storage bucket for cached/curated photos, and an admin RPC to set a
-- curated image. Run after 0031. Re-runnable.
--
-- Resolution contract (client): getCourseImage() in src/lib/courseImages.js
-- prefers image_url over the legacy static `bg` asset, so a real photo wins
-- wherever it exists. `image_source` records provenance:
--   'curated'  -> uploaded by an admin (never overwritten by automation)
--   'unsplash' -> auto-fetched by the course-image edge function
--   'fallback' -> fetch attempted, nothing usable found

-- -------------------------------------------------------- courses columns
alter table public.courses add column if not exists image_url text;
alter table public.courses add column if not exists image_source text;
alter table public.courses add column if not exists image_attribution text;
alter table public.courses add column if not exists image_fetched_at timestamptz;

-- ------------------------------------------------------ course-images bucket
-- Public read (photos render in the app without signed URLs). Writes are
-- admin-only from the client; the course-image edge function writes with the
-- service role, which bypasses RLS. Path convention: "<course_id>.jpg".
insert into storage.buckets (id, name, public)
values ('course-images', 'course-images', true)
on conflict (id) do nothing;

drop policy if exists course_images_public_read on storage.objects;
create policy course_images_public_read on storage.objects
  for select
  using (bucket_id = 'course-images');

drop policy if exists course_images_admin_insert on storage.objects;
create policy course_images_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-images'
    and public.is_app_admin()
  );

drop policy if exists course_images_admin_update on storage.objects;
create policy course_images_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'course-images'
    and public.is_app_admin()
  )
  with check (
    bucket_id = 'course-images'
    and public.is_app_admin()
  );

drop policy if exists course_images_admin_delete on storage.objects;
create policy course_images_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'course-images'
    and public.is_app_admin()
  );

-- ------------------------------------------------- admin_list_courses (+image)
-- Recreated with the image columns so the admin desk can see/manage them.
-- Return type changed, so the old function must be dropped first.
drop function if exists public.admin_list_courses();
create function public.admin_list_courses()
returns table (
  id text,
  name text,
  location text,
  holes integer,
  bg text,
  pars jsonb,
  stroke_index jsonb,
  tees jsonb,
  is_public boolean,
  visible_in_setup boolean,
  ghin_facility_id text,
  ghin_course_id text,
  ghin_tee_sets jsonb,
  created_at timestamptz,
  setup_ready boolean,
  image_url text,
  image_source text,
  image_attribution text,
  image_fetched_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    c.id,
    c.name,
    c.location,
    c.holes,
    c.bg,
    c.pars,
    c.stroke_index,
    c.tees,
    c.is_public,
    c.visible_in_setup,
    c.ghin_facility_id,
    c.ghin_course_id,
    c.ghin_tee_sets,
    c.created_at,
    public.course_ready_for_setup(c.name, c.location, c.holes, c.pars, c.stroke_index, c.tees) as setup_ready,
    c.image_url,
    c.image_source,
    c.image_attribution,
    c.image_fetched_at
  from public.courses c
  order by c.visible_in_setup desc, c.name asc;
end;
$$;

revoke all on function public.admin_list_courses() from anon;
grant execute on function public.admin_list_courses() to authenticated;

-- -------------------------------------------------- admin_set_course_image
-- Curated-image hook for the admin desk: point a course at an uploaded photo
-- (typically in the course-images bucket) or clear it back to auto/fallback.
drop function if exists public.admin_set_course_image(text, text, text, text);
create function public.admin_set_course_image(
  p_id text,
  p_image_url text,
  p_source text default 'curated',
  p_attribution text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_json jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  update public.courses
     set image_url = nullif(trim(coalesce(p_image_url, '')), ''),
         image_source = case
           when nullif(trim(coalesce(p_image_url, '')), '') is null then null
           else coalesce(nullif(trim(coalesce(p_source, '')), ''), 'curated')
         end,
         image_attribution = nullif(trim(coalesce(p_attribution, '')), ''),
         image_fetched_at = now()
   where id = p_id;

  if not found then
    raise exception 'course not found: %', p_id;
  end if;

  select to_jsonb(c.*) into row_json
    from public.courses c
   where c.id = p_id;

  return row_json;
end;
$$;

revoke all on function public.admin_set_course_image(text, text, text, text) from anon;
grant execute on function public.admin_set_course_image(text, text, text, text) to authenticated;
