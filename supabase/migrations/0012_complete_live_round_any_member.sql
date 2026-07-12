-- Allow any live-round member (not only the scorer) to complete a live round.
-- Used by Home "end live round" so players/viewers can clear a stuck LIVE ROUND card.
-- Re-runnable for development.

create or replace function public.complete_live_round(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
      from public.live_round_members m
     where m.live_round_id = p_id
       and m.user_id = auth.uid()
  ) then
    raise exception 'not authorized to complete live round';
  end if;

  update public.live_rounds
     set status = 'complete'
   where id = p_id
     and status = 'live';

  if found then
    insert into public.live_round_events (live_round_id, type, payload)
    values (p_id, 'round_finished', '{}'::jsonb);
  end if;
end;
$$;

grant execute on function public.complete_live_round(uuid) to authenticated;
