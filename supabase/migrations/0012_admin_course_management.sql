-- Admin course management: guarded catalogue editing and setup visibility.
-- Run after 0005_ghin.sql. Re-runnable for development.

alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.courses add column if not exists visible_in_setup boolean not null default false;

update public.courses
   set visible_in_setup = true
 where id in ('tetherow', 'losttracks', 'pinehurst');

create or replace function public.is_app_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and is_admin = true
  );
$$;

-- Prevent clients from self-granting (or clearing) is_admin via profiles_update_own.
-- Bootstrap admins only through the SQL editor / service role (auth.uid() is null).
create or replace function public.protect_profile_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.is_admin is distinct from OLD.is_admin then
    raise exception 'is_admin cannot be changed via client';
  end if;
  if TG_OP = 'INSERT' and coalesce(NEW.is_admin, false) then
    raise exception 'is_admin cannot be set via client';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_profile_is_admin on public.profiles;
create trigger trg_protect_profile_is_admin
  before insert or update of is_admin on public.profiles
  for each row execute function public.protect_profile_is_admin();

create or replace function public.course_ready_for_setup(
  p_name text,
  p_location text,
  p_holes integer,
  p_pars jsonb,
  p_stroke_index jsonb,
  p_tees jsonb
)
returns boolean
language plpgsql
immutable
as $$
declare
  h integer;
  par_text text;
  par_value integer;
  si_text text;
  si_value integer;
  seen_ranks integer[] := '{}';
  tee jsonb;
  text_value text;
begin
  if nullif(trim(coalesce(p_name, '')), '') is null then
    return false;
  end if;

  if nullif(trim(coalesce(p_location, '')), '') is null then
    return false;
  end if;

  if p_holes <> 18 then
    return false;
  end if;

  if p_pars is null
     or p_stroke_index is null
     or jsonb_typeof(p_pars) <> 'object'
     or jsonb_typeof(p_stroke_index) <> 'object' then
    return false;
  end if;

  for h in 1..18 loop
    par_text := p_pars ->> h::text;
    if par_text is null or par_text !~ '^[0-9]+$' then
      return false;
    end if;
    par_value := par_text::integer;
    if par_value < 3 or par_value > 6 then
      return false;
    end if;

    si_text := p_stroke_index ->> h::text;
    if si_text is null or si_text !~ '^[0-9]+$' then
      return false;
    end if;
    si_value := si_text::integer;
    if si_value < 1 or si_value > 18 or si_value = any(seen_ranks) then
      return false;
    end if;
    seen_ranks := array_append(seen_ranks, si_value);
  end loop;

  if array_length(seen_ranks, 1) <> 18 then
    return false;
  end if;

  if p_tees is null or jsonb_typeof(p_tees) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(p_tees) < 1 then
    return false;
  end if;

  for tee in select value from jsonb_array_elements(p_tees) loop
    if jsonb_typeof(tee) <> 'object' then
      return false;
    end if;

    if nullif(trim(coalesce(tee ->> 'name', '')), '') is null then
      return false;
    end if;

    text_value := tee ->> 'yards';
    if text_value is null or text_value !~ '^[0-9]+$' or text_value::integer <= 0 then
      return false;
    end if;

    text_value := tee ->> 'rating';
    if text_value is null or text_value !~ '^[0-9]+(\.[0-9]+)?$' or text_value::numeric <= 0 then
      return false;
    end if;

    text_value := tee ->> 'slope';
    if text_value is null or text_value !~ '^[0-9]+$' or text_value::integer < 55 or text_value::integer > 155 then
      return false;
    end if;

    text_value := tee ->> 'par';
    if text_value is null or text_value !~ '^[0-9]+$' or text_value::integer < 3 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- Non-admins may own/edit course rows, but only admins may publish to setup,
-- and only when the scorecard is complete. Admin RPCs are security definer
-- and bypass these policies.
drop policy if exists courses_insert_auth on public.courses;
create policy courses_insert_auth on public.courses
  for insert to authenticated
  with check (
    auth.uid() = created_by
    and (
      visible_in_setup = false
      or (
        public.is_app_admin()
        and public.course_ready_for_setup(name, location, holes, pars, stroke_index, tees)
      )
    )
  );

drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses
  for update to authenticated
  using (auth.uid() = created_by)
  with check (
    auth.uid() = created_by
    and (
      visible_in_setup = false
      or (
        public.is_app_admin()
        and public.course_ready_for_setup(name, location, holes, pars, stroke_index, tees)
      )
    )
  );

drop function if exists public.admin_me();
create function public.admin_me()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return jsonb_build_object('is_admin', public.is_app_admin());
end;
$$;

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
    ghin_tee_sets
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
    v_ghin_tee_sets
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
    ghin_tee_sets = excluded.ghin_tee_sets;

  select to_jsonb(c.*) into row_json
    from public.courses c
   where c.id = v_id;

  return row_json;
end;
$$;

drop function if exists public.admin_set_course_visibility(text, boolean);
create function public.admin_set_course_visibility(p_id text, p_visible boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.courses%rowtype;
  row_json jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  select * into c from public.courses where id = p_id;
  if not found then
    raise exception 'course not found';
  end if;

  if p_visible and not public.course_ready_for_setup(c.name, c.location, c.holes, c.pars, c.stroke_index, c.tees) then
    raise exception 'course_not_ready_for_setup';
  end if;

  update public.courses
     set visible_in_setup = p_visible
   where id = p_id;

  select to_jsonb(c.*) into row_json
    from public.courses c
   where c.id = p_id;

  return row_json;
end;
$$;

grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.course_ready_for_setup(text, text, integer, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.admin_me() to authenticated;
grant execute on function public.admin_list_courses() to authenticated;
grant execute on function public.admin_upsert_course(jsonb) to authenticated;
grant execute on function public.admin_set_course_visibility(text, boolean) to authenticated;
