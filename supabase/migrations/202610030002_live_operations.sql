-- Live write policies and immutable audit events.
create policy global_admin_self on public.global_admins for select using(user_id=auth.uid());
create policy profiles_update_self on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy firms_manage on public.audit_firms for all using(public.is_global_admin()) with check(public.is_global_admin());
create policy memberships_manage on public.audit_firm_users for all using(public.is_global_admin() or public.firm_role(audit_firm_id)='admin') with check(public.is_global_admin() or public.firm_role(audit_firm_id)='admin');
create policy entities_write on public.entities for all using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager')) with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager'));
create policy engagements_write on public.engagements for all using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager')) with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager'));
create policy engagement_users_write on public.engagement_users for all using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager')) with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager'));
create policy requests_insert on public.pbc_requests for insert with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'));
create policy requests_update on public.pbc_requests for update using(public.can_access_engagement(engagement_id)) with check(public.can_access_engagement(engagement_id));
create policy documents_insert on public.documents for insert with check(uploaded_by=auth.uid() and exists(select 1 from public.pbc_requests r where r.id=request_id and public.can_access_engagement(r.engagement_id)));
create policy documents_update on public.documents for update using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor')) with check(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'));
create policy comments_insert on public.comments for insert with check(author_id=auth.uid() and exists(select 1 from public.pbc_requests r where r.id=request_id and public.can_access_engagement(r.engagement_id)));
create policy settings_write_admin on public.app_settings for all using(public.is_global_admin() or public.firm_role(audit_firm_id)='admin') with check(public.is_global_admin() or public.firm_role(audit_firm_id)='admin');

create or replace function public.validate_request_update() returns trigger language plpgsql security definer set search_path=public as $$
declare actor_role public.portal_role;
begin
 actor_role:=public.firm_role(old.audit_firm_id);
 if actor_role='client' then
  if (to_jsonb(new)-array['status','not_applicable_reason','updated_at'])<>(to_jsonb(old)-array['status','not_applicable_reason','updated_at']) then raise exception 'Clientul nu poate modifica datele cerinței.'; end if;
  if new.status<>'not_applicable' or length(btrim(new.not_applicable_reason))<15 then raise exception 'Explicația pentru Nu se aplică este obligatorie.'; end if;
 elsif actor_role is null and not public.is_global_admin() then raise exception 'Acces interzis.';
 end if;
 new.updated_at:=now();
 return new;
end$$;
create trigger pbc_requests_validate before update on public.pbc_requests for each row execute function public.validate_request_update();

create or replace function public.append_business_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare firm uuid; engagement uuid; request uuid; message text;
begin
 firm:=coalesce(new.audit_firm_id,old.audit_firm_id);
 if tg_table_name='pbc_requests' then engagement:=coalesce(new.engagement_id,old.engagement_id); request:=coalesce(new.id,old.id); message:='Cerință actualizată';
 elsif tg_table_name in('documents','comments') then request:=coalesce(new.request_id,old.request_id); select engagement_id into engagement from pbc_requests where id=request; message:=case when tg_table_name='documents' then 'Document încărcat' else 'Comentariu adăugat' end;
 elsif tg_table_name='engagements' then engagement:=coalesce(new.id,old.id); message:='Engagement actualizat';
 else message:='Înregistrare actualizată'; end if;
 insert into audit_events(audit_firm_id,engagement_id,request_id,actor_id,action,details)
 values(firm,engagement,request,auth.uid(),upper(tg_op||'_'||tg_table_name),jsonb_build_object('message',message,'record_id',coalesce(new.id,old.id)));
 return coalesce(new,old);
end$$;
create trigger pbc_requests_audit after insert or update on public.pbc_requests for each row execute function public.append_business_audit();
create trigger documents_audit after insert or update on public.documents for each row execute function public.append_business_audit();
create trigger comments_audit after insert on public.comments for each row execute function public.append_business_audit();
create trigger engagements_audit after insert or update on public.engagements for each row execute function public.append_business_audit();

create or replace function public.document_received() returns trigger language plpgsql security definer set search_path=public as $$
begin update pbc_requests set status='received',updated_at=now() where id=new.request_id and status in('draft','requested','clarification'); return new; end$$;
create trigger document_marks_received after insert on public.documents for each row execute function public.document_received();

-- One-time bootstrap helper. Callable only from the dashboard/service role.
create or replace function public.bootstrap_portal(p_admin_email text,p_firm_name text,p_firm_code text) returns uuid language plpgsql security definer set search_path=public as $$
declare admin_id uuid; firm_id uuid;
begin
 select id into admin_id from profiles where lower(email)=lower(p_admin_email);
 if admin_id is null then raise exception 'Utilizatorul Auth nu există.'; end if;
 insert into global_admins(user_id) values(admin_id) on conflict do nothing;
 insert into audit_firms(name,code) values(btrim(p_firm_name),upper(btrim(p_firm_code))) on conflict(code) do update set name=excluded.name returning id into firm_id;
 insert into audit_firm_users(audit_firm_id,user_id,role,active) values(firm_id,admin_id,'admin',true) on conflict(audit_firm_id,user_id) do update set role='admin',active=true;
 insert into app_settings(audit_firm_id) values(firm_id) on conflict do nothing;
 return firm_id;
end$$;
revoke execute on function public.bootstrap_portal(text,text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_portal(text,text,text) to service_role;
