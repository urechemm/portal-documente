import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Lipsește secretul ${name} din configurația Edge Function.`); return value; };
const clean = (value: string) => value.replace(/[~#%&*{}\\:<>?/+|"\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Fără nume";
const encodedPath = (parts: string[]) => parts.map((part) => encodeURIComponent(clean(part))).join("/");

async function graphToken(tenantId: string, clientId: string, clientSecret: string) {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!response.ok) throw new Error(`Autentificarea Microsoft Graph a eșuat (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).access_token as string;
}

async function oneDriveToken(tenantId: string, clientId: string, clientSecret: string, refreshToken: string) {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, scope: "offline_access Files.ReadWrite User.Read", grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Autentificarea OneDrive a eșuat (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).access_token as string;
}

async function graph(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    if (detail.includes("Tenant does not have a SPO license")) throw new Error("Tokenul OneDrive este emis pentru utilizatorul guest din tenantul organizației. Selectați cont Personal, reautorizați prin endpointul Microsoft consumers și salvați noul refresh token în Setări.");
    throw new Error(`Microsoft Graph ${response.status}: ${detail}`);
  }
  return response;
}

async function ensureFolders(token: string, driveId: string, segments: string[]) {
  let parent = await (await graph(token, `/drives/${driveId}/root?$select=id`)).json();
  for (const segment of segments.map(clean).filter(Boolean)) {
    const lookupUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parent.id}:/${encodeURIComponent(segment)}?$select=id`;
    const lookup = await fetch(lookupUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (lookup.ok) { parent = await lookup.json(); continue; }
    if (lookup.status !== 404) throw new Error(`Microsoft Graph ${lookup.status}: ${(await lookup.text()).slice(0, 300)}`);
    parent = await (await graph(token, `/drives/${driveId}/items/${parent.id}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    })).json();
  }
}

async function uploadFile(token: string, base: string, file: File) {
  if (file.size <= 4 * 1024 * 1024) {
    await graph(token, `${base}/content`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: await file.arrayBuffer() });
    return;
  }
  const sessionResponse = await graph(token, `${base}/createUploadSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name: clean(file.name) } }) });
  const { uploadUrl } = await sessionResponse.json();
  const chunkSize = 5 * 1024 * 1024;
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, file.size);
    const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${file.size}` }, body: await file.slice(start, end).arrayBuffer() });
    if (!response.ok && response.status !== 202) throw new Error(`Upload întrerupt (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Metodă indisponibilă." }, 405);
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Autentificare necesară." }, 401);
    const supabaseUrl = required("SUPABASE_URL");
    const userClient = createClient(supabaseUrl, required("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: authorization } } });
    const adminClient = createClient(supabaseUrl, required("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sesiune invalidă." }, 401);
    const form = await request.formData();
    const requestId = String(form.get("request_id") ?? "");
    const description = String(form.get("description") ?? "").trim();
    const period = String(form.get("period") ?? "").trim();
    const relativePath = String(form.get("relative_path") ?? "").trim();
    const file = form.get("file");
    if (!(file instanceof File) || !requestId || description.length < 12 || !period) return json({ error: "Fișierul, descrierea și perioada sunt obligatorii." }, 400);
    if (file.size > 250 * 1024 * 1024) return json({ error: "Fișierul depășește limita de 250 MB." }, 413);
    const relativeParts = relativePath.split(/[\\/]+/).map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..");
    const relativeFolders = relativeParts.slice(0, -1).map(clean);
    const safeFileName = clean(file.name);
    const documentName = [...relativeFolders, safeFileName].join("/");

    const { data: pbc, error: pbcError } = await userClient.from("pbc_requests").select("id,code,title,audit_firm_id,engagement_id,engagements!inner(name,period,entity_id,entities!inner(name))").eq("id", requestId).single();
    if (pbcError || !pbc) return json({ error: "Cerința nu există, nu este asignată clientului curent sau sesiunea nu are MFA activ." }, 403);
    const { data: settings } = await adminClient.from("app_settings").select("data").eq("audit_firm_id", pbc.audit_firm_id).single();
    const engagement = Array.isArray(pbc.engagements) ? pbc.engagements[0] : pbc.engagements;
    const entity = Array.isArray(engagement.entities) ? engagement.entities[0] : engagement.entities;
    const requestFolders = [entity.name, engagement.name, `${pbc.code} - ${pbc.title}`].map(clean);
    const path = encodedPath(requestFolders);
    const savedProvider = String(settings?.data?.storage_provider ?? "sharepoint");
    const provider = savedProvider === "onedrive"
      ? (settings?.data?.onedrive_account_type === "business" ? "onedrive_business" : "onedrive_personal")
      : savedProvider;
    let storagePath = "";

    if (provider === "sharepoint") {
      const host = String(settings?.data?.sharepoint_host ?? "");
      const sitePath = String(settings?.data?.sharepoint_site_path ?? "");
      const libraryName = String(settings?.data?.sharepoint_library ?? "Documente");
      if (!host || !sitePath || !libraryName) return json({ error: "Conexiunea SharePoint nu este configurată complet în Setări → Conexiuni." }, 503);
      const { data: credentialData, error: credentialError } = await adminClient.rpc("get_storage_provider_credential", { p_audit_firm_id: pbc.audit_firm_id, p_provider: provider });
      if (credentialError) throw credentialError;
      const credential = Array.isArray(credentialData) ? credentialData[0] : credentialData;
      const tenantId = String(credential?.tenant_id ?? Deno.env.get("MS_TENANT_ID") ?? "").trim();
      const clientId = String(credential?.client_id ?? Deno.env.get("MS_CLIENT_ID") ?? "").trim();
      const clientSecret = String(credential?.client_secret ?? Deno.env.get("MS_CLIENT_SECRET") ?? "").trim();
      if (!tenantId || !clientId || !clientSecret) return json({ error: "Credențialele SharePoint nu sunt configurate în Setări → Conexiuni." }, 503);
      const token = await graphToken(tenantId, clientId, clientSecret);
      const normalizedSitePath = sitePath.trim().replace(/^\/+|\/+$/g, "");
      const siteEndpoint = normalizedSitePath.toLowerCase() === "root" ? "/sites/root" : `/sites/${host}:/${normalizedSitePath}`;
      const site = await (await graph(token, siteEndpoint)).json();
      const drives = await (await graph(token, `/sites/${site.id}/drives`)).json();
      const drive = drives.value.find((item: { name: string }) => item.name.toLowerCase() === libraryName.toLowerCase());
      if (!drive) return json({ error: `Biblioteca SharePoint „${libraryName}” nu a fost găsită pe site-ul configurat.` }, 503);
      await ensureFolders(token, drive.id, [...requestFolders, ...relativeFolders]);
      const nestedPath = encodedPath(relativeFolders);
      const destination = [path, nestedPath, encodeURIComponent(safeFileName)].filter(Boolean).join("/");
      await uploadFile(token, `/drives/${drive.id}/root:/${destination}:`, file);
      storagePath = `sharepoint:${destination}`;
    } else if (provider === "onedrive_personal" || provider === "onedrive_business") {
      const personal = provider === "onedrive_personal";
      const folder = String((personal ? settings?.data?.onedrive_personal_folder_path : settings?.data?.onedrive_business_folder_path) ?? settings?.data?.onedrive_folder_path ?? "").trim();
      if (!folder) return json({ error: "Folderul OneDrive nu este configurat în Setări → Conexiuni." }, 503);
      const { data: credentialData, error: credentialError } = await adminClient.rpc("get_storage_provider_credential", { p_audit_firm_id: pbc.audit_firm_id, p_provider: provider });
      if (credentialError) throw credentialError;
      const credential = Array.isArray(credentialData) ? credentialData[0] : credentialData;
      const suffix = personal ? "PERSONAL" : "BUSINESS";
      const tenantId = String(credential?.tenant_id ?? Deno.env.get(`ONEDRIVE_TENANT_ID_${suffix}`) ?? Deno.env.get("ONEDRIVE_TENANT_ID") ?? "").trim();
      const clientId = String(credential?.client_id ?? Deno.env.get(`ONEDRIVE_CLIENT_ID_${suffix}`) ?? Deno.env.get("ONEDRIVE_CLIENT_ID") ?? "").trim();
      const clientSecret = String(credential?.client_secret ?? Deno.env.get(`ONEDRIVE_CLIENT_SECRET_${suffix}`) ?? Deno.env.get("ONEDRIVE_CLIENT_SECRET") ?? "").trim();
      const refreshToken = String(credential?.refresh_token ?? Deno.env.get(`ONEDRIVE_REFRESH_TOKEN_${suffix}`) ?? Deno.env.get("ONEDRIVE_REFRESH_TOKEN") ?? "").trim();
      if (!tenantId || !clientId || !clientSecret || !refreshToken) return json({ error: `Credențialele ONEDRIVE_*_${suffix} nu sunt configurate în Setări → Conexiuni.` }, 503);
      const token = await oneDriveToken(tenantId, clientId, clientSecret, refreshToken);
      const root = encodedPath(folder.split("/"));
      const drive = await (await graph(token, "/me/drive?$select=id")).json();
      await ensureFolders(token, drive.id, [...folder.split("/"), ...requestFolders, ...relativeFolders]);
      const nestedPath = encodedPath(relativeFolders);
      const destination = [root, path, nestedPath, encodeURIComponent(safeFileName)].filter(Boolean).join("/");
      await uploadFile(token, `/me/drive/root:/${destination}:`, file);
      storagePath = `onedrive:${destination}`;
    } else {
      return json({ error: "Backend-ul de stocare selectat nu este valid." }, 400);
    }

    const { data: versions } = await adminClient.from("documents").select("version").eq("request_id", requestId).eq("name", documentName).order("version", { ascending: false }).limit(1);
    const version = Number(versions?.[0]?.version ?? 0) + 1;
    const { error: insertError } = await adminClient.from("documents").insert({ audit_firm_id: pbc.audit_firm_id, request_id: requestId, name: documentName, description, period, uploaded_by: userData.user.id, version, status: "new", size_bytes: file.size, storage_path: storagePath });
    if (insertError) throw insertError;
    return json({ ok: true, version });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Upload-ul nu a reușit." }, 500);
  }
});
