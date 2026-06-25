-- 0010 — Search onboarded GoLo players when building a round roster.
-- Returns just enough to recognise a player (name, handle, handicap, MASKED
-- contact); never raw email/phone, so the endpoint can't be used to bulk-scrape
-- the user base. The caller fetches a single player's real contact via
-- get_player_contact() only at the moment they add them to a round.

-- ------------------------------------------------- masking helpers (display)
-- "john@gmail.com" -> "j•••@gmail.com"; everything before '@' collapses to
-- first char + bullets. No '@' (shouldn't happen) -> first char + bullets.
create or replace function public.mask_email(e text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(e), '') is null then null
    when position('@' in e) > 1
      then left(e, 1) || '•••' || substring(e from position('@' in e))
    else left(e, 1) || '•••'
  end;
$$;

-- "(555) 123-4567" -> "•••4567" (last 4 digits). Fewer than 4 digits -> bullets.
create or replace function public.mask_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 4
      then '•••' || right(regexp_replace(p, '\D', '', 'g'), 4)
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) > 0
      then '•••'
    else null
  end;
$$;

-- --------------------------------------------------------------- list search
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
  -- Escape LIKE metacharacters so a query like "a%" or "a_b" can't act as a
  -- wildcard pattern. Backslash first, then % and _.
  q_esc text;
  q_digits text := regexp_replace(q, '\D', '', 'g');
  lim int := greatest(1, least(coalesce(p_limit, 20), 25));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if length(q) < 2 then
    return;
  end if;

  q_esc := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'nickname', p.nickname,
    'handicap_index', p.handicap_index,
    'email_masked', public.mask_email(p.email),
    'phone_masked', public.mask_phone(p.phone),
    'has_email', nullif(trim(p.email), '') is not null,
    'has_phone', nullif(trim(p.phone), '') is not null
  )
  from public.profiles p
  where p.id != uid
    and p.onboarded = true
    and (
      nullif(trim(p.email), '') is not null
      or nullif(trim(p.phone), '') is not null
    )
    and (
      lower(coalesce(p.name, '')) like '%' || q_esc || '%' escape '\'
      or lower(coalesce(p.nickname, '')) like '%' || q_esc || '%' escape '\'
      or lower(coalesce(p.email, '')) like '%' || q_esc || '%' escape '\'
      or (length(q_digits) >= 3 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || q_digits || '%')
    )
  order by p.name nulls last, p.nickname nulls last
  limit lim;
end;
$$;

grant execute on function public.search_verified_players(text, int) to authenticated;

-- ----------------------------------------------- single-record contact reveal
-- Returns one onboarded player's real contact, for the moment the caller adds
-- them to a round. Single-id lookup (not a substring scan) so it can't dump the
-- table in one call. NOTE: a caller could still iterate ids one at a time — add
-- Supabase rate limiting / request logging on this function as a follow-up.
create or replace function public.get_player_contact(p_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'nickname', p.nickname,
      'email', p.email,
      'phone', p.phone,
      'handicap_index', p.handicap_index
    )
    from public.profiles p
    where p.id = p_id
      and p.id != uid
      and p.onboarded = true
  );
end;
$$;

grant execute on function public.get_player_contact(uuid) to authenticated;
