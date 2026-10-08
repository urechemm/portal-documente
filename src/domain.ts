export type Role = "admin" | "manager" | "auditor" | "client";
export type RequestStatus =
  | "draft"
  | "requested"
  | "received"
  | "review"
  | "clarification"
  | "complete"
  | "not_applicable";
export type Priority = "normal" | "urgent";
export type StorageProvider = "sharepoint" | "onedrive_personal" | "onedrive_business";

export interface AuditFirm {
  id: string;
  name: string;
  code: string;
  cui: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  active: boolean;
}
export interface Profile {
  id: string;
  name: string;
  email: string;
}
export interface Membership {
  id: string;
  audit_firm_id: string;
  user_id: string;
  role: Role;
  active: boolean;
}
export interface Entity {
  id: string;
  audit_firm_id: string;
  name: string;
  cui: string;
  address: string;
  contact_name: string;
  email: string;
}
export interface Engagement {
  id: string;
  audit_firm_id: string;
  entity_id: string;
  name: string;
  period: string;
  start_date: string;
  end_date: string;
  financial_statement_date: string;
  confirmation_date: string;
  deadline: string;
  status: "active" | "closed";
  manager_id: string;
  auditor_id: string;
  client_id: string;
}
export interface EngagementUser {
  engagement_id: string;
  audit_firm_id: string;
  user_id: string;
}
export interface PbcRequest {
  id: string;
  audit_firm_id: string;
  engagement_id: string;
  code: string;
  area: string;
  title: string;
  description: string;
  instructions: string;
  period: string;
  client_owner_id: string;
  auditor_id: string;
  created_by?: string;
  deadline: string;
  priority: Priority;
  status: RequestStatus;
  not_applicable_reason: string;
  created_at: string;
  updated_at: string;
}
export interface DocumentRecord {
  id: string;
  audit_firm_id: string;
  request_id: string;
  name: string;
  description: string;
  period: string;
  uploaded_by: string;
  uploaded_at: string;
  version: number;
  status: "new" | "accepted" | "replace";
  auditor_comment: string;
  size: number;
  storage_path: string;
}
export interface Comment {
  id: string;
  audit_firm_id: string;
  request_id: string;
  author_id: string;
  body: string;
  created_at: string;
}
export interface AuditEvent {
  id: string;
  audit_firm_id: string;
  request_id: string | null;
  actor_id: string;
  action: string;
  details: string;
  created_at: string;
}
export interface Settings {
  supabase_url: string;
  supabase_publishable_key: string;
  global_admin_email: string;
  sharepoint_host: string;
  sharepoint_site_path: string;
  sharepoint_library: string;
  storage_provider: StorageProvider;
  onedrive_personal_user: string;
  onedrive_personal_folder_path: string;
  onedrive_business_user: string;
  onedrive_business_folder_path: string;
  digest_hour: string;
  retention_years: number;
  mfa_enabled: boolean;
}
export interface State {
  firms: AuditFirm[];
  profiles: Profile[];
  memberships: Membership[];
  entities: Entity[];
  engagements: Engagement[];
  engagement_users: EngagementUser[];
  requests: PbcRequest[];
  documents: DocumentRecord[];
  comments: Comment[];
  events: AuditEvent[];
  settings: Settings;
  current_firm_id: string;
  current_user_id: string;
  is_global_admin: boolean;
}

export const statusLabels: Record<RequestStatus, string> = {
  draft: "Nesolicitat",
  requested: "Solicitat",
  received: "Primit",
  review: "În revizuire",
  clarification: "Clarificare necesară",
  complete: "Complet",
  not_applicable: "Nu se aplică",
};

export const roleLabels: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  auditor: "Auditor",
  client: "Client",
};

export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);
export const formatDate = (value: string) =>
  value ? new Date(value).toLocaleDateString("ro-RO") : "—";
export const formatDateTime = (value: string) =>
  value ? new Date(value).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function createDemo(): State {
  const firm = "firm-celentis";
  const firm2 = "firm-demo";
  const engagement = "eng-abc-2026";
  const admin = "user-admin";
  const auditor = "user-auditor";
  const client = "user-client";
  const now = new Date().toISOString();
  const request = (partial: Partial<PbcRequest> & Pick<PbcRequest, "id" | "code" | "area" | "title" | "status">): PbcRequest => ({
    id: partial.id,
    audit_firm_id: firm,
    engagement_id: engagement,
    code: partial.code,
    area: partial.area,
    title: partial.title,
    description: partial.description ?? `${partial.title} pentru închiderea exercițiului financiar.`,
    instructions: partial.instructions ?? "Includeți documentul complet și descrieți clar conținutul și perioada.",
    period: partial.period ?? "31.12.2026",
    client_owner_id: client,
    auditor_id: auditor,
    created_by: auditor,
    deadline: partial.deadline ?? "2027-01-15",
    priority: partial.priority ?? "normal",
    status: partial.status,
    not_applicable_reason: partial.not_applicable_reason ?? "",
    created_at: now,
    updated_at: partial.updated_at ?? now,
  });
  const requests = [
    request({ id: "req-1", code: "TB-01", area: "Balanță și GL", title: "Balanța de verificare finală", status: "requested", priority: "urgent" }),
    request({ id: "req-2", code: "FA-03", area: "Imobilizări", title: "Registrul mijloacelor fixe", status: "received" }),
    request({ id: "req-3", code: "CA-04", area: "Disponibilități", title: "Extrase bancare", status: "clarification", period: "Decembrie 2026" }),
    request({ id: "req-4", code: "LEG-02", area: "Juridic", title: "Contracte noi semnificative", status: "not_applicable", period: "FY2026", not_applicable_reason: "Nu au existat contracte noi semnificative în cursul exercițiului." }),
    request({ id: "req-5", code: "AR-02", area: "Clienți", title: "Aging clienți", status: "review" }),
    request({ id: "req-6", code: "PAY-01", area: "Personal", title: "State de plată decembrie", status: "complete" }),
    request({ id: "req-7", code: "INV-05", area: "Stocuri", title: "Proces-verbal inventariere", status: "requested" }),
    request({ id: "req-8", code: "TAX-03", area: "Taxe", title: "Declarația anuală de impozit pe profit", status: "draft" }),
  ];
  return {
    firms: [
      { id: firm, name: "Celentis Audit", code: "CELENTIS", cui: "", email: "office@celentis.ro", phone: "", website: "", address: "", active: true },
      { id: firm2, name: "Demo Audit Network", code: "DEMO", cui: "", email: "office@demo.local", phone: "", website: "", address: "", active: true },
    ],
    profiles: [
      { id: admin, name: "Mihai Ureche", email: "administrator@demo.local" },
      { id: auditor, name: "Andrei Matei", email: "auditor@demo.local" },
      { id: client, name: "Maria Ionescu", email: "client@demo.local" },
    ],
    memberships: [
      { id: "mem-1", audit_firm_id: firm, user_id: admin, role: "admin", active: true },
      { id: "mem-2", audit_firm_id: firm, user_id: auditor, role: "auditor", active: true },
      { id: "mem-3", audit_firm_id: firm, user_id: client, role: "client", active: true },
      { id: "mem-4", audit_firm_id: firm2, user_id: admin, role: "admin", active: true },
    ],
    entities: [{ id: "entity-abc", audit_firm_id: firm, name: "ABC SRL", cui: "RO12345678", address: "", contact_name: "Maria Ionescu", email: "client@demo.local" }],
    engagements: [{ id: engagement, audit_firm_id: firm, entity_id: "entity-abc", name: "Audit statutar ABC SRL", period: "01.01.2026 – 31.12.2026", start_date: "2026-01-01", end_date: "2026-12-31", financial_statement_date: "2026-12-31", confirmation_date: "2027-01-31", deadline: "2027-01-31", status: "active", manager_id: auditor, auditor_id: auditor, client_id: client }],
    engagement_users: [
      { engagement_id: engagement, audit_firm_id: firm, user_id: auditor },
      { engagement_id: engagement, audit_firm_id: firm, user_id: client },
    ],
    requests,
    documents: [
      { id: "doc-1", audit_firm_id: firm, request_id: "req-2", name: "Registru_mijloace_fixe_2026.xlsx", description: "Registrul complet la 31.12.2026, cu cost și amortizare cumulată.", period: "31.12.2026", uploaded_by: client, uploaded_at: "2027-01-14T10:43:00Z", version: 1, status: "new", auditor_comment: "", size: 128400, storage_path: "" },
      { id: "doc-2", audit_firm_id: firm, request_id: "req-3", name: "Extrase_decembrie.pdf", description: "Extrasele tuturor conturilor bancare pentru luna decembrie 2026.", period: "Decembrie 2026", uploaded_by: client, uploaded_at: "2027-01-13T15:20:00Z", version: 1, status: "replace", auditor_comment: "Lipsește extrasul pentru contul în EUR.", size: 2456000, storage_path: "" },
      { id: "doc-3", audit_firm_id: firm, request_id: "req-5", name: "Aging_clienti_2026.xlsx", description: "Aging clienți la 31.12.2026, în RON, inclusiv facturile neîncasate ulterior.", period: "31.12.2026", uploaded_by: client, uploaded_at: "2027-01-15T08:15:00Z", version: 1, status: "new", auditor_comment: "", size: 334200, storage_path: "" },
      { id: "doc-4", audit_firm_id: firm, request_id: "req-6", name: "State_plata_dec_2026.pdf", description: "Statul de plată pentru luna decembrie 2026.", period: "Decembrie 2026", uploaded_by: client, uploaded_at: "2027-01-12T11:05:00Z", version: 1, status: "accepted", auditor_comment: "Document acceptat.", size: 780400, storage_path: "" },
    ],
    comments: [
      { id: "com-1", audit_firm_id: firm, request_id: "req-3", author_id: auditor, body: "Fișierul nu include extrasul pentru contul în EUR. Îl puteți transmite?", created_at: "2027-01-14T09:10:00Z" },
      { id: "com-2", audit_firm_id: firm, request_id: "req-3", author_id: client, body: "Da. Vom încărca versiunea completă astăzi.", created_at: "2027-01-14T09:42:00Z" },
    ],
    events: [
      { id: "evt-1", audit_firm_id: firm, request_id: "req-2", actor_id: client, action: "DOCUMENT_UPLOADED", details: "Registru_mijloace_fixe_2026.xlsx · versiunea 1", created_at: "2027-01-14T10:43:00Z" },
      { id: "evt-2", audit_firm_id: firm, request_id: "req-3", actor_id: auditor, action: "CLARIFICATION_REQUESTED", details: "A fost solicitat extrasul pentru contul în EUR.", created_at: "2027-01-14T09:10:00Z" },
      { id: "evt-3", audit_firm_id: firm, request_id: "req-5", actor_id: client, action: "DOCUMENT_UPLOADED", details: "Aging_clienti_2026.xlsx · versiunea 1", created_at: "2027-01-15T08:15:00Z" },
    ],
    settings: { supabase_url: "", supabase_publishable_key: "", global_admin_email: "", storage_provider: "sharepoint", sharepoint_host: "", sharepoint_site_path: "", sharepoint_library: "Documente", onedrive_personal_user: "", onedrive_personal_folder_path: "", onedrive_business_user: "", onedrive_business_folder_path: "", digest_hour: "17:00", retention_years: 7, mfa_enabled: true },
    current_firm_id: firm,
    current_user_id: admin,
    is_global_admin: true,
  };
}
