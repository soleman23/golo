-- 0037 — Safe batch profile name lookup (replaces broken public_profiles reads).
--
-- 0018 set public_profiles to security_invoker=true, so profiles_select_own
-- applies and authenticated clients can only resolve their OWN name. Betting
-- Review and fetchProfileNames then show "Player" for everyone else.
--
-- Fix: a SECURITY DEFINER RPC that returns only id / name / nickname for IDs
-- that share a live round with the caller (or the caller's own row). Do not
-- broaden profiles SELECT. Leave the invoker view in place (advisor-safe) and
-- revoke the dead anon grant on it.

create or replace function public.get_profile_names(p_ids uuid[])
returns table (id uuid, name text, nickname text)
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
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  return query
  select p.id, p.name, p.nickname
    from public.profiles p
   where p.id = any (p_ids)
     and (
       p.id = uid
       or exists (
         select 1
           from public.live_round_members me
           join public.live_round_members them
             on them.live_round_id = me.live_round_id
          where me.user_id = uid
            and them.user_id = p.id
       )
     );
end;
$$;

revoke all on function public.get_profile_names(uuid[])
from public, anon, authenticated;

grant execute on function public.get_profile_names(uuid[]) to authenticated;

-- Dead after 0018+invoker + App requiring a session: anon cannot usefully read
-- other profiles anyway, and own-row RLS would only return nothing for anon.
revoke all on public.public_profiles from anon;

do $$
begin
  raise notice 'DONE — get_profile_names + public_profiles anon revoke (0037).';
end $$;
