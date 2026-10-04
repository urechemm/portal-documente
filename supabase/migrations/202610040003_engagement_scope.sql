alter table public.entities
  add column if not exists address text not null default '',
  add column if not exists contact_name text not null default '',
  add column if not exists email text not null default '';

alter table public.engagements
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists financial_statement_date date,
  add column if not exists confirmation_date date,
  add column if not exists auditor_id uuid references public.profiles(id),
  add column if not exists client_id uuid references public.profiles(id);

update public.engagements
set auditor_id = coalesce(auditor_id, manager_id)
where auditor_id is null;

create index if not exists engagements_auditor_idx on public.engagements(audit_firm_id, auditor_id);
create index if not exists engagements_client_idx on public.engagements(audit_firm_id, client_id);

drop policy if exists entities_write on public.entities;
create policy entities_write on public.entities for all
using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'))
with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'));

drop policy if exists engagements_write on public.engagements;
create policy engagements_write on public.engagements for all
using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'))
with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'));

drop policy if exists engagement_users_write on public.engagement_users;
create policy engagement_users_write on public.engagement_users for all
using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'))
with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'));

create or replace function public.can_access_request(p_request uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.pbc_requests r
    where r.id=p_request
      and public.can_access_engagement(r.engagement_id,p_user)
      and (public.is_global_admin(p_user) or public.firm_role(r.audit_firm_id,p_user)<>'client' or r.client_owner_id=p_user)
  )
$$;
revoke all on function public.can_access_request(uuid,uuid) from public,anon;
grant execute on function public.can_access_request(uuid,uuid) to authenticated,service_role;

drop policy if exists requests_select on public.pbc_requests;
create policy requests_select on public.pbc_requests for select using(public.can_access_request(id));
drop policy if exists requests_update on public.pbc_requests;
create policy requests_update on public.pbc_requests for update using(public.can_access_request(id)) with check(public.can_access_request(id));
drop policy if exists requests_insert on public.pbc_requests;
create policy requests_insert on public.pbc_requests for insert with check(
  public.is_global_admin() or (
    public.firm_role(audit_firm_id) in('admin','manager','auditor')
    and exists(select 1 from public.engagements e where e.id=engagement_id and e.audit_firm_id=audit_firm_id and (public.firm_role(audit_firm_id)='admin' or e.auditor_id=auth.uid() or exists(select 1 from public.engagement_users eu where eu.engagement_id=e.id and eu.user_id=auth.uid())))
  )
);

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select using(public.can_access_request(request_id));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert with check(uploaded_by=auth.uid() and public.can_access_request(request_id));
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using(public.can_access_request(request_id));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert with check(author_id=auth.uid() and public.can_access_request(request_id));
