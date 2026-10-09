create or replace function public.validate_request_update()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_role public.portal_role;
begin
  new.updated_at := now();
  if auth.role() = 'service_role' then return new; end if;
  actor_role := public.firm_role(old.audit_firm_id);

  if new.id <> old.id or new.audit_firm_id <> old.audit_firm_id
    or new.engagement_id <> old.engagement_id
    or new.created_by is distinct from old.created_by
    or new.created_at <> old.created_at then
    raise exception 'Identitatea si autorul cerintei nu pot fi modificate.';
  end if;

  if actor_role = 'client' and not public.is_global_admin() then
    if old.client_owner_id is distinct from auth.uid()
      or not public.can_access_request(old.id) then
      raise exception 'Acces interzis.';
    end if;
    if (to_jsonb(new) - array['status','not_applicable_reason','updated_at']) <>
       (to_jsonb(old) - array['status','not_applicable_reason','updated_at']) then
      raise exception 'Clientul nu poate modifica datele cerintei.';
    end if;
    if new.status = 'clarification_resolved' and old.status = 'clarification' then
      if new.not_applicable_reason is distinct from old.not_applicable_reason then
        raise exception 'Clientul poate modifica numai statusul clarificarii.';
      end if;
    elsif new.status = 'not_applicable' then
      if length(btrim(new.not_applicable_reason)) < 15 then
        raise exception 'Explicatia pentru Nu se aplica este obligatorie.';
      end if;
    else
      raise exception 'Schimbarea statusului nu este permisa pentru Client.';
    end if;
  elsif not public.is_global_admin() and (actor_role is null or actor_role not in ('admin','manager','auditor')) then
    raise exception 'Acces interzis.';
  end if;

  if new.client_owner_id is distinct from old.client_owner_id then
    if not exists (
      select 1 from public.audit_firm_users u
      join public.engagements e on e.id = new.engagement_id and e.audit_firm_id = u.audit_firm_id
      where u.audit_firm_id = new.audit_firm_id and u.user_id = new.client_owner_id
        and u.active and u.role = 'client'
        and (e.client_id = u.user_id or exists (
          select 1 from public.engagement_users eu
          where eu.engagement_id = e.id and eu.user_id = u.user_id
        ))
    ) then
      raise exception 'Selectati un Client activ inclus in misiune.';
    end if;
  end if;
  return new;
end
$$;

-- Uploading supporting files must preserve the clarification until the client
-- explicitly marks it resolved; subsequent requests for clarification remain possible.
create or replace function public.document_received()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  update public.pbc_requests set status='received', updated_at=now()
  where id=new.request_id and status in ('draft','requested');
  return new;
end
$$;
