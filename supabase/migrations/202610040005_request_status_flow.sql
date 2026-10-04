-- Cerintele asignate sunt solicitate imediat. Upload-urile efectuate de
-- Edge Function trebuie sa poata activa triggerul document_marks_received.
create or replace function public.validate_request_update()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_role public.portal_role;
  only_status_changed boolean;
begin
  new.updated_at := now();

  -- Apelurile backend folosesc service_role si sunt validate in Edge Function.
  if auth.role() = 'service_role' then
    return new;
  end if;

  actor_role := public.firm_role(old.audit_firm_id);
  only_status_changed :=
    (to_jsonb(new) - array['status','updated_at']) =
    (to_jsonb(old) - array['status','updated_at']);

  if actor_role = 'client' then
    if (to_jsonb(new) - array['status','not_applicable_reason','updated_at']) <>
       (to_jsonb(old) - array['status','not_applicable_reason','updated_at']) then
      raise exception 'Clientul nu poate modifica datele cerintei.';
    end if;
    if new.status <> 'not_applicable' or length(btrim(new.not_applicable_reason)) < 15 then
      raise exception 'Explicatia pentru Nu se aplica este obligatorie.';
    end if;
  elsif actor_role is null and not public.is_global_admin() then
    -- Permite exclusiv corectarea controlata a cerintelor draft deja asignate.
    if not (old.status = 'draft' and new.status = 'requested'
      and new.client_owner_id is not null and only_status_changed) then
      raise exception 'Acces interzis.';
    end if;
  end if;

  return new;
end
$$;

-- Cerintele existente, deja asignate unui client, devin vizibil solicitate.
update public.pbc_requests
set status = 'requested'
where status = 'draft'
  and client_owner_id is not null;
