-- 0032 — Course photography.
--
-- Automatic photos use Unsplash's API and remain hotlinked to its CDN. We store
-- only the returned URL and required creator credit metadata. Curated admin
-- uploads use the public course-images bucket and always win server-side.
--
-- NCRDB imports do not create public.courses rows, so a separate deny-all cache
-- provides a durable key for those catalogue-only ids. Edge functions reach it
-- with the service role; authenticated clients get public display metadata only
-- through course_image_data().
--
-- Re-runnable.

-- --------------------------------------------------------- courses.image_*
alter table public.courses add column if not exists image_url text;
-- 'curated' (admin upload, never auto-overwritten) | 'unsplash'
alter table public.courses add column if not exists image_source text;
alter table public.courses add column if not exists image_attribution text;
alter table public.courses add column if not exists image_attribution_url text;
alter table public.courses add column if not exists image_fetched_at timestamptz;

-- ------------------------------------------------------- course_image_cache
create table if not exists public.course_image_cache (
  course_id            text primary key,
  image_url            text,
  image_source         text,
  image_attribution    text,
  image_attribution_url text,
  -- Null image_url is a negative cache. Genuine misses last a day; transient
  -- provider failures use a much shorter per-row window.
  retry_ttl_ms         bigint,
  fetched_at           timestamptz not null default now()
);

alter table public.course_image_cache add column if not exists image_attribution_url text;
alter table public.course_image_cache add column if not exists retry_ttl_ms bigint;
alter table public.course_image_cache enable row level security;

-- ----------------------------------------------- course_image_daily_usage
-- A signed-in user can otherwise enumerate novel NCRDB ids and exhaust the
-- shared provider quota. Cache hits do not consume this counter; only actual
-- provider attempts do. The service-role backfill bypasses the user quota.
create table if not exists public.course_image_daily_usage (
  user_id      uuid not null,
  usage_date   date not null default current_date,
  lookup_count integer not null default 1 check (lookup_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.course_image_daily_usage enable row level security;

drop function if exists public.consume_course_image_quota(uuid, integer);
create function public.consume_course_image_quota(
  p_user_id uuid,
  p_daily_limit integer default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_daily_limit < 1 then
    return false;
  end if;

  insert into public.course_image_daily_usage (user_id, usage_date, lookup_count)
  values (p_user_id, current_date, 1)
  on conflict (user_id, usage_date) do update
     set lookup_count = course_image_daily_usage.lookup_count + 1
   where course_image_daily_usage.lookup_count < p_daily_limit;

  return found;
end;
$$;

-- ------------------------------------------------------ course_image_data()
-- Catalogue rows take precedence; NCRDB-only photos fall through to the cache.
drop function if exists public.course_image_url(text);
drop function if exists public.course_image_data(text);
create function public.course_image_data(p_course_id text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'imageUrl', photo.image_url,
    'source', photo.image_source,
    'attribution', photo.image_attribution,
    'attributionUrl', photo.image_attribution_url
  )
  from (
    select c.image_url, c.image_source, c.image_attribution, c.image_attribution_url, 1 as priority
      from public.courses c
     where c.id = p_course_id and c.image_url is not null
    union all
    select i.image_url, i.image_source, i.image_attribution, i.image_attribution_url, 2 as priority
      from public.course_image_cache i
     where i.course_id = p_course_id and i.image_url is not null
    order by priority
    limit 1
  ) photo;
$$;

-- ---------------------------------------------------------- course-images bucket
-- This bucket is for curated admin uploads only. Automatic API images are never
-- copied here.
insert into storage.buckets (id, name, public)
values ('course-images', 'course-images', true)
on conflict (id) do update set public = excluded.public;

-- ------------------------------------------------------- storage.objects RLS
drop policy if exists course_images_read_admin on storage.objects;
create policy course_images_read_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'course-images' and public.is_app_admin());

drop policy if exists course_images_insert_admin on storage.objects;
create policy course_images_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-images' and public.is_app_admin());

drop policy if exists course_images_update_admin on storage.objects;
create policy course_images_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'course-images' and public.is_app_admin())
  with check (bucket_id = 'course-images' and public.is_app_admin());

drop policy if exists course_images_delete_admin on storage.objects;
create policy course_images_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-images' and public.is_app_admin());

-- ------------------------------------------------------- admin_list_courses()
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
  latitude double precision,
  longitude double precision,
  created_at timestamptz,
  setup_ready boolean,
  image_url text,
  image_source text,
  image_attribution text,
  image_attribution_url text,
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
    c.latitude,
    c.longitude,
    c.created_at,
    public.course_ready_for_setup(c.name, c.location, c.holes, c.pars, c.stroke_index, c.tees) as setup_ready,
    c.image_url,
    c.image_source,
    c.image_attribution,
    c.image_attribution_url,
    c.image_fetched_at
  from public.courses c
  order by c.visible_in_setup desc, c.name asc;
end;
$$;

-- ---------------------------------------------------- admin_set_course_image()
drop function if exists public.admin_set_course_image(text, text, text, text);
drop function if exists public.admin_set_course_image(text, text, text, text, text);
create function public.admin_set_course_image(
  p_id text,
  p_image_url text,
  p_source text default 'curated',
  p_attribution text default null,
  p_attribution_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(trim(coalesce(p_image_url, '')), '');
  v_source text;
  row_json jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if nullif(trim(coalesce(p_id, '')), '') is null then
    raise exception 'course id is required';
  end if;

  v_source := case when v_url is null then null else coalesce(nullif(trim(p_source), ''), 'curated') end;

  update public.courses c
     set image_url = v_url,
         image_source = v_source,
         image_attribution = case when v_url is null then null else nullif(trim(coalesce(p_attribution, '')), '') end,
         image_attribution_url = case when v_url is null then null else nullif(trim(coalesce(p_attribution_url, '')), '') end,
         image_fetched_at = case when v_url is null then null else now() end
   where c.id = p_id;

  if not found then
    raise exception 'course not found';
  end if;

  -- Clearing or replacing a photo must also remove the old automatic cache row,
  -- otherwise a later backfill can immediately restore the discarded URL.
  delete from public.course_image_cache where course_id = p_id;

  select to_jsonb(c.*) into row_json from public.courses c where c.id = p_id;
  return row_json;
end;
$$;

-- ----------------------------------------------------------------- grants
revoke all on function
  public.admin_list_courses(),
  public.admin_set_course_image(text, text, text, text, text),
  public.course_image_data(text)
from public, anon, authenticated;

grant execute on function
  public.admin_list_courses(),
  public.admin_set_course_image(text, text, text, text, text),
  public.course_image_data(text)
to authenticated;

-- The edge function calls this with its service-role client. End users cannot
-- increment arbitrary identities or inspect the counter table directly.
revoke all on function public.consume_course_image_quota(uuid, integer)
from public, anon, authenticated;
grant execute on function public.consume_course_image_quota(uuid, integer)
to service_role;
