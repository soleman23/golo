-- 0028 — Fix create_payment_requests scorer-slot mapping.
--
-- 0026 resolved a settlement's round-slot to a member only via
-- live_round_members.slot_player_id, which is NULL for the scorer (the organizer
-- never "claims" a slot through join_live_round). As a result the organizer's
-- own settlements produced no payment request. This re-defines the function to
-- also resolve a slot to the scorer when the scorer's profile identity matches
-- the slot's player_key in live_round_slots. 0026 is already applied, so the fix
-- ships here as create-or-replace. Idempotent.

create or replace function public.create_payment_requests(
  p_round_id uuid,
  p_settlements jsonb,
  p_snapshot jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  s jsonb;
  payer uuid;
  recipient uuid;
  from_slot uuid;
  to_slot uuid;
  amt numeric;
  created int := 0;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.live_rounds where id = p_round_id and (scorer_user_id = uid or owner_id = uid)
  ) then
    raise exception 'not authorized to create payment requests for this round';
  end if;

  for s in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb))
  loop
    amt := nullif(s->>'amount', '')::numeric;
    from_slot := nullif(s->>'from', '')::uuid;
    to_slot := nullif(s->>'to', '')::uuid;
    if amt is null or amt <= 0 or from_slot is null or to_slot is null then
      continue;
    end if;

    -- Claimed roster slots map through live_round_members.slot_player_id. The
    -- organizer/scorer is inserted before claiming a slot, so fall back to their
    -- profile-derived player key when it matches the roster slot key.
    select coalesce(claimed.user_id, scorer.user_id) into payer
      from public.live_round_slots s
      left join public.live_round_members claimed
        on claimed.live_round_id = s.live_round_id
       and claimed.slot_player_id = s.slot_id
       and claimed.role in ('player', 'scorer')
      left join lateral (
        select m.user_id
          from public.live_rounds lr
          join public.live_round_members m
            on m.live_round_id = lr.id
           and m.user_id = lr.scorer_user_id
           and m.role = 'scorer'
          join public.profiles p on p.id = m.user_id
         where lr.id = s.live_round_id
           and public.player_key_from_player_json(
                 jsonb_build_object('email', p.email, 'phone', p.phone, 'name', p.name, 'guest', false)
               ) = s.player_key
         limit 1
      ) scorer on true
     where s.live_round_id = p_round_id
       and s.slot_id = from_slot
     limit 1;

    select coalesce(claimed.user_id, scorer.user_id) into recipient
      from public.live_round_slots s
      left join public.live_round_members claimed
        on claimed.live_round_id = s.live_round_id
       and claimed.slot_player_id = s.slot_id
       and claimed.role in ('player', 'scorer')
      left join lateral (
        select m.user_id
          from public.live_rounds lr
          join public.live_round_members m
            on m.live_round_id = lr.id
           and m.user_id = lr.scorer_user_id
           and m.role = 'scorer'
          join public.profiles p on p.id = m.user_id
         where lr.id = s.live_round_id
           and public.player_key_from_player_json(
                 jsonb_build_object('email', p.email, 'phone', p.phone, 'name', p.name, 'guest', false)
               ) = s.player_key
         limit 1
      ) scorer on true
     where s.live_round_id = p_round_id
       and s.slot_id = to_slot
     limit 1;

    if payer is null or recipient is null or payer = recipient then
      continue;
    end if;

    new_id := null;
    insert into public.payment_requests
      (round_id, payer_user_id, recipient_user_id, payer_slot_id, recipient_slot_id, amount, calculation_snapshot, created_by)
    values (p_round_id, payer, recipient, from_slot, to_slot, amt, coalesce(p_snapshot, '{}'::jsonb), uid)
    on conflict (round_id, payer_user_id, recipient_user_id) do nothing
    returning id into new_id;

    if new_id is not null then
      created := created + 1;
      perform public.notify_payment(
        payer, uid, 'payment_requested',
        'You have a new GoLo payment request',
        'Open GoLo to see the settlement and send your payment.',
        p_round_id, new_id, 'payreq');
    end if;
  end loop;

  return created;
end;
$$;

-- create-or-replace preserves grants, but re-assert them to match 0020 hardening.
revoke all on function public.create_payment_requests(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_payment_requests(uuid, jsonb, jsonb) to authenticated;

do $$
begin
  raise notice 'DONE — create_payment_requests scorer-slot mapping fix (0028) applied.';
end $$;
