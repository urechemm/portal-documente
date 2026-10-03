-- Portal Documente · schema MVP multi-tenant.
create extension if not exists pgcrypto;
create type public.portal_role as enum ('admin','manager','auditor','client');
create type public.request_status as enum ('draft','requested','received','review','clarification','complete','not_applicable');
create type public.document_status as enum ('new','accepted','replace');

create table public.audit_firms(id uuid primary key default gen_random_uuid(),name text not null,code text not null unique,active boolean not null default true,created_at timestamptz not null default now());
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,name text not null default '',email text not null default '',created_at timestamptz not null default now());
create table public.global_admins(user_id uuid primary key references public.profiles(id) on delete cascade,created_at timestamptz not null default now());
create table public.audit_firm_users(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,role public.portal_role not null,active boolean not null default true,created_at timestamptz not null default now(),unique(audit_firm_id,user_id));
create table public.entities(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,name text not null,cui text not null default '',created_at timestamptz not null default now());
create table public.engagements(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,entity_id uuid not null references public.entities(id),name text not null,period text not null,deadline date,status text not null default 'active' check(status in('active','closed')),manager_id uuid references public.profiles(id),created_at timestamptz not null default now());
create table public.engagement_users(engagement_id uuid not null references public.engagements(id) on delete cascade,audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,primary key(engagement_id,user_id));
create table public.pbc_requests(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,engagement_id uuid not null references public.engagements(id) on delete cascade,code text not null,area text not null,title text not null,description text not null default '',instructions text not null default '',period text not null default '',client_owner_id uuid references public.profiles(id),auditor_id uuid references public.profiles(id),deadline date,priority text not null default 'normal' check(priority in('normal','urgent')),status public.request_status not null default 'draft',not_applicable_reason text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(engagement_id,code));
create table public.documents(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,request_id uuid not null references public.pbc_requests(id) on delete cascade,name text not null,description text not null check(length(btrim(description))>=12),period text not null,uploaded_by uuid not null references public.profiles(id),uploaded_at timestamptz not null default now(),version integer not null check(version>0),status public.document_status not null default 'new',auditor_comment text not null default '',size_bytes bigint not null default 0 check(size_bytes>=0),storage_path text not null,sha256 text,locked_at timestamptz,unique(request_id,name,version));
create table public.comments(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,request_id uuid not null references public.pbc_requests(id) on delete cascade,author_id uuid not null references public.profiles(id),body text not null check(length(btrim(body))>0),urgent boolean not null default false,created_at timestamptz not null default now());
create table public.audit_events(id uuid primary key default gen_random_uuid(),audit_firm_id uuid not null references public.audit_firms(id) on delete cascade,engagement_id uuid references public.engagements(id),request_id uuid references public.pbc_requests(id),actor_id uuid references public.profiles(id),action text not null,details jsonb not null default '{}'::jsonb,ip inet,created_at timestamptz not null default now());
create table public.app_settings(audit_firm_id uuid primary key references public.audit_firms(id) on delete cascade,data jsonb not null default '{"digest_hour":"17:00","retention_years":7}'::jsonb,updated_at timestamptz not null default now());

create index pbc_requests_firm_engagement_idx on public.pbc_requests(audit_firm_id,engagement_id);
create index pbc_requests_status_idx on public.pbc_requests(audit_firm_id,status,deadline);
create index documents_request_idx on public.documents(audit_firm_id,request_id,uploaded_at desc);
create index comments_request_idx on public.comments(audit_firm_id,request_id,created_at);
create index audit_events_firm_created_idx on public.audit_events(audit_firm_id,created_at desc);

create or replace function public.is_global_admin(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.global_admins where user_id=p_user)$$;
create or replace function public.firm_role(p_firm uuid,p_user uuid default auth.uid()) returns public.portal_role language sql stable security definer set search_path=public as $$select role from public.audit_firm_users where audit_firm_id=p_firm and user_id=p_user and active limit 1$$;
create or replace function public.can_access_engagement(p_engagement uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.engagements e where e.id=p_engagement and(public.is_global_admin(p_user) or public.firm_role(e.audit_firm_id,p_user) in('admin','manager','auditor') or exists(select 1 from public.engagement_users eu where eu.engagement_id=e.id and eu.user_id=p_user)))$$;

create or replace function public.fill_tenant_from_parent() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='engagement_users' then select audit_firm_id into new.audit_firm_id from engagements where id=new.engagement_id;
 elsif tg_table_name='pbc_requests' then select audit_firm_id into new.audit_firm_id from engagements where id=new.engagement_id;
 elsif tg_table_name in('documents','comments') then select audit_firm_id into new.audit_firm_id from pbc_requests where id=new.request_id;
 end if;
 if new.audit_firm_id is null then raise exception 'Tenantul nu poate fi determinat.'; end if;
 return new;
end $$;
create trigger engagement_users_fill_tenant before insert or update on public.engagement_users for each row execute function public.fill_tenant_from_parent();
create trigger pbc_requests_fill_tenant before insert or update on public.pbc_requests for each row execute function public.fill_tenant_from_parent();
create trigger documents_fill_tenant before insert or update on public.documents for each row execute function public.fill_tenant_from_parent();
create trigger comments_fill_tenant before insert or update on public.comments for each row execute function public.fill_tenant_from_parent();

create or replace function public.prevent_audit_event_change() returns trigger language plpgsql as $$begin raise exception 'Audit trail-ul este imuabil.'; end$$;
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function public.prevent_audit_event_change();

alter table public.audit_firms enable row level security;
alter table public.profiles enable row level security;
alter table public.global_admins enable row level security;
alter table public.audit_firm_users enable row level security;
alter table public.entities enable row level security;
alter table public.engagements enable row level security;
alter table public.engagement_users enable row level security;
alter table public.pbc_requests enable row level security;
alter table public.documents enable row level security;
alter table public.comments enable row level security;
alter table public.audit_events enable row level security;
alter table public.app_settings enable row level security;

create policy firms_select on public.audit_firms for select using(public.is_global_admin() or public.firm_role(id) is not null);
create policy profiles_select on public.profiles for select using(id=auth.uid() or public.is_global_admin() or exists(select 1 from public.audit_firm_users mine join public.audit_firm_users theirs using(audit_firm_id) where mine.user_id=auth.uid() and mine.active and theirs.user_id=profiles.id and theirs.active));
create policy memberships_select on public.audit_firm_users for select using(public.is_global_admin() or public.firm_role(audit_firm_id) is not null);
create policy entities_select on public.entities for select using(public.is_global_admin() or public.firm_role(audit_firm_id) is not null);
create policy engagements_select on public.engagements for select using(public.can_access_engagement(id));
create policy engagement_users_select on public.engagement_users for select using(public.can_access_engagement(engagement_id));
create policy requests_select on public.pbc_requests for select using(public.can_access_engagement(engagement_id));
create policy documents_select on public.documents for select using(exists(select 1 from public.pbc_requests r where r.id=request_id and public.can_access_engagement(r.engagement_id)));
create policy comments_select on public.comments for select using(exists(select 1 from public.pbc_requests r where r.id=request_id and public.can_access_engagement(r.engagement_id)));
create policy audit_events_select on public.audit_events for select using(public.is_global_admin() or public.firm_role(audit_firm_id) in('admin','manager','auditor'));
create policy settings_select_admin on public.app_settings for select using(public.is_global_admin() or public.firm_role(audit_firm_id)='admin');
revoke all on public.audit_events from anon,authenticated;
grant select on public.audit_events to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,name,email) values(new.id,coalesce(new.raw_user_meta_data->>'name',''),coalesce(new.email,'')) on conflict(id) do update set email=excluded.email; return new; end$$;
create trigger auth_user_profile after insert or update of email on auth.users for each row execute function public.handle_new_user();
