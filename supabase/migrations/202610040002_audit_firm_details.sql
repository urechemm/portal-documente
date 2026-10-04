alter table public.audit_firms
  add column if not exists cui text not null default '',
  add column if not exists email text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists website text not null default '',
  add column if not exists address text not null default '';

alter table public.audit_firms
  drop constraint if exists audit_firms_email_format,
  add constraint audit_firms_email_format check (email = '' or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
