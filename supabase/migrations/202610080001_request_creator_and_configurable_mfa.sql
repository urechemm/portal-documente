-- Keep the request creator distinct from the responsible auditor and make MFA configurable.
alter table public.pbc_requests
  add column if not exists created_by uuid references public.profiles(id);

-- This is a data migration, not an end-user request update. The existing
-- validation trigger checks auth.uid()/roles and therefore rejects a CLI
-- migration session. Disable only the business validation and audit triggers
-- while existing rows are backfilled; PostgreSQL restores them on rollback.
alter table public.pbc_requests disable trigger pbc_requests_validate;
alter table public.pbc_requests disable trigger pbc_requests_audit;

update public.pbc_requests
set created_by = auditor_id
where created_by is null;

alter table public.pbc_requests enable trigger pbc_requests_audit;
alter table public.pbc_requests enable trigger pbc_requests_validate;

alter table public.pbc_requests
  alter column created_by set default auth.uid(),
  alter column created_by set not null;

create or replace function public.set_request_creator()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end
$$;

drop trigger if exists pbc_requests_set_creator on public.pbc_requests;
create trigger pbc_requests_set_creator
before insert or update on public.pbc_requests
for each row execute function public.set_request_creator();

create table if not exists public.portal_security_settings (
  singleton boolean primary key default true check (singleton),
  mfa_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.portal_security_settings(singleton, mfa_enabled)
values (true, true)
on conflict (singleton) do nothing;

alter table public.portal_security_settings enable row level security;
revoke all on public.portal_security_settings from anon, authenticated;

create or replace function public.is_mfa_enabled()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((select mfa_enabled from public.portal_security_settings where singleton), true)
$$;

create or replace function public.has_aal2()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select not public.is_mfa_enabled() or coalesce(auth.jwt()->>'aal','')='aal2'
$$;

create or replace function public.set_mfa_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not (
    exists(select 1 from public.global_admins where user_id=auth.uid())
    or exists(
      select 1 from public.audit_firm_users
      where user_id=auth.uid() and role='admin' and active
    )
  ) then
    raise exception 'Acces interzis.';
  end if;

  insert into public.portal_security_settings(singleton, mfa_enabled, updated_at, updated_by)
  values(true, p_enabled, now(), auth.uid())
  on conflict(singleton) do update
  set mfa_enabled=excluded.mfa_enabled,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by;
end
$$;

revoke all on function public.is_mfa_enabled() from public, anon;
revoke all on function public.set_mfa_enabled(boolean) from public, anon;
grant execute on function public.is_mfa_enabled() to authenticated, service_role;
grant execute on function public.set_mfa_enabled(boolean) to authenticated, service_role;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using(
  id=auth.uid()
  or public.is_global_admin()
  or exists(
    select 1
    from public.audit_firm_users mine
    join public.audit_firm_users theirs using(audit_firm_id)
    where mine.user_id=auth.uid()
      and mine.active
      and theirs.user_id=profiles.id
      and (theirs.active or mine.role='admin')
  )
);
