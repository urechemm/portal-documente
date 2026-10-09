-- Batch deletion of PBC requests, restricted to administrators and managers.
-- Dependent documents and comments are removed by their existing ON DELETE
-- CASCADE constraints; immutable audit events are retained by the prior fix.
create or replace function public.delete_pbc_requests(p_requests uuid[])
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_deleted integer := 0;
  v_request record;
begin
  if coalesce(array_length(p_requests,1),0)=0 then
    return 0;
  end if;

  if exists(
    select 1
    from (select distinct unnest(p_requests) as id) selected
    left join public.pbc_requests request on request.id=selected.id
    where request.id is null
       or not (
         public.is_global_admin()
         or public.firm_role(request.audit_firm_id) in ('admin','manager')
       )
  ) then
    raise exception 'Una sau mai multe cerințe nu există sau nu pot fi șterse de utilizatorul curent.';
  end if;

  for v_request in
    select id, audit_firm_id, engagement_id, code, title
    from public.pbc_requests
    where id=any(p_requests)
  loop
    insert into public.audit_events(
      audit_firm_id, engagement_id, request_id, actor_id, action, details
    ) values (
      v_request.audit_firm_id,
      v_request.engagement_id,
      v_request.id,
      auth.uid(),
      'REQUEST_DELETED',
      jsonb_build_object(
        'message','Cerință ștearsă',
        'request_id',v_request.id,
        'code',v_request.code,
        'title',v_request.title
      )
    );
  end loop;

  delete from public.pbc_requests
  where id=any(p_requests);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

revoke all on function public.delete_pbc_requests(uuid[]) from public, anon;
grant execute on function public.delete_pbc_requests(uuid[]) to authenticated, service_role;
