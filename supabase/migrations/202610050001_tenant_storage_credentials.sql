-- Credențiale de stocare separate per firmă de audit.
-- Refresh tokenul este criptat de Supabase Vault și nu este expus prin API.
create extension if not exists supabase_vault with schema vault;

create table if not exists public.storage_credentials (
  audit_firm_id uuid primary key references public.audit_firms(id) on delete cascade,
  onedrive_tenant_id text not null,
  onedrive_refresh_secret_id uuid not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.storage_credentials enable row level security;
revoke all on public.storage_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.storage_credentials to service_role;

create or replace function public.set_onedrive_credential(
  p_audit_firm_id uuid,
  p_tenant_id text,
  p_refresh_token text,
  p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path=public, vault
as $$
declare
  v_secret_id uuid;
begin
  if length(btrim(p_tenant_id)) = 0 or length(btrim(p_refresh_token)) < 20 then
    raise exception 'Tenant ID și refresh token sunt obligatorii.';
  end if;

  select onedrive_refresh_secret_id into v_secret_id
  from public.storage_credentials
  where audit_firm_id = p_audit_firm_id;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_refresh_token,
      'portal_documente_onedrive_' || replace(p_audit_firm_id::text, '-', ''),
      'OneDrive refresh token pentru firma de audit ' || p_audit_firm_id::text
    );
    insert into public.storage_credentials(audit_firm_id, onedrive_tenant_id, onedrive_refresh_secret_id, updated_by)
    values(p_audit_firm_id, btrim(p_tenant_id), v_secret_id, p_updated_by);
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
    update public.storage_credentials
    set onedrive_tenant_id = btrim(p_tenant_id), updated_by = p_updated_by, updated_at = now()
    where audit_firm_id = p_audit_firm_id;
  end if;
end
$$;

create or replace function public.get_onedrive_credential(p_audit_firm_id uuid)
returns table(tenant_id text, refresh_token text)
language sql
stable
security definer
set search_path=public, vault
as $$
  select c.onedrive_tenant_id, s.decrypted_secret
  from public.storage_credentials c
  join vault.decrypted_secrets s on s.id = c.onedrive_refresh_secret_id
  where c.audit_firm_id = p_audit_firm_id
$$;

revoke all on function public.set_onedrive_credential(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.get_onedrive_credential(uuid) from public, anon, authenticated;
grant execute on function public.set_onedrive_credential(uuid,text,text,uuid) to service_role;
grant execute on function public.get_onedrive_credential(uuid) to service_role;
