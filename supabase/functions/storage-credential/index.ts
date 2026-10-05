import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Lipsește secretul ${name} din configurația Edge Function.`); return value; };

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
    const auditFirmId = String(payload.audit_firm_id ?? "").trim();
    const provider = String(payload.provider ?? "").trim();
    const credentials = (payload.credentials ?? {}) as Record<string, unknown>;
    if (!auditFirmId || !["sharepoint", "onedrive_personal", "onedrive_business"].includes(provider))
      return json({ error: "Firma și backend-ul de stocare sunt obligatorii." }, 400);

    const [{ data: callerRole }, { data: globalAdmin }] = await Promise.all([
      userClient.rpc("firm_role", { p_firm: auditFirmId }),
      userClient.rpc("is_global_admin"),
    ]);
    if (callerRole !== "admin" && globalAdmin !== true)
      return json({ error: "Numai administratorul firmei poate schimba credențialele de stocare." }, 403);

    const { error: saveError } = await adminClient.rpc("set_storage_provider_credential", {
      p_audit_firm_id: auditFirmId,
      p_provider: provider,
      p_tenant_id: String(credentials.tenant_id ?? "").trim(),
      p_client_id: String(credentials.client_id ?? "").trim(),
      p_client_secret: String(credentials.client_secret ?? "").trim(),
      p_refresh_token: String(credentials.refresh_token ?? "").trim(),
      p_updated_by: userData.user.id,
    });
    if (saveError) throw saveError;

    await adminClient.from("audit_events").insert({
      audit_firm_id: auditFirmId,
      actor_id: userData.user.id,
      action: "STORAGE_CREDENTIAL_UPDATED",
      details: { message: "Credențialele backend-ului de stocare au fost înlocuite.", provider },
    });

    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Salvarea credențialelor de stocare a eșuat." }, 500);
  }
});
