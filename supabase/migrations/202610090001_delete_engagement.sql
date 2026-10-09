-- Only administrators and managers may permanently delete an engagement.
-- Audit events are retained after their referenced business rows are removed.
alter table public.audit_events
  drop constraint if exists audit_events_request_id_fkey,
  add constraint audit_events_request_id_fkey
    foreign key(request_id) references public.pbc_requests(id) on delete set null;

alter table public.audit_events
  drop constraint if exists audit_events_engagement_id_fkey,
  add constraint audit_events_engagement_id_fkey
    foreign key(engagement_id) references public.engagements(id) on delete set null;

drop policy if exists engagements_write on public.engagements;
drop policy if exists engagements_insert on public.engagements;
drop policy if exists engagements_update on public.engagements;
drop policy if exists engagements_delete on public.engagements;

create policy engagements_insert on public.engagements
for insert
with check(
  public.is_global_admin()
  or public.firm_role(audit_firm_id) in ('admin','manager','auditor')
);

create policy engagements_update on public.engagements
for update
using(
  public.is_global_admin()
  or public.firm_role(audit_firm_id) in ('admin','manager','auditor')
)
with check(
  public.is_global_admin()
  or public.firm_role(audit_firm_id) in ('admin','manager','auditor')
);

create policy engagements_delete on public.engagements
for delete
using(
  public.is_global_admin()
  or public.firm_role(audit_firm_id) in ('admin','manager')
);

create or replace function public.delete_engagement(p_engagement uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_firm uuid;
  v_entity uuid;
  v_name text;
begin
  select audit_firm_id, entity_id, name
  into v_firm, v_entity, v_name
  from public.engagements
  where id=p_engagement;

  if v_firm is null then
    raise exception 'Misiunea nu există.';
  end if;

  if not (
    public.is_global_admin()
    or public.firm_role(v_firm) in ('admin','manager')
  ) then
    raise exception 'Acces interzis.';
  end if;

  insert into public.audit_events(
    audit_firm_id, engagement_id, actor_id, action, details
  ) values (
    v_firm,
    p_engagement,
    auth.uid(),
    'ENGAGEMENT_DELETED',
    jsonb_build_object('message','Misiune ștearsă','engagement_id',p_engagement,'name',v_name)
  );

  delete from public.engagements where id=p_engagement;

  delete from public.entities
  where id=v_entity
    and not exists(
      select 1 from public.engagements where entity_id=v_entity
    );
end
$$;

revoke all on function public.delete_engagement(uuid) from public, anon;
grant execute on function public.delete_engagement(uuid) to authenticated, service_role;
