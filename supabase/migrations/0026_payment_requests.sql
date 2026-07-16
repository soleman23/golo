-- 0026 — Payment requests & two-step confirmation (Phase 5).
--
-- Settlements are saved on the server as payment_requests, created from LOCKED
-- final results with a frozen calculation_snapshot (so later score edits can't
-- silently change an existing request). The lifecycle is two-step and
-- role-enforced: only the PAYER may mark a request sent, only the RECIPIENT may
-- confirm receipt. Notifications reuse Phases 1-4 (category 'payments', push on).
-- Idempotent.

-- ------------------------------------------------------------------- table
create table if not exists public.payment_requests (
  id                     uuid primary key default extensions.gen_random_uuid(),
  round_id               uuid not null references public.live_rounds (id) on delete cascade,
  payer_user_id          uuid not null references auth.users (id) on delete cascade,
  recipient_user_id      uuid not null references auth.users (id) on delete cascade,
  -- Round-slot ids too, so the client can match a request to a settlement row
  -- without reading other members' identity mapping (RLS hides that).
  payer_slot_id          uuid,
  recipient_slot_id      uuid,
  amount                 numeric not null,
  currency               text not null default 'USD',
  status                 text not null default 'pending'
                         check (status in ('pending', 'viewed', 'marked_sent', 'confirmed', 'disputed', 'cancelled')),
  calculation_snapshot   jsonb not null default '{}'::jsonb,
  payment_method         text,
  external_link          text,
  requested_at           timestamptz not null default now(),
  viewed_at              timestamptz,
  payer_marked_sent_at   timestamptz,
  recipient_confirmed_at timestamptz,
  disputed_at            timestamptz,
  cancelled_at           timestamptz,
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  -- One request per payer->recipient per round: re-running "complete" never
  -- duplicates a payment, and the original frozen snapshot is preserved.
  unique (round_id, payer_user_id, recipient_user_id)
);

create index if not exists payreq_round_idx on public.payment_requests (round_id);
create index if not exists payreq_payer_open_idx
  on public.payment_requests (payer_user_id) where status not in ('confirmed', 'cancelled');
create index if not exists payreq_recipient_open_idx
  on public.payment_requests (recipient_user_id) where status not in ('confirmed', 'cancelled');

alter table public.payment_requests enable row level security;

-- --------------------------------------------------------------------- RLS
-- Round members read all requests for the round (payout screen shows status
-- beside every settlement). Writes only via the RPCs below.
drop policy if exists payreq_select_member on public.payment_requests;
create policy payreq_select_member on public.payment_requests
  for select to authenticated using (public.is_live_member(round_id));

-- --------------------------------------------- notification category wiring
create or replace function public.notif_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'score_updated'           then 'live_score'
    when 'hole_changed'            then 'live_score'
    when 'side_game_flagged'       then 'game_changes'
    when 'player_joined'           then 'game_changes'
    when 'round_finished'          then 'settle'
    when 'betting_terms_requested' then 'betting'
    when 'betting_terms_responded' then 'betting'
    when 'payment_requested'       then 'payments'
    when 'payment_marked_sent'     then 'payments'
    when 'payment_confirmed'       then 'payments'
    when 'payment_disputed'        then 'payments'
    else 'game_changes'
  end;
$$;

-- ---------------------------------------------------- privacy-safe notify helper
-- Inserts a payments notification. Text is privacy-safe (no amounts) — details
-- live inside the authenticated app.
create or replace function public.notify_payment(
  p_user uuid, p_actor uuid, p_type text, p_title text, p_message text,
  p_round uuid, p_payment uuid, p_tag text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications
    (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
  values (
    p_user, p_type, p_title, p_message, p_round, p_actor,
    '/payments/' || p_round::text,
    jsonb_build_object('payment_id', p_payment),
    'lr:' || p_round::text || ':' || p_tag || ':' || p_payment::text
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
$$;

-- --------------------------------------------------------------------- RPCs
-- Create one request per payer->recipient settlement, mapping round-slot ids to
-- member user ids. Only pairs where BOTH slots are claimed by signed-in members
-- get a request (guests have no account for the two-step flow). Notifies the
-- payer. Caller must be the round's scorer/owner (results are locked by them).
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

    select user_id into payer from public.live_round_members
      where live_round_id = p_round_id and slot_player_id = from_slot limit 1;
    select user_id into recipient from public.live_round_members
      where live_round_id = p_round_id and slot_player_id = to_slot limit 1;
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

-- Only the payer marks sent → notifies the recipient.
create or replace function public.mark_payment_sent(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_recipient uuid;
  v_round uuid;
begin
  update public.payment_requests
     set status = 'marked_sent', payer_marked_sent_at = now()
   where id = p_payment_id and payer_user_id = uid and status in ('pending', 'viewed')
  returning recipient_user_id, round_id into v_recipient, v_round;
  if not found then
    raise exception 'not authorized or invalid state';
  end if;
  perform public.notify_payment(
    v_recipient, uid, 'payment_marked_sent',
    'A GoLo payment was marked as sent',
    'Open GoLo to confirm you received it.',
    v_round, p_payment_id, 'paysent');
end;
$$;

-- Only the recipient confirms receipt → notifies the payer.
create or replace function public.confirm_payment_received(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_payer uuid;
  v_round uuid;
begin
  update public.payment_requests
     set status = 'confirmed', recipient_confirmed_at = now()
   where id = p_payment_id and recipient_user_id = uid
     and status in ('pending', 'viewed', 'marked_sent')
  returning payer_user_id, round_id into v_payer, v_round;
  if not found then
    raise exception 'not authorized or invalid state';
  end if;
  perform public.notify_payment(
    v_payer, uid, 'payment_confirmed',
    'Your GoLo payment was confirmed',
    'The recipient confirmed they received your payment.',
    v_round, p_payment_id, 'payconfirm');
end;
$$;

-- Either party disputes → stops the flow, preserves the record.
create or replace function public.dispute_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  update public.payment_requests
     set status = 'disputed', disputed_at = now()
   where id = p_payment_id
     and (payer_user_id = uid or recipient_user_id = uid)
     and status not in ('cancelled', 'confirmed')
  returning id into p_payment_id;
  if not found then
    raise exception 'not authorized or invalid state';
  end if;
end;
$$;

-- Payer opening the request records it as viewed (no notification).
create or replace function public.mark_payment_viewed(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_requests
     set status = 'viewed', viewed_at = coalesce(viewed_at, now())
   where id = p_payment_id and payer_user_id = auth.uid() and status = 'pending';
end;
$$;

-- Organizer cancels an invalid request without deleting history.
create or replace function public.cancel_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  update public.payment_requests
     set status = 'cancelled', cancelled_at = now()
   where id = p_payment_id
     and status <> 'confirmed'
     and round_id in (select id from public.live_rounds where scorer_user_id = uid or owner_id = uid)
  returning id into p_payment_id;
  if not found then
    raise exception 'not authorized or invalid state';
  end if;
end;
$$;

-- ------------------------------------------------------------------- Realtime
do $$
begin
  alter publication supabase_realtime add table public.payment_requests;
exception when duplicate_object then null;
end $$;

-- --------------------------------------------------------------------- grants
revoke all on function
  public.create_payment_requests(uuid, jsonb, jsonb),
  public.mark_payment_sent(uuid),
  public.confirm_payment_received(uuid),
  public.dispute_payment(uuid),
  public.mark_payment_viewed(uuid),
  public.cancel_payment(uuid),
  public.notify_payment(uuid, uuid, text, text, text, uuid, uuid, text),
  public.notif_category(text)
from public, anon, authenticated;

grant execute on function
  public.create_payment_requests(uuid, jsonb, jsonb),
  public.mark_payment_sent(uuid),
  public.confirm_payment_received(uuid),
  public.dispute_payment(uuid),
  public.mark_payment_viewed(uuid),
  public.cancel_payment(uuid)
to authenticated;

do $$
begin
  raise notice 'DONE — payment requests + two-step confirmation (0026) applied.';
end $$;
