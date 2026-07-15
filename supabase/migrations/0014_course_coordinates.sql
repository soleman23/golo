-- Course coordinates for distance-based nearby sorting.

alter table public.courses
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create index if not exists courses_geo_idx
  on public.courses (latitude, longitude)
  where latitude is not null and longitude is not null;

-- Seed known coordinates for bundled courses (OSM/Nominatim centroids).
update public.courses set latitude = 35.1856, longitude = -79.4663 where id = 'pinehurst';
update public.courses set latitude = 33.4228, longitude = -79.0956 where id = 'harbor';
update public.courses set latitude = 37.7849, longitude = -122.4994 where id = 'lincoln';
update public.courses set latitude = 44.0215, longitude = -121.3165 where id = 'tetherow';
update public.courses set latitude = 44.0245, longitude = -121.2789 where id = 'losttracks';

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
  setup_ready boolean
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
    public.course_ready_for_setup(c.name, c.location, c.holes, c.pars, c.stroke_index, c.tees) as setup_ready
  from public.courses c
  order by c.visible_in_setup desc, c.name asc;
end;
$$;

drop function if exists public.admin_upsert_course(jsonb);
create function public.admin_upsert_course(p_course jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_id text;
  v_name text;
  v_location text;
  v_holes integer := 18;
  v_bg text;
  v_pars jsonb;
  v_stroke_index jsonb;
  v_tees jsonb;
  v_is_public boolean := true;
  v_visible boolean := false;
  v_ghin_facility_id text;
  v_ghin_course_id text;
  v_ghin_tee_sets jsonb;
  v_latitude double precision;
  v_longitude double precision;
  row_json jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  v_name := nullif(trim(coalesce(p_course ->> 'name', '')), '');
  if v_name is null then
    raise exception 'course name is required';
  end if;

  v_id := nullif(trim(coalesce(p_course ->> 'id', '')), '');
  if v_id is null then
    v_id := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_id := trim(both '-' from v_id);
  end if;
  if nullif(v_id, '') is null then
    raise exception 'course id could not be generated';
  end if;

  v_location := nullif(trim(coalesce(p_course ->> 'loc', p_course ->> 'location', '')), '');
  v_holes := coalesce(nullif(p_course ->> 'holes', '')::integer, 18);
  v_bg := nullif(trim(coalesce(p_course ->> 'bg', '')), '');
  v_pars := case when jsonb_typeof(p_course -> 'pars') = 'object' then p_course -> 'pars' else null end;
  v_stroke_index := case
    when jsonb_typeof(p_course -> 'strokeIndex') = 'object' then p_course -> 'strokeIndex'
    when jsonb_typeof(p_course -> 'stroke_index') = 'object' then p_course -> 'stroke_index'
    else null
  end;
  v_tees := case when jsonb_typeof(p_course -> 'tees') = 'array' then p_course -> 'tees' else null end;
  v_is_public := coalesce(nullif(p_course ->> 'isPublic', '')::boolean, nullif(p_course ->> 'is_public', '')::boolean, true);
  v_visible := coalesce(nullif(p_course ->> 'visibleInSetup', '')::boolean, nullif(p_course ->> 'visible_in_setup', '')::boolean, false);
  v_ghin_facility_id := nullif(trim(coalesce(p_course ->> 'ghinFacilityId', p_course ->> 'ghin_facility_id', '')), '');
  v_ghin_course_id := nullif(trim(coalesce(p_course ->> 'ghinCourseId', p_course ->> 'ghin_course_id', '')), '');
  v_ghin_tee_sets := case
    when jsonb_typeof(p_course -> 'ghinTeeSets') = 'object' then p_course -> 'ghinTeeSets'
    when jsonb_typeof(p_course -> 'ghin_tee_sets') = 'object' then p_course -> 'ghin_tee_sets'
    else null
  end;
  v_latitude := nullif(p_course ->> 'latitude', '')::double precision;
  v_longitude := nullif(p_course ->> 'longitude', '')::double precision;

  if v_visible and not public.course_ready_for_setup(v_name, v_location, v_holes, v_pars, v_stroke_index, v_tees) then
    raise exception 'course_not_ready_for_setup';
  end if;

  insert into public.courses (
    id,
    name,
    location,
    holes,
    bg,
    pars,
    stroke_index,
    tees,
    is_public,
    visible_in_setup,
    created_by,
    ghin_facility_id,
    ghin_course_id,
    ghin_tee_sets,
    latitude,
    longitude
  )
  values (
    v_id,
    v_name,
    v_location,
    v_holes,
    v_bg,
    v_pars,
    v_stroke_index,
    v_tees,
    v_is_public,
    v_visible,
    uid,
    v_ghin_facility_id,
    v_ghin_course_id,
    v_ghin_tee_sets,
    v_latitude,
    v_longitude
  )
  on conflict (id) do update set
    name = excluded.name,
    location = excluded.location,
    holes = excluded.holes,
    bg = excluded.bg,
    pars = excluded.pars,
    stroke_index = excluded.stroke_index,
    tees = excluded.tees,
    is_public = excluded.is_public,
    visible_in_setup = excluded.visible_in_setup,
    ghin_facility_id = excluded.ghin_facility_id,
    ghin_course_id = excluded.ghin_course_id,
    ghin_tee_sets = excluded.ghin_tee_sets,
    latitude = excluded.latitude,
    longitude = excluded.longitude;

  select to_jsonb(c.*) into row_json
    from public.courses c
   where c.id = v_id;

  return row_json;
end;
$$;

grant execute on function public.admin_list_courses() to authenticated;
grant execute on function public.admin_upsert_course(jsonb) to authenticated;
