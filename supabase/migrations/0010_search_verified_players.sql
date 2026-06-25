-- 0010 — Search onboarded GoLo players when building a round roster.
-- Returns contact info needed for live-round invites; excludes the caller.

create or replace function public.search_verified_players(
  p_query text,
  p_limit int default 20
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  q text := lower(trim(coalesce(p_query, '')));
  q_digits text := regexp_replace(q, '\D', '', 'g');
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if length(q) < 2 then
    return;
  end if;

  return query
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'nickname', p.nickname,
    'email', p.email,
    'phone', p.phone,
    'handicap_index', p.handicap_index
  )
  from public.profiles p
  where p.id != uid
    and p.onboarded = true
    and (
      nullif(trim(p.email), '') is not null
      or nullif(trim(p.phone), '') is not null
    )
    and (
      lower(coalesce(p.name, '')) like '%' || q || '%'
      or lower(coalesce(p.nickname, '')) like '%' || q || '%'
      or lower(coalesce(p.email, '')) like '%' || q || '%'
      or (length(q_digits) >= 3 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || q_digits || '%')
    )
  order by p.name nulls last, p.nickname nulls last
  limit lim;
end;
$$;

grant execute on function public.search_verified_players(text, int) to authenticated;
