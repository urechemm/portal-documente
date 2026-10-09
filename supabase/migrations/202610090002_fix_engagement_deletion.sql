-- Allow only FK cleanup inside otherwise immutable audit rows.
create or replace function public.protect_audit_events()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='UPDATE'
    and (to_jsonb(new) - array['request_id','engagement_id'])
        = (to_jsonb(old) - array['request_id','engagement_id'])
    and (new.request_id is not distinct from old.request_id or new.request_id is null)
    and (new.engagement_id is not distinct from old.engagement_id or new.engagement_id is null)
  then
    return new;
  end if;
  raise exception 'Audit trail-ul este imuabil.';
end
$$;

-- Locate the existing immutable trigger by its function body, independently
-- of the trigger/function name used by older installations.
do $$
declare
  v_trigger text;
begin
  for v_trigger in
    select t.tgname
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    where n.nspname='public'
      and c.relname='audit_events'
      and not t.tgisinternal
      and pg_get_functiondef(p.oid) like '%Audit trail-ul este imuabil%'
  loop
    execute format('drop trigger %I on public.audit_events',v_trigger);
  end loop;
end
$$;

drop trigger if exists audit_events_protect on public.audit_events;
create trigger audit_events_protect
before update or delete on public.audit_events
for each row execute function public.protect_audit_events();

drop policy if exists engagements_delete on public.engagements;
create policy engagements_delete on public.engagements
for delete
using(
  public.is_global_admin()
  or public.firm_role(audit_firm_id) in ('admin','manager','auditor')
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
    or public.firm_role(v_firm) in ('admin','manager','auditor')
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
