-- Credențiale independente pentru SharePoint, OneDrive personal și OneDrive business.
-- Valorile sensibile sunt criptate în Vault și sunt accesibile numai service_role.
create extension if not exists supabase_vault with schema vault;

create table if not exists public.storage_provider_credentials (
  audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,
  provider text not null check (provider in ('sharepoint', 'onedrive_personal', 'onedrive_business')),
  tenant_id_secret_id uuid not null,
  client_id_secret_id uuid not null,
  client_secret_secret_id uuid not null,
  refresh_token_secret_id uuid,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (audit_firm_id, provider),
  check (provider = 'sharepoint' or refresh_token_secret_id is not null)
);

alter table public.storage_provider_credentials enable row level security;
revoke all on public.storage_provider_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.storage_provider_credentials to service_role;

create or replace function public.upsert_storage_secret(
  p_secret_id uuid,
  p_secret text,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path=public, vault
as $$
declare
  v_secret_id uuid := p_secret_id;
begin
  if nullif(btrim(p_secret), '') is null then
    return v_secret_id;
  end if;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_secret, p_name, p_description);
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;
  return v_secret_id;
end
$$;

create or replace function public.set_storage_provider_credential(
  p_audit_firm_id uuid,
  p_provider text,
  p_tenant_id text,
  p_client_id text,
  p_client_secret text,
  p_refresh_token text,
  p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path=public, vault
as $$
declare
  v_tenant_id uuid;
  v_client_id uuid;
  v_client_secret uuid;
  v_refresh_token uuid;
  v_prefix text;
begin
  if p_provider not in ('sharepoint', 'onedrive_personal', 'onedrive_business') then
    raise exception 'Backend-ul de stocare nu este valid.';
  end if;

  select tenant_id_secret_id, client_id_secret_id, client_secret_secret_id, refresh_token_secret_id
  into v_tenant_id, v_client_id, v_client_secret, v_refresh_token
  from public.storage_provider_credentials
  where audit_firm_id = p_audit_firm_id and provider = p_provider;

  v_prefix := 'portal_documente_' || replace(p_audit_firm_id::text, '-', '') || '_' || p_provider;
  v_tenant_id := public.upsert_storage_secret(v_tenant_id, p_tenant_id, v_prefix || '_tenant_id', 'Microsoft tenant ID');
  v_client_id := public.upsert_storage_secret(v_client_id, p_client_id, v_prefix || '_client_id', 'Microsoft application client ID');
  v_client_secret := public.upsert_storage_secret(v_client_secret, p_client_secret, v_prefix || '_client_secret', 'Microsoft application client secret');
  if p_provider <> 'sharepoint' then
    v_refresh_token := public.upsert_storage_secret(v_refresh_token, p_refresh_token, v_prefix || '_refresh_token', 'Microsoft delegated refresh token');
  end if;

  if v_tenant_id is null or v_client_id is null or v_client_secret is null
     or (p_provider <> 'sharepoint' and v_refresh_token is null) then
    raise exception 'Completați toate credențialele pentru backend-ul selectat.';
  end if;

  insert into public.storage_provider_credentials(
    audit_firm_id, provider, tenant_id_secret_id, client_id_secret_id,
    client_secret_secret_id, refresh_token_secret_id, updated_by, updated_at
  ) values (
    p_audit_firm_id, p_provider, v_tenant_id, v_client_id,
    v_client_secret, v_refresh_token, p_updated_by, now()
  )
  on conflict (audit_firm_id, provider) do update set
    tenant_id_secret_id = excluded.tenant_id_secret_id,
    client_id_secret_id = excluded.client_id_secret_id,
    client_secret_secret_id = excluded.client_secret_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end
$$;

create or replace function public.get_storage_provider_credential(p_audit_firm_id uuid, p_provider text)
returns table(tenant_id text, client_id text, client_secret text, refresh_token text)
language sql
stable
security definer
set search_path=public, vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = c.tenant_id_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = c.client_id_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = c.client_secret_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = c.refresh_token_secret_id)
  from public.storage_provider_credentials c
  where c.audit_firm_id = p_audit_firm_id and c.provider = p_provider
$$;

revoke all on function public.upsert_storage_secret(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.set_storage_provider_credential(uuid,text,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.get_storage_provider_credential(uuid,text) from public, anon, authenticated;
grant execute on function public.upsert_storage_secret(uuid,text,text,text) to service_role;
grant execute on function public.set_storage_provider_credential(uuid,text,text,text,text,text,uuid) to service_role;
grant execute on function public.get_storage_provider_credential(uuid,text) to service_role;
