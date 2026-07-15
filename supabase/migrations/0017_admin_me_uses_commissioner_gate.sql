-- Make the You-page admin check use the same commissioner gate as admin RPCs.
-- This covers accounts whose auth email is not mirrored onto public.profiles.email.

create or replace function public.is_app_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'devinp.sole@gmail.com'
    or exists (
      select 1
        from public.profiles
       where id = auth.uid()
         and (
           is_admin = true
           or lower(coalesce(email, '')) = 'devinp.sole@gmail.com'
         )
    );
$$;

grant execute on function public.is_app_admin() to authenticated;

drop function if exists public.admin_me();
create function public.admin_me()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  row public.profiles%rowtype;
begin
  if uid is null then
    return jsonb_build_object('is_admin', false);
  end if;

  select * into row from public.profiles where id = uid;

  return jsonb_build_object(
    'is_admin', public.is_app_admin(),
    'email', coalesce(nullif(row.email, ''), jwt_email),
    'name', row.name
  );
end;
$$;

grant execute on function public.admin_me() to authenticated;
