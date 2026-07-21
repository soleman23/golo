-- 0025 — Betting-term acceptance (Phase 4, DB foundation).
--
-- No player is included in a GoLo bet until they have accepted the exact terms.
-- A frozen, versioned, hashed snapshot of the betting setup lives in
-- round_betting_terms; one acceptance row per participant lives in
-- round_betting_acceptances. A bet is "active" only when every included
-- participant has accepted the CURRENT version. A material change creates a new
-- version and resets everyone to pending. The organizer can never accept for
-- another user (respond_betting_terms only ever touches auth.uid()'s own row).
--
-- Notifications reuse Phases 1-3: finalize inserts 'betting_terms_requested'
-- notifications directly (category 'betting', push on by default), which the
-- enqueue trigger (0024) turns into push jobs. Idempotent.

-- ------------------------------------------------------------------- tables
create table if not exists public.round_betting_terms (
  id            uuid primary key default extensions.gen_random_uuid(),
  round_id      uuid not null references public.live_rounds (id) on delete cascade,
  version       integer not null,
  terms_hash    text not null,
  terms         jsonb not null,
  max_exposure  numeric,               -- client-computed when knowable, else null
  created_by    uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  superseded_at timestamptz,
  unique (round_id, version)
);

create index if not exists rbt_round_current_idx
  on public.round_betting_terms (round_id)
  where superseded_at is null;

create table if not exists public.round_betting_acceptances (
  id             uuid primary key default extensions.gen_random_uuid(),
  round_id       uuid not null references public.live_rounds (id) on delete cascade,
  terms_id       uuid not null references public.round_betting_terms (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'superseded')),
  accepted_at    timestamptz,
  declined_at    timestamptz,
  responded_meta jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (terms_id, user_id)
);

create index if not exists rba_round_idx on public.round_betting_acceptances (round_id);
create index if not exists rba_user_idx on public.round_betting_acceptances (user_id);

alter table public.round_betting_terms enable row level security;
alter table public.round_betting_acceptances enable row level security;

-- --------------------------------------------------------------------- RLS
-- Any round member may READ terms + everyone's acceptance status (the organizer
-- needs the full picture). Writes happen only through the RPCs below — no client
-- insert/update policy, so nobody can forge terms or respond for another user.
drop policy if exists rbt_select_member on public.round_betting_terms;
create policy rbt_select_member on public.round_betting_terms
  for select to authenticated using (public.is_live_member(round_id));

drop policy if exists rba_select_member on public.round_betting_acceptances;
create policy rba_select_member on public.round_betting_acceptances
  for select to authenticated using (public.is_live_member(round_id));

-- ---------------------------------------------- notification category wiring
-- Extend the shared type->category + push-default maps (0024) with betting.
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
    else 'game_changes'
  end;
$$;

-- Betting is a high-priority actionable alert → push on by default (with settle).
create or replace function public.notif_push_enabled(p_uid uuid, p_category text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select push_enabled from public.notification_preferences
       where user_id = p_uid and event_type = p_category),
    case when p_category in ('settle', 'betting', 'payments') then true else false end
  );
$$;

-- --------------------------------------------------------------------- RPCs
-- Freeze the current betting setup as a new version, reset acceptances, and
-- notify every included participant. Caller must be the round's scorer/owner.
create or replace function public.finalize_betting_terms(
  p_round_id uuid,
  p_terms jsonb,
  p_max_exposure numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  v_version integer;
  v_terms_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.live_rounds
     where id = p_round_id and status = 'live' and (scorer_user_id = uid or owner_id = uid)
  ) then
    raise exception 'not authorized to set betting terms for this round';
  end if;

  -- Supersede the prior current version + its outstanding acceptances.
  update public.round_betting_terms
     set superseded_at = now()
   where round_id = p_round_id and superseded_at is null;

  update public.round_betting_acceptances a
     set status = 'superseded'
    from public.round_betting_terms t
   where a.terms_id = t.id and t.round_id = p_round_id
     and a.status in ('pending', 'accepted');

  select coalesce(max(version), 0) + 1 into v_version
    from public.round_betting_terms where round_id = p_round_id;

  insert into public.round_betting_terms (round_id, version, terms_hash, terms, max_exposure, created_by)
  values (p_round_id, v_version, md5(p_terms::text), p_terms, p_max_exposure, uid)
  returning id into v_terms_id;

  -- One acceptance per betting participant (scorer + players). The organizer, by
  -- finalizing, accepts their own — never anyone else's.
  insert into public.round_betting_acceptances (round_id, terms_id, user_id, status, accepted_at)
  select p_round_id, v_terms_id, m.user_id,
         case when m.user_id = uid then 'accepted' else 'pending' end,
         case when m.user_id = uid then now() else null end
    from public.live_round_members m
   where m.live_round_id = p_round_id and m.role in ('scorer', 'player')
  on conflict (terms_id, user_id) do nothing;

  -- Notify every included participant except the organizer.
  insert into public.notifications
    (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
  select m.user_id,
         'betting_terms_requested',
         'Betting terms are ready for review',
         'Review and accept the betting terms for your round.',
         p_round_id,
         uid,
         '/betting/' || p_round_id::text,
         jsonb_build_object('terms_id', v_terms_id, 'version', v_version),
         'lr:' || p_round_id::text || ':betting:' || v_terms_id::text
    from public.live_round_members m
   where m.live_round_id = p_round_id and m.role in ('scorer', 'player') and m.user_id <> uid
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  return jsonb_build_object('terms_id', v_terms_id, 'version', v_version);
end;
$$;

-- Accept or decline the CURRENT terms — only ever the caller's own acceptance.
create or replace function public.respond_betting_terms(
  p_terms_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_round uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select round_id into v_round
    from public.round_betting_terms
   where id = p_terms_id and superseded_at is null;
  if v_round is null then
    raise exception 'betting terms not found or superseded';
  end if;

  update public.round_betting_acceptances
     set status      = case when p_accept then 'accepted' else 'declined' end,
         accepted_at = case when p_accept then now() else accepted_at end,
         declined_at = case when p_accept then declined_at else now() end
   where terms_id = p_terms_id and user_id = uid;

  if not found then
    raise exception 'not a betting participant for these terms';
  end if;
end;
$$;

-- True when a current terms version exists and every included participant has
-- accepted it. The payout flow gates on this before treating a bet as binding.
create or replace function public.is_betting_active(p_round_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
      select 1 from public.round_betting_terms t
       where t.round_id = p_round_id and t.superseded_at is null
    )
    and not exists (
      select 1
        from public.round_betting_acceptances a
        join public.round_betting_terms t on t.id = a.terms_id
       where t.round_id = p_round_id and t.superseded_at is null and a.status <> 'accepted'
    );
$$;

-- --------------------------------------------- late joiners must also accept
-- Terms are locked at Start Round, when only the scorer is a member. As each
-- player later joins the live round, create their pending acceptance for the
-- current terms and notify them to review. Viewers are not betting participants.
create or replace function public.enqueue_betting_acceptance_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terms_id uuid;
  v_version  integer;
  v_creator  uuid;
begin
  if new.role not in ('player', 'scorer') then
    return new;
  end if;

  select id, version, created_by into v_terms_id, v_version, v_creator
    from public.round_betting_terms
   where round_id = new.live_round_id and superseded_at is null
   order by version desc
   limit 1;

  if v_terms_id is null then
    return new;  -- no locked terms yet (e.g. the scorer at Start Round)
  end if;

  insert into public.round_betting_acceptances (round_id, terms_id, user_id, status, accepted_at)
  values (new.live_round_id, v_terms_id, new.user_id,
          case when new.user_id = v_creator then 'accepted' else 'pending' end,
          case when new.user_id = v_creator then now() else null end)
  on conflict (terms_id, user_id) do nothing;

  if new.user_id <> v_creator then
    insert into public.notifications
      (user_id, type, title, message, round_id, actor_user_id, action_url, payload, dedupe_key)
    values (new.user_id, 'betting_terms_requested',
            'Betting terms are ready for review',
            'Review and accept the betting terms for your round.',
            new.live_round_id, v_creator,
            '/betting/' || new.live_round_id::text,
            jsonb_build_object('terms_id', v_terms_id, 'version', v_version),
            'lr:' || new.live_round_id::text || ':betting:' || v_terms_id::text)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists live_member_betting_acceptance on public.live_round_members;
create trigger live_member_betting_acceptance
  after insert on public.live_round_members
  for each row execute function public.enqueue_betting_acceptance_on_join();

-- ------------------------------------------------------------------- Realtime
do $$
begin
  alter publication supabase_realtime add table public.round_betting_acceptances;
exception when duplicate_object then null;
end $$;

-- --------------------------------------------------------------------- grants
-- Client RPCs → authenticated. is_betting_active is read by the app; the two
-- category helpers stay internal (trigger-only).
revoke all on function
  public.finalize_betting_terms(uuid, jsonb, numeric),
  public.respond_betting_terms(uuid, boolean),
  public.is_betting_active(uuid),
  public.enqueue_betting_acceptance_on_join(),
  public.notif_category(text),
  public.notif_push_enabled(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.finalize_betting_terms(uuid, jsonb, numeric),
  public.respond_betting_terms(uuid, boolean),
  public.is_betting_active(uuid)
to authenticated;

do $$
begin
  raise notice 'DONE — betting-term acceptance foundation (0025) applied.';
end $$;
