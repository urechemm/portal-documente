-- Administratorii, managerii si auditorii activi ai firmei pot crea/importa
-- cerinte pentru orice misiune care apartine aceleiasi firme de audit.
drop policy if exists requests_insert on public.pbc_requests;

create policy requests_insert
on public.pbc_requests
for insert
with check (
  public.is_global_admin()
  or (
    public.firm_role(audit_firm_id) in ('admin', 'manager', 'auditor')
    and exists (
      select 1
      from public.engagements e
      where e.id = engagement_id
        and e.audit_firm_id = audit_firm_id
    )
  )
);
