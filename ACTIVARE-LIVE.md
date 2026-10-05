# Activare Portal Documente LIVE

Build-ul din `documente-upload` conține configurația publică Supabase și afișează `LIVE`. Pentru funcționare sunt necesari pașii de mai jos, în ordine.

## 1. Supabase Database

În Supabase Dashboard → SQL Editor, execută integral și în ordine:

1. `supabase/migrations/202610030001_portal_documente.sql`
2. `supabase/migrations/202610030002_live_operations.sql`
3. `supabase/migrations/202610040001_require_mfa.sql`

După migrare, în SQL Editor rulează o singură dată, înlocuind valorile exemplu:

```sql
select public.bootstrap_portal(
  'EMAIL_ADMIN_EXISTENT_IN_AUTH',
  'Celentis Audit',
  'CELENTIS'
);
```

Funcția poate fi apelată numai din SQL Editor/service role. Nu este accesibilă utilizatorilor aplicației.

## 2. Supabase Authentication

În Authentication → URL Configuration:

- Site URL: `https://documente.celentis.ro`
- Redirect URLs: `https://documente.celentis.ro/**`

Activează autentificarea Email/Password. Aplicația impune TOTP la prima autentificare și afișează codul QR pentru Microsoft Authenticator sau altă aplicație compatibilă.

## 3. Microsoft Entra / SharePoint

Creează o aplicație Microsoft Entra single-tenant pentru serviciul backend:

1. adaugă Microsoft Graph → Application permission → `Sites.Selected`;
2. acordă Admin consent;
3. creează un client secret;
4. acordă aplicației rolul `write` numai pe site-ul SharePoint folosit de portal;
5. notează Tenant ID, Client ID și valoarea client secretului.

Nu utiliza `Sites.ReadWrite.All` decât dacă accepți accesul aplicației la toate site-urile tenantului.

## 4. Supabase Edge Function

Autentifică Supabase CLI și rulează:

```powershell
supabase link --project-ref PROJECT_REF
supabase secrets set MS_TENANT_ID="..." MS_CLIENT_ID="..." MS_CLIENT_SECRET="..." APP_ORIGIN="https://documente.celentis.ro"
supabase functions deploy sharepoint-upload
supabase functions deploy storage-test
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` și `SUPABASE_SERVICE_ROLE_KEY` sunt furnizate funcției de platforma Supabase. Secretul Microsoft nu se introduce în interfața web.

### OneDrive personal

Pentru OneDrive personal, înregistrează o aplicație Microsoft care acceptă și conturi Microsoft personale și acordă permisiunile delegate `Files.ReadWrite`, `User.Read` și `offline_access`. După autentificarea contului, salvează valorile exclusiv ca Supabase Secrets:

```powershell
supabase secrets set ONEDRIVE_TENANT_ID="consumers" ONEDRIVE_CLIENT_ID="..." ONEDRIVE_CLIENT_SECRET="..." ONEDRIVE_REFRESH_TOKEN="..."
supabase functions deploy sharepoint-upload
supabase functions deploy storage-test
```

Contul și calea folderului se completează separat, per firmă de audit, în Setări → Conexiuni. Refresh tokenul și secretul aplicației nu se salvează în `app_settings` și nu ajung în browser.

## 5. Setările din aplicație

După autentificarea administratorului, completează în Setări → Conexiuni:

- Email Global Administrator;
- SharePoint host, de exemplu `firma.sharepoint.com`;
- Cale site: `root` pentru site-ul rădăcină sau, de exemplu, `sites/Audit` pentru un site separat;
- Biblioteca, de exemplu `Documente`;
- utilizatorul Microsoft 365 folosit pentru administrare.

Aceste valori sunt salvate în `app_settings`. Client secretul rămâne exclusiv în Supabase Secrets.

## 6. Deploy web

Uploadează conținutul arhivei `documente-upload.zip` peste versiunea actuală și golește cache-ul CDN/browser. Fișierul `runtime-config.json` din build conține numai URL-ul proiectului și cheia publică Supabase.

## Verificare minimă

1. pagina afișează ecranul de autentificare, nu date demo;
2. prima autentificare solicită activarea MFA;
3. administratorul vede tenantul Celentis;
4. clientul vede numai engagement-urile la care este alocat;
5. un upload ajunge în biblioteca SharePoint și creează metadatele în `documents`;
6. cerința trece automat în `Primit` și apare un eveniment în audit trail.
