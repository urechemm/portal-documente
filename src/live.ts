import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DocumentRecord, Settings, State, StorageProvider } from "./domain";

export interface RuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  environment: "production" | "demo";
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  try {
    const response = await fetch("/runtime-config.json", { cache: "no-store" });
    if (!response.ok) return null;
    const config = (await response.json()) as Partial<RuntimeConfig>;
    if (!config.supabaseUrl || !config.supabasePublishableKey) return null;
    return {
      supabaseUrl: config.supabaseUrl,
      supabasePublishableKey: config.supabasePublishableKey,
      environment: "production",
    };
  } catch {
    return null;
  }
}

export const createLiveClient = (config: RuntimeConfig) =>
  createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

function fail(message: string, error?: { message?: string } | null): never {
  throw new Error(error?.message ? `${message}: ${error.message}` : message);
}

async function edgeFunctionError(error: unknown, fallback: string): Promise<string> {
  const candidate = error as { message?: string; context?: Response } | null;
  const response = candidate?.context;
  if (response && typeof response.clone === "function") {
    try {
      const payload = await response.clone().json() as { error?: string; message?: string };
      if (payload.error) return payload.error;
      if (payload.message) return payload.message;
    } catch {
      try {
        const body = await response.clone().text();
        if (body.trim()) return body.trim().slice(0, 500);
      } catch { /* fall back to the SDK error below */ }
    }
  }
  return candidate?.message || fallback;
}

export async function loadLiveState(client: SupabaseClient, requestedFirm?: string | null): Promise<State> {
  const { data: userData, error: userError } = await client.auth.getUser();
  const user = userData.user;
  if (userError || !user) fail("Sesiunea nu este validă", userError);

  const [profilesResult, membershipsResult, firmsResult, adminResult] = await Promise.all([
    client.from("profiles").select("id,name,email"),
    client.from("audit_firm_users").select("id,audit_firm_id,user_id,role,active").eq("active", true),
    client.from("audit_firms").select("id,name,code,cui,email,phone,website,address,active").order("name"),
    client.from("global_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (profilesResult.error) fail("Profilurile nu au putut fi încărcate", profilesResult.error);
  if (membershipsResult.error) fail("Apartenențele nu au putut fi încărcate", membershipsResult.error);
  if (firmsResult.error) fail("Firmele nu au putut fi încărcate", firmsResult.error);
  const memberships = membershipsResult.data ?? [];
  const allowed = new Set(memberships.filter((item) => item.user_id === user.id).map((item) => item.audit_firm_id));
  const firms = (firmsResult.data ?? []).filter((item) => allowed.has(item.id) || !!adminResult.data);
  const activeFirms = firms.filter((item) => item.active);
  const remembered = requestedFirm ?? sessionStorage.getItem("portal-live-firm");
  const firmId = activeFirms.some((item) => item.id === remembered) ? remembered! : activeFirms[0]?.id;
  if (!firmId) throw new Error("Utilizatorul nu este alocat niciunui tenant activ.");
  sessionStorage.setItem("portal-live-firm", firmId);

  const [entities, engagements, engagementUsers, requests, documents, comments, events, settings] = await Promise.all([
    client.from("entities").select("*").eq("audit_firm_id", firmId).order("name"),
    client.from("engagements").select("*").eq("audit_firm_id", firmId).order("created_at", { ascending: false }),
    client.from("engagement_users").select("engagement_id,audit_firm_id,user_id").eq("audit_firm_id", firmId),
    client.from("pbc_requests").select("*").eq("audit_firm_id", firmId).order("created_at"),
    client.from("documents").select("*").eq("audit_firm_id", firmId).order("uploaded_at", { ascending: false }),
    client.from("comments").select("*").eq("audit_firm_id", firmId).order("created_at"),
    client.from("audit_events").select("*").eq("audit_firm_id", firmId).order("created_at", { ascending: false }).limit(500),
    client.from("app_settings").select("data").eq("audit_firm_id", firmId).maybeSingle(),
  ]);
  for (const [label, result] of [["entitățile", entities], ["misiunile", engagements], ["membrii misiunilor", engagementUsers], ["cerințele", requests], ["documentele", documents], ["comentariile", comments], ["activitatea", events]] as const)
    if (result.error) fail(`Nu am putut încărca ${label}`, result.error);

  const baseSettings: Settings = {
    supabase_url: "", supabase_publishable_key: "", global_admin_email: "",
    storage_provider: "sharepoint", sharepoint_host: "", sharepoint_user: "", sharepoint_site_path: "", sharepoint_library: "Documente",
    onedrive_personal_user: "", onedrive_personal_folder_path: "", onedrive_business_user: "", onedrive_business_folder_path: "", digest_hour: "17:00", retention_years: 7,
  };
  const savedSettings = (settings.data?.data ?? {}) as Record<string, unknown>;
  const legacyOneDriveType = savedSettings.onedrive_account_type === "business" ? "business" : "personal";
  const normalizedProvider: StorageProvider = savedSettings.storage_provider === "onedrive"
    ? `onedrive_${legacyOneDriveType}`
    : (["sharepoint", "onedrive_personal", "onedrive_business"].includes(String(savedSettings.storage_provider))
      ? savedSettings.storage_provider as StorageProvider
      : "sharepoint");
  const normalizedSettings = { ...baseSettings, ...savedSettings, storage_provider: normalizedProvider } as Settings;
  if (savedSettings.storage_provider === "onedrive") {
    if (legacyOneDriveType === "personal") {
      normalizedSettings.onedrive_personal_user = String(savedSettings.onedrive_user ?? "");
      normalizedSettings.onedrive_personal_folder_path = String(savedSettings.onedrive_folder_path ?? "");
    } else {
      normalizedSettings.onedrive_business_user = String(savedSettings.onedrive_user ?? "");
      normalizedSettings.onedrive_business_folder_path = String(savedSettings.onedrive_folder_path ?? "");
    }
  }
  const documentRows: DocumentRecord[] = (documents.data ?? []).map((item) => ({
    id: item.id, audit_firm_id: item.audit_firm_id, request_id: item.request_id,
    name: item.name, description: item.description, period: item.period,
    uploaded_by: item.uploaded_by, uploaded_at: item.uploaded_at, version: item.version,
    status: item.status, auditor_comment: item.auditor_comment, size: Number(item.size_bytes ?? 0),
    storage_path: item.storage_path,
  }));
  return {
    firms, profiles: profilesResult.data ?? [], memberships,
    entities: entities.data ?? [], engagements: engagements.data ?? [], engagement_users: engagementUsers.data ?? [], requests: requests.data ?? [],
    documents: documentRows, comments: comments.data ?? [],
    events: (events.data ?? []).map((item) => ({ ...item, details: typeof item.details === "string" ? item.details : String(item.details?.message ?? item.action) })),
    settings: normalizedSettings,
    current_firm_id: firmId, current_user_id: user.id, is_global_admin: !!adminResult.data,
  } as State;
}

const changedRows = <T extends { id: string }>(before: T[], after: T[]) => {
  const old = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
  return after.filter((item) => old.get(item.id) !== JSON.stringify(item));
};

export async function persistLiveDelta(client: SupabaseClient, before: State, after: State): Promise<State> {
  const upsert = async (table: string, rows: unknown[]) => {
    if (!rows.length) return;
    const { error } = await client.from(table).upsert(rows);
    if (error) fail(`Salvarea în ${table} a eșuat`, error);
  };
  await upsert("audit_firms", changedRows(before.firms, after.firms));
  await upsert("audit_firm_users", changedRows(before.memberships, after.memberships));
  await upsert("entities", changedRows(before.entities, after.entities));
  await upsert("engagements", changedRows(before.engagements, after.engagements));
  await upsert("engagement_users", after.engagement_users.filter((item) => !before.engagement_users.some((old) => old.engagement_id === item.engagement_id && old.user_id === item.user_id)));
  // New requests must not use ON CONFLICT: its SELECT checks can invoke
  // can_access_request(id) before the new request exists in the database.
  const existingRequestIds = new Set(before.requests.map((row) => row.id));
  const requestChanges = changedRows(before.requests, after.requests).map((row) => {
    const engagement = after.engagements.find((item) => item.id === row.engagement_id);
    if (!engagement || engagement.audit_firm_id !== after.current_firm_id)
      throw new Error("Misiunea cerinței nu aparține firmei de audit selectate.");
    if (!row.client_owner_id || !after.memberships.some((item) =>
      item.audit_firm_id === engagement.audit_firm_id && item.user_id === row.client_owner_id && item.active && item.role === "client"))
      throw new Error("Selectați un Client activ din firma de audit a misiunii.");
    return { ...row, audit_firm_id: engagement.audit_firm_id };
  });
  const newRequests = requestChanges.filter((row) => !existingRequestIds.has(row.id));
  if (newRequests.length) {
    const { error } = await client.from("pbc_requests").insert(newRequests);
    if (error) fail("Crearea cerințelor a eșuat", error);
  }
  for (const row of requestChanges.filter((item) => existingRequestIds.has(item.id))) {
    const { id, ...values } = row;
    const { data, error } = await client.from("pbc_requests").update(values).eq("id", id).select("id");
    if (error) fail("Actualizarea cerinței a eșuat", error);
    if (!data?.length) fail("Cerința nu mai există sau nu aveți dreptul să o modificați.");
  }
  await upsert("comments", changedRows(before.comments, after.comments));
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) {
    const { supabase_url: _url, supabase_publishable_key: _key, ...safeSettings } = after.settings;
    const { error } = await client.from("app_settings").upsert({ audit_firm_id: after.current_firm_id, data: safeSettings, updated_at: new Date().toISOString() });
    if (error) fail("Salvarea setărilor a eșuat", error);
  }
  return loadLiveState(client, after.current_firm_id);
}

export async function uploadLiveDocument(client: SupabaseClient, requestId: string, file: File, description: string, period: string, relativePath?: string): Promise<void> {
  const form = new FormData();
  form.set("request_id", requestId);
  form.set("description", description);
  form.set("period", period);
  form.set("relative_path", relativePath || file.name);
  form.set("file", file);
  const { data, error } = await client.functions.invoke("sharepoint-upload", { body: form });
  if (error) throw new Error(await edgeFunctionError(error, "Upload-ul documentului a eșuat."));
  if (data?.error) throw new Error(data.error);
}

export async function getLiveStorageLink(client: SupabaseClient, requestId: string, documentId?: string): Promise<string> {
  const { data, error } = await client.functions.invoke("storage-link", {
    body: { request_id: requestId, document_id: documentId ?? null },
  });
  if (error) throw new Error(await edgeFunctionError(error, "Locația din backend nu a putut fi deschisă."));
  if (data?.error) throw new Error(data.error);
  if (!data?.url) throw new Error("Backend-ul nu a returnat o adresă validă.");
  return String(data.url);
}

export async function testLiveStorage(client: SupabaseClient, auditFirmId: string, provider: StorageProvider, configuration: Record<string, string>): Promise<string> {
  const { data, error } = await client.functions.invoke("storage-test", {
    body: { audit_firm_id: auditFirmId, provider, configuration },
  });
  if (error) throw new Error(await edgeFunctionError(error, "Testul conexiunii de stocare a eșuat."));
  if (data?.error) throw new Error(data.error);
  return String(data?.message ?? "Testul de scriere și citire a reușit.");
}

export async function saveLiveStorageCredential(client: SupabaseClient, auditFirmId: string, provider: StorageProvider, credentials: Record<string, string>): Promise<void> {
  const { data, error } = await client.functions.invoke("storage-credential", {
    body: { audit_firm_id: auditFirmId, provider, credentials },
  });
  if (error) throw new Error(await edgeFunctionError(error, "Salvarea credențialelor de stocare a eșuat."));
  if (data?.error) throw new Error(data.error);
}

export async function inviteLiveUser(client: SupabaseClient, auditFirmId: string, name: string, email: string, role: string): Promise<boolean> {
  const { data, error } = await client.functions.invoke("invite-user", {
    body: { audit_firm_id: auditFirmId, name, email, role },
  });
  if (error) throw new Error(error.message || "Invitația nu a reușit.");
  if (data?.error) throw new Error(data.error);
  return !!data?.invited;
}
