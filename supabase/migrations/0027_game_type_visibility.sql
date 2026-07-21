-- 0027 - Admin-managed side-game visibility.
--
-- Hiding a game removes it from new round setup, but does not alter saved or
-- live round bet data. The client keeps game rules in code; this table stores
-- only the visibility switch.

create table if not exists public.game_type_visibility (
  app_type text primary key,
  visible_in_setup boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_type_visibility_app_type_present check (length(trim(app_type)) > 0)
);

insert into public.game_type_visibility (app_type, visible_in_setup)
values
  ('skins', true),
  ('nassau', true),
  ('strokePurse', true),
  ('ctp', true),
  ('longestDrive', true),
  ('wolf', true),
  ('bingobangobongo', true)
on conflict (app_type) do nothing;

alter table public.game_type_visibility enable row level security;

drop policy if exists game_type_visibility_select_auth on public.game_type_visibility;
create policy game_type_visibility_select_auth on public.game_type_visibility
  for select to authenticated
  using (true);

drop trigger if exists game_type_visibility_set_updated_at on public.game_type_visibility;
create trigger game_type_visibility_set_updated_at
  before update on public.game_type_visibility
  for each row execute function public.set_updated_at();

drop function if exists public.admin_list_game_type_visibility();
create function public.admin_list_game_type_visibility()
returns table (
  app_type text,
  visible_in_setup boolean,
  updated_at timestamptz
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
    g.app_type,
    g.visible_in_setup,
    g.updated_at
  from public.game_type_visibility g
  order by g.app_type asc;
end;
$$;

drop function if exists public.admin_set_game_type_visibility(text, boolean);
create function public.admin_set_game_type_visibility(
  p_app_type text,
  p_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_type text := nullif(trim(coalesce(p_app_type, '')), '');
  row_json jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'not authorized';
  end if;

  if v_app_type is null then
    raise exception 'game type required';
  end if;

  insert into public.game_type_visibility (app_type, visible_in_setup)
  values (v_app_type, coalesce(p_visible, true))
  on conflict (app_type) do update
     set visible_in_setup = excluded.visible_in_setup;

  select to_jsonb(g.*) into row_json
    from public.game_type_visibility g
   where g.app_type = v_app_type;

  return row_json;
end;
$$;

revoke all on table public.game_type_visibility from public, anon, authenticated;
grant select on table public.game_type_visibility to authenticated;

revoke all on function
  public.admin_list_game_type_visibility(),
  public.admin_set_game_type_visibility(text, boolean)
from public, anon, authenticated;

grant execute on function
  public.admin_list_game_type_visibility(),
  public.admin_set_game_type_visibility(text, boolean)
to authenticated;

do $$
begin
  raise notice 'DONE - game type visibility controls (0027) applied.';
end $$;
