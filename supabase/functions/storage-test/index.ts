import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Lipsește secretul ${name} din configurația Edge Function.`); return value; };
const clean = (value: string) => value.replace(/[~#%&*{}\\:<>?/+|"\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Fără nume";
const encodedPath = (value: string) => value.split("/").map((part) => part.trim()).filter(Boolean).map((part) => encodeURIComponent(clean(part))).join("/");

async function token(endpoint: string, body: URLSearchParams) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Autentificarea Microsoft a eșuat (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return String((await response.json()).access_token ?? "");
}

const sharePointToken = () => token(
  `https://login.microsoftonline.com/${required("MS_TENANT_ID")}/oauth2/v2.0/token`,
  new URLSearchParams({ client_id: required("MS_CLIENT_ID"), client_secret: required("MS_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
);

const oneDriveToken = () => token(
  `https://login.microsoftonline.com/${Deno.env.get("ONEDRIVE_TENANT_ID") || "consumers"}/oauth2/v2.0/token`,
  new URLSearchParams({ client_id: required("ONEDRIVE_CLIENT_ID"), client_secret: required("ONEDRIVE_CLIENT_SECRET"), refresh_token: required("ONEDRIVE_REFRESH_TOKEN"), grant_type: "refresh_token", scope: "offline_access Files.ReadWrite User.Read" }),
);

async function graph(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response;
}

async function verifyFile(accessToken: string, itemBase: string) {
  const content = `Portal Documente connection test ${new Date().toISOString()}`;
  const uploaded = await (await graph(accessToken, `${itemBase}/content`, { method: "PUT", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: content })).json();
  try {
    const read = await (await graph(accessToken, `/drives/${uploaded.parentReference.driveId}/items/${uploaded.id}/content`)).text();
    if (read !== content) throw new Error("Fișierul de test a fost scris, dar conținutul citit nu corespunde.");
  } finally {
    await graph(accessToken, `/drives/${uploaded.parentReference.driveId}/items/${uploaded.id}`, { method: "DELETE" });
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
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sesiune invalidă." }, 401);

    const payload = await request.json();
    const auditFirmId = String(payload.audit_firm_id ?? "");
    const provider = String(payload.provider ?? "");
    const configuration = (payload.configuration ?? {}) as Record<string, unknown>;
    const [{ data: callerRole }, { data: globalAdmin }] = await Promise.all([
      userClient.rpc("firm_role", { p_firm: auditFirmId }),
      userClient.rpc("is_global_admin"),
    ]);
    if (callerRole !== "admin" && globalAdmin !== true) return json({ error: "Numai administratorul firmei poate testa stocarea." }, 403);

    const testName = `Portal-Documente-Test-${crypto.randomUUID()}.txt`;
    if (provider === "sharepoint") {
      const host = String(configuration.sharepoint_host ?? "").trim();
      const sitePath = String(configuration.sharepoint_site_path ?? "").trim().replace(/^\/+|\/+$/g, "");
      const library = String(configuration.sharepoint_library ?? "").trim();
      if (!host || !sitePath || !library) return json({ error: "Hostul, calea site-ului și biblioteca SharePoint sunt obligatorii." }, 400);
      const accessToken = await sharePointToken();
      const siteEndpoint = sitePath.toLowerCase() === "root" ? "/sites/root" : `/sites/${host}:/${sitePath}`;
      const site = await (await graph(accessToken, siteEndpoint)).json();
      const drives = await (await graph(accessToken, `/sites/${site.id}/drives`)).json();
      const drive = drives.value.find((item: { name: string }) => item.name.toLowerCase() === library.toLowerCase());
      if (!drive) return json({ error: `Biblioteca SharePoint „${library}” nu a fost găsită.` }, 404);
      await verifyFile(accessToken, `/drives/${drive.id}/root:/${encodeURIComponent(testName)}:`);
      return json({ ok: true, message: `Test SharePoint reușit: scriere, citire și ștergere în biblioteca „${library}”.` });
    }

    if (provider === "onedrive") {
      const folder = String(configuration.onedrive_folder_path ?? "").trim();
      const expectedUser = String(configuration.onedrive_user ?? "").trim().toLowerCase();
      if (!expectedUser || !folder) return json({ error: "Contul și calea folderului OneDrive sunt obligatorii." }, 400);
      const accessToken = await oneDriveToken();
      const me = await (await graph(accessToken, "/me?$select=displayName,mail,userPrincipalName")).json();
      const connectedUser = String(me.mail || me.userPrincipalName || "").toLowerCase();
      if (connectedUser && connectedUser !== expectedUser) return json({ error: `Tokenul OneDrive aparține contului ${connectedUser}, nu contului ${expectedUser}.` }, 409);
      const folderPath = encodedPath(folder);
      await graph(accessToken, `/me/drive/root:/${folderPath}`);
      await verifyFile(accessToken, `/me/drive/root:/${folderPath}/${encodeURIComponent(testName)}:`);
      return json({ ok: true, message: `Test OneDrive reușit: scriere, citire și ștergere în „${folder}”.` });
    }

    return json({ error: "Backend-ul de stocare selectat nu este valid." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Testul conexiunii de stocare a eșuat." }, 500);
  }
});
