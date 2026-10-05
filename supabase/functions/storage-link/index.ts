import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Lipsește secretul ${name} din configurația Edge Function.`); return value; };
const clean = (value: string) => value.replace(/[~#%&*{}\\:<>?/+|"\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Fără nume";
const encodedPath = (parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).map((part) => encodeURIComponent(clean(part))).join("/");

async function token(endpoint: string, body: URLSearchParams) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Autentificarea Microsoft a eșuat (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return String((await response.json()).access_token ?? "");
}

async function graph(accessToken: string, path: string) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
}

const decodedPath = (value: string) => value.split("/").filter(Boolean).map((part) => {
  try { return decodeURIComponent(part); } catch { return part; }
});

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

    const payload = await request.json();
    const requestId = String(payload.request_id ?? "").trim();
    const documentId = String(payload.document_id ?? "").trim();
    if (!requestId) return json({ error: "Cerința este obligatorie." }, 400);

    const { data: pbc, error: pbcError } = await userClient.from("pbc_requests")
      .select("id,code,title,audit_firm_id,engagements!inner(name,entities!inner(name))")
      .eq("id", requestId).single();
    if (pbcError || !pbc) return json({ error: "Nu aveți acces la această cerință." }, 403);

    let document: { storage_path: string; request_id: string } | null = null;
    if (documentId) {
      const { data, error } = await userClient.from("documents").select("storage_path,request_id").eq("id", documentId).eq("request_id", requestId).single();
      if (error || !data) return json({ error: "Nu aveți acces la acest document." }, 403);
      document = data;
    }

    const { data: settingsRow, error: settingsError } = await adminClient.from("app_settings").select("data").eq("audit_firm_id", pbc.audit_firm_id).single();
    if (settingsError || !settingsRow) return json({ error: "Backend-ul de stocare nu este configurat." }, 503);
    const settings = settingsRow.data as Record<string, unknown>;
    const savedProvider = String(settings.storage_provider ?? "sharepoint");
    const currentProvider = savedProvider === "onedrive"
      ? (settings.onedrive_account_type === "business" ? "onedrive_business" : "onedrive_personal")
      : savedProvider;
    let provider = currentProvider;
    let storedPath = "";
    if (document) {
      const separator = document.storage_path.indexOf(":");
      if (separator < 1) return json({ error: "Documentul nu are o locație backend validă." }, 404);
      const storedProvider = document.storage_path.slice(0, separator);
      storedPath = document.storage_path.slice(separator + 1);
      provider = storedProvider === "onedrive"
        ? (currentProvider.startsWith("onedrive_") ? currentProvider : "onedrive_personal")
        : storedProvider;
    }
    if (!["sharepoint", "onedrive_personal", "onedrive_business"].includes(provider))
      return json({ error: "Backend-ul documentului nu mai este disponibil." }, 404);

    const { data: credentialData, error: credentialError } = await adminClient.rpc("get_storage_provider_credential", { p_audit_firm_id: pbc.audit_firm_id, p_provider: provider });
    if (credentialError) throw credentialError;
    const credential = Array.isArray(credentialData) ? credentialData[0] : credentialData;
    const engagement = Array.isArray(pbc.engagements) ? pbc.engagements[0] : pbc.engagements;
    const entity = Array.isArray(engagement.entities) ? engagement.entities[0] : engagement.entities;
    const requestParts = [entity.name, engagement.name, `${pbc.code} - ${pbc.title}`];
    let accessToken = "";
    let driveId = "";
    let targetPath = "";

    if (provider === "sharepoint") {
      const tenantId = String(credential?.tenant_id ?? Deno.env.get("MS_TENANT_ID") ?? "").trim();
      const clientId = String(credential?.client_id ?? Deno.env.get("MS_CLIENT_ID") ?? "").trim();
      const clientSecret = String(credential?.client_secret ?? Deno.env.get("MS_CLIENT_SECRET") ?? "").trim();
      if (!tenantId || !clientId || !clientSecret) return json({ error: "Credențialele SharePoint nu sunt configurate." }, 503);
      accessToken = await token(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }));
      const host = String(settings.sharepoint_host ?? "").trim();
      const sitePath = String(settings.sharepoint_site_path ?? "").trim().replace(/^\/+|\/+$/g, "");
      const library = String(settings.sharepoint_library ?? "").trim();
      const site = await graph(accessToken, sitePath.toLowerCase() === "root" ? "/sites/root" : `/sites/${host}:/${sitePath}`);
      const drives = await graph(accessToken, `/sites/${site.id}/drives`);
      const drive = drives.value.find((item: { name: string }) => item.name.toLowerCase() === library.toLowerCase());
      if (!drive) return json({ error: `Biblioteca SharePoint „${library}” nu a fost găsită.` }, 404);
      driveId = drive.id;
      targetPath = document ? encodedPath(decodedPath(storedPath)) : encodedPath(requestParts);
    } else {
      const suffix = provider === "onedrive_personal" ? "PERSONAL" : "BUSINESS";
      const tenantId = String(credential?.tenant_id ?? Deno.env.get(`ONEDRIVE_TENANT_ID_${suffix}`) ?? Deno.env.get("ONEDRIVE_TENANT_ID") ?? "").trim();
      const clientId = String(credential?.client_id ?? Deno.env.get(`ONEDRIVE_CLIENT_ID_${suffix}`) ?? Deno.env.get("ONEDRIVE_CLIENT_ID") ?? "").trim();
      const clientSecret = String(credential?.client_secret ?? Deno.env.get(`ONEDRIVE_CLIENT_SECRET_${suffix}`) ?? Deno.env.get("ONEDRIVE_CLIENT_SECRET") ?? "").trim();
      const refreshToken = String(credential?.refresh_token ?? Deno.env.get(`ONEDRIVE_REFRESH_TOKEN_${suffix}`) ?? Deno.env.get("ONEDRIVE_REFRESH_TOKEN") ?? "").trim();
      if (!tenantId || !clientId || !clientSecret || !refreshToken) return json({ error: `Credențialele ONEDRIVE_*_${suffix} nu sunt configurate.` }, 503);
      accessToken = await token(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token", scope: "offline_access Files.ReadWrite User.Read" }));
      const drive = await graph(accessToken, "/me/drive?$select=id");
      driveId = drive.id;
      const folder = provider === "onedrive_personal" ? settings.onedrive_personal_folder_path : settings.onedrive_business_folder_path;
      targetPath = document ? encodedPath(decodedPath(storedPath)) : encodedPath([...String(folder ?? settings.onedrive_folder_path ?? "").split("/"), ...requestParts]);
    }

    const item = await graph(accessToken, `/drives/${driveId}/root:/${targetPath}?$select=webUrl`);
    if (!item.webUrl) return json({ error: "Microsoft Graph nu a returnat adresa elementului." }, 404);
    return json({ url: item.webUrl });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Locația backend nu a putut fi deschisă." }, 500);
  }
});
