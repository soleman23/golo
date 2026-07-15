-- Bootstrap the commissioner account so the admin desk appears for the owner.
-- Re-runnable; keep in sync with public.is_app_admin() so all admin RPCs agree.

update public.profiles
   set is_admin = true,
       updated_at = now()
 where lower(coalesce(email, '')) = 'devinp.sole@gmail.com';

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
       and (
         is_admin = true
         or lower(coalesce(email, '')) = 'devinp.sole@gmail.com'
       )
  );
$$;

grant execute on function public.is_app_admin() to authenticated;
