# Portal Documente

Portal PBC multi-tenant pentru gestionarea informațiilor solicitate în audit. Obiectul central este cerința de audit, de care sunt legate documentele, descrierile, versiunile, comentariile, responsabilitățile, statusurile și istoricul.

## Rulare locală

```powershell
$nodePath = 'C:\Users\Mihai\.codex\My Projects\Confirmari sold\tools\node-v22.22.0-win-x64'
$env:Path = $nodePath + ';' + $env:Path
npm.cmd install
npm.cmd run dev
```

Fără `public/runtime-config.json`, aplicația pornește în mod demonstrativ local. Build-ul de producție generează temporar configurația publică Supabase și pornește autentificarea live.

## Build manual

```powershell
.\Build-Documente.ps1
```

Scriptul solicită URL-ul și cheia publică Supabase, apoi creează folderul `documente-upload` și arhiva `documente-upload.zip`. Configurația nu este hardcodată în surse. Instrucțiunile complete sunt în `ACTIVARE-LIVE.md`.

## Backend

Migrarea inițială este în `supabase/migrations/202610030001_portal_documente.sql`. Include modelul multi-tenant, RLS, apartenențe per firmă, acces per engagement și audit trail imuabil.

Integrarea SharePoint necesită o aplicație Microsoft Entra, permisiuni Microsoft Graph și autentificare interactivă. Până la configurarea acestora, upload-ul demonstrativ salvează numai metadatele documentului local și nu pretinde că fișierul a fost transmis în SharePoint.
