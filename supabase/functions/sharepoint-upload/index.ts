import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Lipsește secretul ${name}.`); return value; };
const clean = (value: string) => value.replace(/[~#%&*{}\\:<>?/+|"\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Fără nume";
const encodedPath = (parts: string[]) => parts.map((part) => encodeURIComponent(clean(part))).join("/");

async function graphToken() {
  const tenant = required("MS_TENANT_ID");
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("MS_CLIENT_ID"), client_secret: required("MS_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!response.ok) throw new Error("Autentificarea aplicației Microsoft Graph a eșuat.");
  return (await response.json()).access_token as string;
}

async function graph(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function uploadFile(token: string, driveId: string, path: string, file: File) {
  const base = `/drives/${driveId}/root:/${path}/${encodeURIComponent(clean(file.name))}:`;
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
    if (!response.ok && response.status !== 202) throw new Error(`Upload SharePoint întrerupt (${response.status}).`);
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
    const file = form.get("file");
    if (!(file instanceof File) || !requestId || description.length < 12 || !period) return json({ error: "Fișierul, descrierea și perioada sunt obligatorii." }, 400);
    if (file.size > 250 * 1024 * 1024) return json({ error: "Fișierul depășește limita de 250 MB." }, 413);

    const { data: pbc, error: pbcError } = await userClient.from("pbc_requests").select("id,code,title,audit_firm_id,engagement_id,engagements!inner(name,period,entity_id,entities!inner(name))").eq("id", requestId).single();
    if (pbcError || !pbc) return json({ error: "Cerința nu există sau nu este accesibilă." }, 403);
    const { data: settings } = await adminClient.from("app_settings").select("data").eq("audit_firm_id", pbc.audit_firm_id).single();
    const host = String(settings?.data?.sharepoint_host ?? "");
    const sitePath = String(settings?.data?.sharepoint_site_path ?? "");
    const libraryName = String(settings?.data?.sharepoint_library ?? "Documente");
    if (!host || !sitePath) return json({ error: "Conexiunea SharePoint nu este configurată complet." }, 503);

    const token = await graphToken();
    const site = await (await graph(token, `/sites/${host}:/${sitePath.replace(/^\//, "")}`)).json();
    const drives = await (await graph(token, `/sites/${site.id}/drives`)).json();
    const drive = drives.value.find((item: { name: string }) => item.name.toLowerCase() === libraryName.toLowerCase());
    if (!drive) return json({ error: `Biblioteca SharePoint „${libraryName}” nu există.` }, 503);
    const engagement = Array.isArray(pbc.engagements) ? pbc.engagements[0] : pbc.engagements;
    const entity = Array.isArray(engagement.entities) ? engagement.entities[0] : engagement.entities;
    const path = encodedPath([entity.name, engagement.name, `${pbc.code} - ${pbc.title}`]);
    await uploadFile(token, drive.id, path, file);

    const { data: versions } = await adminClient.from("documents").select("version").eq("request_id", requestId).eq("name", file.name).order("version", { ascending: false }).limit(1);
    const version = Number(versions?.[0]?.version ?? 0) + 1;
    const { error: insertError } = await adminClient.from("documents").insert({ audit_firm_id: pbc.audit_firm_id, request_id: requestId, name: file.name, description, period, uploaded_by: userData.user.id, version, status: "new", size_bytes: file.size, storage_path: `${path}/${clean(file.name)}` });
    if (insertError) throw insertError;
    return json({ ok: true, version });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Upload-ul nu a reușit." }, 500);
  }
});
