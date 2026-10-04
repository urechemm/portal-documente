-- Enforce MFA at the database authorization boundary, not only in the UI.
create or replace function public.has_aal2() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(auth.jwt()->>'aal','')='aal2'
$$;

create or replace function public.is_global_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
  select public.has_aal2() and exists(select 1 from public.global_admins where user_id=p_user)
$$;

create or replace function public.firm_role(p_firm uuid,p_user uuid default auth.uid()) returns public.portal_role
language sql stable security definer set search_path=public as $$
  select case when public.has_aal2() then role else null end
  from public.audit_firm_users
  where audit_firm_id=p_firm and user_id=p_user and active
  limit 1
$$;

revoke execute on function public.has_aal2() from public,anon;
grant execute on function public.has_aal2() to authenticated,service_role;
