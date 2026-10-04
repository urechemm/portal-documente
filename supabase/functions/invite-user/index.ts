import { createClient } from "npm:@supabase/supabase-js@2";

const origin = Deno.env.get("APP_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Lipsește secretul ${name}.`);
  return value;
};

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
    const auditFirmId = String(payload.audit_firm_id ?? "");
    const email = String(payload.email ?? "").trim().toLowerCase();
    const name = String(payload.name ?? "").trim();
    const role = String(payload.role ?? "");
    if (!auditFirmId || !/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || !["admin", "manager", "auditor", "client"].includes(role)) {
      return json({ error: "Numele, emailul și rolul sunt obligatorii." }, 400);
    }

    const [{ data: callerRole }, { data: globalAdmin }] = await Promise.all([
      userClient.rpc("firm_role", { p_firm: auditFirmId }),
      userClient.rpc("is_global_admin"),
    ]);
    if (callerRole !== "admin" && globalAdmin !== true) return json({ error: "Acces interzis." }, 403);

    const { data: existingProfile, error: profileLookupError } = await adminClient.from("profiles").select("id,name,email").ilike("email", email).maybeSingle();
    if (profileLookupError) throw profileLookupError;
    let userId = existingProfile?.id as string | undefined;
    let invited = false;
    if (!userId) {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin.replace(/\/$/, "")}/`,
        data: { name, must_set_password: true },
      });
      if (error || !data.user) throw new Error(error?.message ?? "Invitația nu a putut fi creată.");
      userId = data.user.id;
      invited = true;
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({ id: userId, name, email });
    if (profileError) throw profileError;
    const { error: membershipError } = await adminClient.from("audit_firm_users").upsert(
      { audit_firm_id: auditFirmId, user_id: userId, role, active: true },
      { onConflict: "audit_firm_id,user_id" },
    );
    if (membershipError) throw membershipError;
    const { error: auditError } = await adminClient.from("audit_events").insert({
      audit_firm_id: auditFirmId,
      actor_id: userData.user.id,
      action: invited ? "USER_INVITED" : "USER_ACCESS_UPDATED",
      details: { message: `${name} (${email}) · rol ${role}` },
    });
    if (auditError) throw auditError;
    return json({ ok: true, invited });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Invitația nu a reușit." }, 500);
  }
});
