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
    const tenantId = String(payload.tenant_id ?? "").trim();
    const refreshToken = String(payload.refresh_token ?? "").trim();
    if (!auditFirmId || !tenantId || refreshToken.length < 20)
      return json({ error: "Firma, Tenant ID și un refresh token valid sunt obligatorii." }, 400);

    const [{ data: callerRole }, { data: globalAdmin }] = await Promise.all([
      userClient.rpc("firm_role", { p_firm: auditFirmId }),
      userClient.rpc("is_global_admin"),
    ]);
    if (callerRole !== "admin" && globalAdmin !== true)
      return json({ error: "Numai administratorul firmei poate schimba credentialele OneDrive." }, 403);

    const { error: saveError } = await adminClient.rpc("set_onedrive_credential", {
      p_audit_firm_id: auditFirmId,
      p_tenant_id: tenantId,
      p_refresh_token: refreshToken,
      p_updated_by: userData.user.id,
    });
    if (saveError) throw saveError;

    await adminClient.from("audit_events").insert({
      audit_firm_id: auditFirmId,
      actor_id: userData.user.id,
      action: "ONEDRIVE_CREDENTIAL_UPDATED",
      details: { message: "Credențiala OneDrive a fost înlocuită.", tenant_id: tenantId },
    });

    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Salvarea credentialei OneDrive a eșuat." }, 500);
  }
});
