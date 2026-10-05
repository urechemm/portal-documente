import { createDemo, type AuditEvent, type DocumentRecord, type PbcRequest, type RequestStatus, type Role, type State, uid } from "./domain";

const STORAGE_KEY = "portal-documente-demo-v1";

export function readState(): State {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createDemo();
  try {
    return JSON.parse(saved) as State;
  } catch {
    return createDemo();
  }
}

export function writeState(state: State) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY);
}

function event(state: State, requestId: string | null, action: string, details: string): AuditEvent {
  return { id: uid(), audit_firm_id: state.current_firm_id, request_id: requestId, actor_id: state.current_user_id, action, details, created_at: new Date().toISOString() };
}

export function mutateState(state: State, mutation: (draft: State) => void): State {
  const next = structuredClone(state);
  mutation(next);
  if (sessionStorage.getItem("portal-runtime-mode") !== "live") writeState(next);
  return next;
}

export function updateRequestStatus(state: State, requestId: string, status: RequestStatus, reason = "") {
  return mutateState(state, (draft) => {
    const request = draft.requests.find((item) => item.id === requestId);
    if (!request) return;
    request.status = status;
    request.not_applicable_reason = status === "not_applicable" ? reason : request.not_applicable_reason;
    request.updated_at = new Date().toISOString();
    draft.events.unshift(event(draft, requestId, "STATUS_CHANGED", `Status schimbat în ${status}.`));
  });
}

export function uploadDocument(state: State, requestId: string, file: File, description: string, period: string, relativePath = file.name) {
  return mutateState(state, (draft) => {
    const versions = draft.documents.filter((item) => item.request_id === requestId && item.name === relativePath);
    const document: DocumentRecord = {
      id: uid(), audit_firm_id: draft.current_firm_id, request_id: requestId, name: relativePath,
      description, period, uploaded_by: draft.current_user_id, uploaded_at: new Date().toISOString(),
      version: versions.length + 1, status: "new", auditor_comment: "", size: file.size, storage_path: "",
    };
    draft.documents.unshift(document);
    const request = draft.requests.find((item) => item.id === requestId);
    if (request && ["draft", "requested", "clarification"].includes(request.status)) request.status = "received";
    if (request) request.updated_at = document.uploaded_at;
    draft.events.unshift(event(draft, requestId, "DOCUMENT_UPLOADED", `${relativePath} · versiunea ${document.version}`));
  });
}

export function addComment(state: State, requestId: string, body: string) {
  return mutateState(state, (draft) => {
    draft.comments.push({ id: uid(), audit_firm_id: draft.current_firm_id, request_id: requestId, author_id: draft.current_user_id, body, created_at: new Date().toISOString() });
    draft.events.unshift(event(draft, requestId, "COMMENT_ADDED", body));
  });
}

export function addRequest(state: State, request: Omit<PbcRequest, "id" | "audit_firm_id" | "created_at" | "updated_at" | "not_applicable_reason">) {
  return mutateState(state, (draft) => {
    const at = new Date().toISOString();
    draft.requests.push({ ...request, id: uid(), audit_firm_id: draft.current_firm_id, not_applicable_reason: "", created_at: at, updated_at: at });
    draft.events.unshift(event(draft, null, "REQUEST_CREATED", `${request.code} · ${request.title}`));
  });
}

export function setRole(state: State, role: Role) {
  const member = state.memberships.find((item) => item.audit_firm_id === state.current_firm_id && item.role === role && item.active);
  if (!member) return state;
  return mutateState(state, (draft) => { draft.current_user_id = member.user_id; });
}
