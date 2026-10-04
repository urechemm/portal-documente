import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, Bell, Building2, Check, CheckCircle2, ChevronDown, ChevronRight,
  ChevronsUpDown, CircleAlert, Clock3, Download, FileCheck2, Files, FileText,
  Filter, LayoutDashboard, LogOut, Menu, MessageSquareText, PanelLeftClose, PanelLeftOpen,
  Plus, Search, Settings, ShieldCheck, Upload, UserRoundCog, Users, X,
} from "lucide-react";
import {
  formatDate, formatDateTime, roleLabels, statusLabels, today, uid,
  type Engagement, type PbcRequest, type RequestStatus, type Role, type State,
} from "./domain";
import { addComment, addRequest, mutateState, readState, resetState, setRole, updateRequestStatus, uploadDocument } from "./store";
import { importRequests, requestTemplate } from "./files";

type Page = "dashboard" | "requests" | "engagements" | "activity" | "team" | "settings";
type ModalName = "upload" | "detail" | "not-applicable" | "request" | "engagement" | "import" | "invite" | "firm" | null;
type SortKey = "code" | "title" | "area" | "period" | "deadline" | "status" | "documents";

const statusTone: Record<RequestStatus, string> = {
  draft: "neutral", requested: "missing", received: "received", review: "review",
  clarification: "clarification", complete: "complete", not_applicable: "neutral",
};

function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><div className="eyebrow">PORTAL DOCUMENTE</div><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="Închide"><X /></button></header>
      {children}
    </section>
  </div>;
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge ${statusTone[status]}`}><i />{statusLabels[status]}</span>;
}

function SortButton({ label, name, active, direction, onSort }: { label: string; name: SortKey; active: boolean; direction: "asc" | "desc"; onSort: (key: SortKey) => void }) {
  return <button className={`sort-button ${active ? "active" : ""}`} onClick={() => onSort(name)}>{label}<ChevronsUpDown size={14} aria-label={active ? `Sortare ${direction}` : "Sortează"} /></button>;
}

interface AppProps {
  initialState?: State;
  live?: boolean;
  persist?: (before: State, after: State) => Promise<State>;
  reload?: (firm?: string | null) => Promise<State>;
  uploadLive?: (requestId: string, file: File, description: string, period: string) => Promise<void>;
  inviteLive?: (auditFirmId: string, name: string, email: string, role: Role) => Promise<boolean>;
  logout?: () => Promise<unknown>;
}

export default function App({ initialState, live = false, persist, reload, uploadLive, inviteLive, logout }: AppProps = {}) {
  const [state, setState] = useState<State>(() => initialState ?? readState());
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEngagementId, setSelectedEngagementId] = useState<string | null>(() => sessionStorage.getItem("portal-selected-engagement"));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "deadline", direction: "asc" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(sessionStorage.getItem("portal-sidebar-collapsed") === "yes");
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const firm = state.firms.find((item) => item.id === state.current_firm_id)!;
  const membership = state.memberships.find((item) => item.audit_firm_id === state.current_firm_id && item.user_id === state.current_user_id)!;
  const profile = state.profiles.find((item) => item.id === state.current_user_id)!;
  const role = membership?.role ?? "client";
  const auditUser = role !== "client";
  const manager = ["admin", "manager", "auditor"].includes(role);
  const activeEngagements = state.engagements.filter((item) => item.audit_firm_id === state.current_firm_id);
  const currentEngagement = activeEngagements.find((item) => item.id === selectedEngagementId) ?? activeEngagements[0];
  const tenantRequests = state.requests.filter((item) => item.engagement_id === currentEngagement?.id && (role !== "client" || item.client_owner_id === state.current_user_id));
  const documents = state.documents.filter((item) => item.audit_firm_id === state.current_firm_id);
  const comments = state.comments.filter((item) => item.audit_firm_id === state.current_firm_id);
  const selected = tenantRequests.find((item) => item.id === selectedId) ?? null;
  const currentEntity = state.entities.find((item) => item.id === currentEngagement?.entity_id);
  const missionMemberIds = new Set(state.engagement_users.filter((item) => item.engagement_id === currentEngagement?.id).map((item) => item.user_id));
  const canCreateRequest = !!currentEngagement && role !== "client" && (role === "admin" || currentEngagement.auditor_id === state.current_user_id || missionMemberIds.has(state.current_user_id));
  const areas = [...new Set(tenantRequests.map((item) => item.area))].sort();
  const actionStatuses: RequestStatus[] = role === "client" ? ["requested", "clarification"] : ["received", "review", "clarification"];
  const actionRequests = tenantRequests.filter((item) => actionStatuses.includes(item.status));

  const displayed = useMemo(() => {
    const countDocuments = (id: string) => documents.filter((item) => item.request_id === id).length;
    const value = (request: PbcRequest, key: SortKey): string | number => key === "documents" ? countDocuments(request.id) : request[key];
    return tenantRequests
      .filter((item) => `${item.code} ${item.title} ${item.area} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
      .filter((item) => statusFilter === "all" || item.status === statusFilter)
      .filter((item) => areaFilter === "all" || item.area === areaFilter)
      .sort((a, b) => String(value(a, sort.key)).localeCompare(String(value(b, sort.key)), "ro", { numeric: true }) * (sort.direction === "asc" ? 1 : -1));
  }, [tenantRequests, documents, search, statusFilter, areaFilter, sort]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }
  function openRequest(id: string, next: ModalName = "detail") { setSelectedId(id); setModal(next); setError(""); }
  function sortBy(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function nav(next: Page) { setPage(next); setMobileNav(false); setSearch(""); }
  function selectEngagement(id: string) { setSelectedEngagementId(id); sessionStorage.setItem("portal-selected-engagement", id); setPage("requests"); }
  function docsFor(requestId: string) { return documents.filter((item) => item.request_id === requestId); }
  function profileName(id: string) { return state.profiles.find((item) => item.id === id)?.name ?? "Utilizator"; }
  async function save(next: State, message: string) {
    setError("");
    try {
      setState(persist ? await persist(state, next) : next);
      notify(message);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function switchWorkspace(firmId: string) {
    setError("");
    try {
      if (live && reload) setState(await reload(firmId));
      else setState(mutateState(state, (draft) => { draft.current_firm_id = firmId; }));
      setPage("dashboard");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function toggleFirm(firmId: string) {
    const target = state.firms.find((item) => item.id === firmId);
    if (!target) return;
    if (target.active && state.firms.filter((item) => item.active).length === 1) {
      setError("Trebuie să rămână activă cel puțin o firmă de audit.");
      return;
    }
    const next = mutateState(state, (draft) => {
      const firmRow = draft.firms.find((item) => item.id === firmId);
      if (firmRow) firmRow.active = !firmRow.active;
      if (firmId === draft.current_firm_id && firmRow && !firmRow.active) {
        const replacement = draft.firms.find((item) => item.active);
        if (replacement) draft.current_firm_id = replacement.id;
      }
    });
    await save(next, target.active ? "Firma de audit a fost dezactivată." : "Firma de audit a fost activată.");
  }

  const navItems: { page: Page; label: string; icon: typeof LayoutDashboard; count?: number; admin?: boolean }[] = [
    { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { page: "engagements", label: "Misiuni", icon: Files },
    { page: "requests", label: "Lista cerințe", icon: FileText, count: tenantRequests.length },
    { page: "activity", label: "Activitate", icon: Activity, count: actionRequests.length },
    { page: "team", label: "Echipă și acces", icon: Users, admin: true },
    { page: "settings", label: "Setări", icon: Settings, admin: true },
  ];

  return <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileNav ? "visible" : ""}`}>
      <button className="sidebar-toggle" onClick={() => { const next = !sidebarCollapsed; setSidebarCollapsed(next); sessionStorage.setItem("portal-sidebar-collapsed", next ? "yes" : "no"); }} aria-label={sidebarCollapsed ? "Extinde meniul" : "Restrânge meniul"}>{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
      <div className="brand"><span className="brand-icon"><FileCheck2 /></span><b>Portal<span>Documente</span></b></div>
      <label className="workspace-tag workspace-picker"><span className="workspace-logo">{firm.code.slice(0, 2)}</span><div><strong>{firm.name}</strong><small>{firm.code} · spațiu securizat</small></div><ChevronDown size={14}/><select aria-label="Alege firma de audit" value={state.current_firm_id} onChange={(event) => void switchWorkspace(event.target.value)}>{state.firms.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="nav-label">SPAȚIU DE LUCRU</div>
      <nav>{navItems.filter((item) => !item.admin || role === "admin").map((item) => <button key={item.page} className={page === item.page ? "active" : ""} onClick={() => nav(item.page)} title={item.label}><item.icon size={18} /><span>{item.label}</span>{item.count !== undefined && <small className="nav-count">{item.count}</small>}</button>)}</nav>
      <div className="sidebar-security"><ShieldCheck size={17} /><span>Acces izolat per tenant<br/><small>Audit trail activ</small></span></div>
    </aside>

    <section className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Meniu"><Menu /></button><span>Celentis Audit</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.page === page)?.label}</strong></div>
        <div className="topbar-right">
          <span className={`environment ${live ? "live" : "demo"}`}><i />{live ? "LIVE" : "DEMO LOCAL"}</span>
          <button className="icon-button notification" aria-label="Notificări"><Bell /><i>{actionRequests.length}</i></button>
          <div className="user-switch"><span className="avatar">{profile.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{profile.name}</strong><small>{roleLabels[role]}</small></div>{live ? <button className="logout-button" onClick={() => void logout?.()} title="Deconectare" aria-label="Deconectare"><LogOut/></button> : <select aria-label="Rol demonstrativ" value={role} onChange={(event) => { const next = setRole(state, event.target.value as Role); setState(next); nav("dashboard"); }}><option value="admin">Administrator</option><option value="auditor">Auditor</option><option value="client">Client</option></select>}</div>
        </div>
      </header>

      <main>
        {page === "dashboard" && <Dashboard role={role} engagement={currentEngagement} entityName={currentEntity?.name ?? "Entitate"} requests={tenantRequests} documents={documents} actionRequests={actionRequests} openRequest={openRequest} />}

        {page === "requests" && <>
          <div className="page-heading"><div><div className="eyebrow">CERINȚA ESTE OBIECTUL CENTRAL</div><h1>Liste cerințe{currentEngagement ? ` – ${currentEngagement.name}` : ""}</h1><p>Documente, descrieri, conversații și istoric — toate legate de misiunea de audit selectată.</p></div>{canCreateRequest && <div className="heading-actions"><button className="secondary" onClick={() => setModal("import")}><Upload size={17}/>Importă</button><button className="primary" onClick={() => setModal("request")}><Plus size={17}/>Cerință nouă</button></div>}</div>
          {!currentEngagement && <div className="notice"><CircleAlert/>Creează mai întâi o misiune de audit, apoi vei putea adăuga lista de cerințe.</div>}
          <section className="toolbar"><label className="search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caută după cod, cerință sau arie…" /></label><label><Filter size={15}/><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Toate statusurile</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="all">Toate ariile</option>{areas.map((area) => <option key={area}>{area}</option>)}</select></label><span className="result-count">{displayed.length} rezultate</span></section>
          <RequestTable requests={displayed} docsFor={docsFor} sort={sort} sortBy={sortBy} openRequest={openRequest} client={!auditUser} profileName={profileName} />
        </>}

        {page === "engagements" && <>
          <div className="page-heading"><div><div className="eyebrow">PORTOFOLIU</div><h1>Misiuni</h1><p>Un spațiu separat pentru fiecare audit, entitate și perioadă.</p></div>{manager && <button className="primary" onClick={() => setModal("engagement")}><Plus size={17}/>Misiune nouă</button>}</div>
          <div className="engagement-grid">{activeEngagements.map((engagement) => { const entity = state.entities.find((item) => item.id === engagement.entity_id); const rows = state.requests.filter((item) => item.engagement_id === engagement.id); const complete = rows.filter((item) => item.status === "complete" || item.status === "not_applicable").length; return <article className="engagement-card" key={engagement.id}><header><span className="entity-mark">{entity?.name.slice(0, 2).toUpperCase()}</span><StatusBadge status={engagement.status === "closed" ? "complete" : "review"}/></header><h2>{engagement.name}</h2><p>{entity?.name} · {entity?.cui}</p><div className="engagement-meta"><span><small>Perioadă</small>{engagement.period}</span><span><small>Confirmare</small>{formatDate(engagement.confirmation_date || engagement.deadline)}</span></div><div className="completion"><div><span>Progres</span><strong>{rows.length ? Math.round(complete / rows.length * 100) : 0}%</strong></div><i><b style={{ width: `${rows.length ? complete / rows.length * 100 : 0}%` }}/></i></div><footer><span>{rows.length} cerințe</span><button onClick={() => selectEngagement(engagement.id)}>Deschide <ChevronRight size={15}/></button></footer></article>; })}{!activeEngagements.length && <Empty title="Nicio misiune" text="Creează prima misiune de audit pentru acest tenant."/>}</div>
        </>}

        {page === "activity" && <ActivityPage state={state} tenantRequests={tenantRequests} profileName={profileName} />}

        {page === "team" && role === "admin" && <TeamPage state={state} save={(next, message) => void save(next, message)} invite={() => { setError(""); setModal("invite"); }} />}

        {page === "settings" && role === "admin" && <SettingsPage state={state} setState={setState} notify={notify} live={live} persist={(next, message) => void save(next, message)} createFirm={() => { setError(""); setModal("firm"); }} toggleFirm={toggleFirm} />}
      </main>
      <footer className="page-footer"><span>Portal Documente · MVP</span><span><ShieldCheck size={14}/>Segregare multi-tenant · jurnalizare activă</span></footer>
    </section>

    {modal === "detail" && selected && <RequestDetail request={selected} documents={docsFor(selected.id)} comments={comments.filter((item) => item.request_id === selected.id)} profileName={profileName} auditUser={auditUser} close={() => setModal(null)} upload={() => setModal("upload")} notApplicable={() => setModal("not-applicable")} updateStatus={(status) => save(updateRequestStatus(state, selected.id, status), `Cerința este acum „${statusLabels[status]}”.`)} addMessage={(body) => save(addComment(state, selected.id, body), "Mesajul a fost adăugat.")} />}
    {modal === "upload" && selected && <UploadModal request={selected} close={() => setModal(null)} submit={async (file, description, period) => { if (live && uploadLive && reload) { try { await uploadLive(selected.id, file, description, period); setState(await reload(state.current_firm_id)); notify("Documentul a fost încărcat în SharePoint."); setModal("detail"); } catch (reason) { setError((reason as Error).message); } } else { void save(uploadDocument(state, selected.id, file, description, period), "Documentul a fost asociat cerinței."); setModal("detail"); } }} />}
    {modal === "not-applicable" && selected && <NotApplicableModal close={() => setModal("detail")} submit={(reason) => { save(updateRequestStatus(state, selected.id, "not_applicable", reason), "Explicația a fost înregistrată în audit trail."); setModal("detail"); }} />}
    {modal === "request" && currentEngagement && <RequestForm state={state} engagement={currentEngagement} close={() => setModal(null)} submit={(request) => { save(addRequest(state, request), "Cerința a fost creată."); setModal(null); }} />}
    {modal === "engagement" && <EngagementForm state={state} close={() => setModal(null)} submit={(engagement, entityDetails, memberIds) => { const next = mutateState(state, (draft) => { const entityId = uid(); draft.entities.push({ id: entityId, audit_firm_id: draft.current_firm_id, ...entityDetails }); draft.engagements.push({ ...engagement, entity_id: entityId }); for (const userId of new Set([engagement.auditor_id, engagement.client_id, ...memberIds])) draft.engagement_users.push({ engagement_id: engagement.id, audit_firm_id: draft.current_firm_id, user_id: userId }); }); setSelectedEngagementId(engagement.id); sessionStorage.setItem("portal-selected-engagement", engagement.id); save(next, "Misiunea a fost creată."); setModal(null); }} />}
    {modal === "import" && <ImportModal state={state} close={() => setModal(null)} submit={(rows) => { const next = mutateState(state, (draft) => { const at = new Date().toISOString(); for (const row of rows) draft.requests.push({ id: uid(), audit_firm_id: draft.current_firm_id, engagement_id: currentEngagement?.id ?? "", code: row.code!, area: row.area!, title: row.title!, description: row.description ?? "", instructions: row.instructions ?? "", period: row.period || currentEngagement?.period || "", client_owner_id: state.profiles.find((item) => state.memberships.some((membership) => membership.user_id === item.id && membership.role === "client"))?.id ?? "", auditor_id: state.profiles.find((item) => state.memberships.some((membership) => membership.user_id === item.id && membership.role === "auditor"))?.id ?? state.current_user_id, deadline: row.deadline || currentEngagement?.deadline || today(), priority: row.priority ?? "normal", status: "draft", not_applicable_reason: "", created_at: at, updated_at: at }); }); save(next, `${rows.length} cerințe au fost importate.`); setModal(null); }} />}
    {modal === "invite" && <InviteUserModal firms={state.firms} currentFirmId={state.current_firm_id} close={() => setModal(null)} submit={async (auditFirmId, name, email, invitedRole) => { try { if (live && inviteLive && reload) { const invited = await inviteLive(auditFirmId, name, email, invitedRole); setState(await reload(state.current_firm_id)); notify(invited ? "Invitația a fost trimisă prin email." : "Accesul utilizatorului existent a fost actualizat."); } else { const next = mutateState(state, (draft) => { const existing = draft.profiles.find((item) => item.email.toLowerCase() === email.toLowerCase()); const userId = existing?.id ?? uid(); if (!existing) draft.profiles.push({ id: userId, name, email }); const membership = draft.memberships.find((item) => item.audit_firm_id === auditFirmId && item.user_id === userId); if (membership) { membership.role = invitedRole; membership.active = true; } else draft.memberships.push({ id: uid(), audit_firm_id: auditFirmId, user_id: userId, role: invitedRole, active: true }); }); setState(next); notify("Utilizatorul demonstrativ a fost adăugat."); } setModal(null); } catch (reason) { setError((reason as Error).message); } }} />}
    {modal === "firm" && <AuditFirmModal close={() => setModal(null)} submit={(details) => { const next = mutateState(state, (draft) => { const firmId = uid(); draft.firms.push({ id: firmId, ...details, code: details.code.toUpperCase(), active: true }); draft.memberships.push({ id: uid(), audit_firm_id: firmId, user_id: draft.current_user_id, role: "admin", active: true }); }); void save(next, "Spațiul de lucru a fost creat."); setModal(null); }} />}
    {error && <div className="toast error-toast"><CircleAlert/><span>{error}</span><button onClick={() => setError("")}><X/></button></div>}
    {toast && <div className="toast"><CheckCircle2/><span>{toast}</span></div>}
  </div>;
}

function Dashboard({ role, engagement, entityName, requests, documents, actionRequests, openRequest }: { role: Role; engagement?: Engagement; entityName: string; requests: PbcRequest[]; documents: State["documents"]; actionRequests: PbcRequest[]; openRequest: (id: string, modal?: ModalName) => void }) {
  const complete = requests.filter((item) => ["complete", "not_applicable"].includes(item.status)).length;
  const review = requests.filter((item) => ["received", "review"].includes(item.status)).length;
  const clarification = requests.filter((item) => item.status === "clarification").length;
  const missing = requests.filter((item) => ["draft", "requested"].includes(item.status)).length;
  const client = role === "client";
  return <>
    <div className="page-heading dashboard-title"><div><div className="eyebrow">{client ? "SPAȚIUL DUMNEAVOASTRĂ DE AUDIT" : "VEDERE ECHIPĂ AUDIT"}</div><h1>{engagement?.name ?? "Portal Documente"}</h1><p>{entityName} · {engagement?.period ?? "Perioadă neconfigurată"}</p></div><div className="deadline-card"><Clock3/><span><small>Termen general</small><strong>{formatDate(engagement?.deadline ?? "")}</strong></span></div></div>
    <div className="stats"><Stat label="Cerințe totale" value={requests.length} icon={<Files/>} caption="Lista curentă PBC"/><Stat label="Completate" value={complete} icon={<CheckCircle2/>} caption={`${requests.length ? Math.round(complete / requests.length * 100) : 0}% din total`} progress={requests.length ? complete / requests.length * 100 : 0}/><Stat label="În revizuire" value={review} icon={<FileCheck2/>} caption="Documente primite"/><Stat label="Clarificări" value={clarification} icon={<MessageSquareText/>} caption="Necesită răspuns" alert={clarification > 0}/><Stat label="De transmis" value={missing} icon={<Upload/>} caption="Fără document complet"/></div>
    <div className="dashboard-grid"><section className="panel attention"><header><div><div className="eyebrow">PRIORITAR</div><h2>{client ? "Acțiuni necesare din partea dvs." : "Elemente care necesită atenție"}</h2></div><span className="count">{actionRequests.length}</span></header><div className="action-list">{actionRequests.slice(0, 6).map((request) => <button key={request.id} onClick={() => openRequest(request.id)}><span className={`attention-icon ${statusTone[request.status]}`}>{request.status === "clarification" ? <MessageSquareText/> : request.status === "requested" ? <Upload/> : <FileCheck2/>}</span><span><strong>{request.code} · {request.title}</strong><small>{request.area} · termen {formatDate(request.deadline)}</small></span><StatusBadge status={request.status}/><ChevronRight/></button>)}{!actionRequests.length && <Empty title="Totul este la zi" text="Nu există acțiuni restante pentru rolul curent."/>}</div></section>
      <section className="panel digest"><header><div><div className="eyebrow">ACTIVITATE ASTĂZI</div><h2>Digest {entityName}</h2></div><Bell/></header><div className="digest-number"><strong>{documents.filter((item) => item.uploaded_at.slice(0, 10) >= "2027-01-15").length}</strong><span>documente noi</span></div><div className="digest-row"><span>Răspunsuri la clarificări</span><strong>1</strong></div><div className="digest-row"><span>Marcaje „Nu se aplică”</span><strong>{requests.filter((item) => item.status === "not_applicable").length}</strong></div><p>Emailul digest consolidează activitatea; doar comentariile urgente generează notificări punctuale.</p></section></div>
  </>;
}

function Stat({ label, value, icon, caption, progress, alert }: { label: string; value: number; icon: ReactNode; caption: string; progress?: number; alert?: boolean }) {
  return <article className={`stat ${alert ? "alert" : ""}`}><span>{label}{icon}</span><strong>{value}</strong>{progress !== undefined && <div className="progress"><i style={{ width: `${progress}%` }}/></div>}<footer>{caption}</footer></article>;
}

function RequestTable({ requests, docsFor, sort, sortBy, openRequest, client, profileName }: { requests: PbcRequest[]; docsFor: (id: string) => State["documents"]; sort: { key: SortKey; direction: "asc" | "desc" }; sortBy: (key: SortKey) => void; openRequest: (id: string, modal?: ModalName) => void; client: boolean; profileName: (id: string) => string }) {
  return <div className="table-wrap"><table><thead><tr><th><SortButton label="Cod" name="code" active={sort.key === "code"} direction={sort.direction} onSort={sortBy}/></th><th><SortButton label="Cerință auditor" name="title" active={sort.key === "title"} direction={sort.direction} onSort={sortBy}/></th><th>Asignat către</th><th><SortButton label="Arie" name="area" active={sort.key === "area"} direction={sort.direction} onSort={sortBy}/></th><th><SortButton label="Perioadă" name="period" active={sort.key === "period"} direction={sort.direction} onSort={sortBy}/></th><th><SortButton label="Termen" name="deadline" active={sort.key === "deadline"} direction={sort.direction} onSort={sortBy}/></th><th><SortButton label="Status" name="status" active={sort.key === "status"} direction={sort.direction} onSort={sortBy}/></th><th><SortButton label="Documente" name="documents" active={sort.key === "documents"} direction={sort.direction} onSort={sortBy}/></th><th>Acțiune</th></tr></thead><tbody>{requests.map((request) => { const count = docsFor(request.id).length; const upload = client && ["draft", "requested"].includes(request.status); return <tr key={request.id}><td><span className="code">{request.code}</span>{request.priority === "urgent" && <small className="urgent">Urgent</small>}</td><td><button className="cell-link" onClick={() => openRequest(request.id)}>{request.title}</button><small>{request.description}</small></td><td><strong>{profileName(request.client_owner_id)}</strong></td><td>{request.area}</td><td>{request.period}</td><td className={request.deadline < today() && !["complete", "not_applicable"].includes(request.status) ? "overdue" : ""}>{formatDate(request.deadline)}</td><td><StatusBadge status={request.status}/></td><td><span className="document-count"><FileText/>{count || "—"}</span></td><td><button className={upload ? "primary small-button" : "secondary small-button"} onClick={() => openRequest(request.id, upload ? "upload" : "detail")}>{upload ? "Încarcă" : request.status === "clarification" && client ? "Răspunde" : "Vezi"}</button></td></tr>; })}</tbody></table>{!requests.length && <Empty title="Nicio cerință găsită" text="Modifică filtrele sau adaugă o cerință nouă."/>}</div>;
}

function RequestDetail({ request, documents, comments, profileName, auditUser, close, upload, notApplicable, updateStatus, addMessage }: { request: PbcRequest; documents: State["documents"]; comments: State["comments"]; profileName: (id: string) => string; auditUser: boolean; close: () => void; upload: () => void; notApplicable: () => void; updateStatus: (status: RequestStatus) => void; addMessage: (body: string) => void }) {
  const [message, setMessage] = useState("");
  return <Modal title={`${request.code} · ${request.title}`} close={close} wide><div className="detail-summary"><span><small>Arie</small>{request.area}</span><span><small>Perioadă</small>{request.period}</span><span><small>Deadline</small>{formatDate(request.deadline)}</span><span><small>Status</small><StatusBadge status={request.status}/></span></div><section className="request-brief"><h3>Ce solicită auditorul</h3><p>{request.description}</p><div className="instruction"><CircleAlert/><span><strong>Instrucțiuni</strong>{request.instructions}</span></div>{request.status === "not_applicable" && <div className="na-reason"><strong>Explicație „Nu se aplică”</strong><p>{request.not_applicable_reason}</p></div>}</section>
    <div className="detail-columns"><section><div className="section-heading"><h3>Documente <span>{documents.length}</span></h3><button className="secondary small-button" onClick={upload}><Upload/>Încarcă</button></div>{documents.map((document) => <article className="document-card" key={document.id}><div className="file-icon"><FileText/></div><div><strong>{document.name}</strong><p>{document.description}</p><small>{profileName(document.uploaded_by)} · {formatDateTime(document.uploaded_at)} · v{document.version}</small>{document.auditor_comment && <em>{document.auditor_comment}</em>}</div><span className={`doc-status ${document.status}`}>{document.status === "new" ? "Nou" : document.status === "accepted" ? "Acceptat" : "De înlocuit"}</span></article>)}{!documents.length && <Empty title="Niciun document" text="Fișierele încărcate vor apărea aici."/>}</section>
      <section><h3>Conversație <span>{comments.length}</span></h3><div className="thread">{comments.map((comment) => <article key={comment.id}><span className="mini-avatar">{profileName(comment.author_id).slice(0, 1)}</span><div><strong>{profileName(comment.author_id)}</strong><small>{formatDateTime(comment.created_at)}</small><p>{comment.body}</p></div></article>)}{!comments.length && <p className="muted">Nu există mesaje.</p>}</div><form className="comment-form" onSubmit={(event) => { event.preventDefault(); if (!message.trim()) return; addMessage(message.trim()); setMessage(""); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Scrie un mesaj legat de această cerință…" required/><button className="primary">Trimite mesajul</button></form></section></div>
    <footer className="modal-actions"><div>{!auditUser && request.status !== "not_applicable" && <button className="text-button" onClick={notApplicable}>Marchează „Nu se aplică”</button>}</div><div>{auditUser && <><button className="secondary" onClick={() => updateStatus("clarification")}>Solicită clarificări</button><button className="secondary" onClick={() => updateStatus("review")}>În revizuire</button><button className="primary" onClick={() => updateStatus("complete")}><Check/>Marchează complet</button></>}</div></footer>
  </Modal>;
}

function UploadModal({ request, close, submit }: { request: PbcRequest; close: () => void; submit: (file: File, description: string, period: string) => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [period, setPeriod] = useState(request.period);
  return <Modal title="Încarcă document" close={close}><div className="context-card"><small>Cerință</small><strong>{request.code} · {request.title}</strong></div><form onSubmit={(event) => { event.preventDefault(); if (file) submit(file, description.trim(), period); }}><label className="upload-zone"><Upload/><strong>{file ? file.name : "Alegeți sau trageți fișierul aici"}</strong><span>PDF, Excel, Word, imagini sau arhive</span><input type="file" required onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label><label>Descrierea documentului *<textarea required minLength={12} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={`Exemplu: ${request.title} la ${request.period}, după înregistrarea ajustărilor finale.`}/><small>Descrieți concret ce conține fișierul și perioada la care se referă.</small></label><label>Perioadă<input required value={period} onChange={(event) => setPeriod(event.target.value)}/></label><div className="notice"><ShieldCheck/>Documentul va fi asociat automat cerinței. Structura SharePoint rămâne invizibilă clientului.</div><div className="form-actions"><button type="button" className="secondary" onClick={close}>Renunță</button><button className="primary" disabled={!file || description.trim().length < 12}>Trimite auditorului</button></div></form></Modal>;
}

function NotApplicableModal({ close, submit }: { close: () => void; submit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <Modal title="Marchează „Nu se aplică”" close={close}><p>Explicația este obligatorie și va fi păstrată în audit trail.</p><form onSubmit={(event) => { event.preventDefault(); submit(reason.trim()); }}><label>Motiv *<textarea required minLength={15} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Exemplu: Nu au existat achiziții de terenuri în cursul exercițiului."/></label><div className="form-actions"><button type="button" className="secondary" onClick={close}>Renunță</button><button className="primary" disabled={reason.trim().length < 15}>Salvează explicația</button></div></form></Modal>;
}

function RequestForm({ state, engagement, close, submit }: { state: State; engagement: Engagement; close: () => void; submit: Parameters<typeof addRequest>[1] extends infer T ? (request: T) => void : never }) {
  const missionMembers = new Set(state.engagement_users.filter((item) => item.engagement_id === engagement.id).map((item) => item.user_id));
  const clients = state.memberships.filter((item) => item.audit_firm_id === state.current_firm_id && item.role === "client" && item.user_id === engagement.client_id);
  const auditors = state.memberships.filter((item) => item.audit_firm_id === state.current_firm_id && ["manager", "auditor"].includes(item.role) && (item.user_id === engagement.auditor_id || missionMembers.has(item.user_id)));
  return <Modal title="Cerință PBC nouă" close={close} wide><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ engagement_id: engagement.id, code: String(data.get("code")), area: String(data.get("area")), title: String(data.get("title")), description: String(data.get("description")), instructions: String(data.get("instructions")), period: String(data.get("period")), client_owner_id: String(data.get("client_owner_id")), auditor_id: String(data.get("auditor_id")), deadline: String(data.get("deadline")), priority: data.get("priority") as "normal" | "urgent", status: "draft" }); }}><div className="form-grid"><label>Cod *<input name="code" required placeholder="FA-03"/></label><label>Arie audit *<input name="area" required placeholder="Imobilizări"/></label><label className="span-2">Cerință *<input name="title" required placeholder="Registrul mijloacelor fixe"/></label><label className="span-2">Descriere *<textarea name="description" required placeholder="Registrul complet la 31.12.2026"/></label><label className="span-2">Instrucțiuni<input name="instructions" placeholder="Includeți cost, amortizare cumulată etc."/></label><label>Perioadă *<input name="period" defaultValue={engagement.period} required/></label><label>Deadline *<input name="deadline" type="date" defaultValue={engagement.deadline} required/></label><label>Responsabil client<select name="client_owner_id">{clients.map((item) => <option key={item.id} value={item.user_id}>{state.profiles.find((profile) => profile.id === item.user_id)?.name}</option>)}</select></label><label>Auditor responsabil<select name="auditor_id">{auditors.map((item) => <option key={item.id} value={item.user_id}>{state.profiles.find((profile) => profile.id === item.user_id)?.name}</option>)}</select></label><label>Prioritate<select name="priority"><option value="normal">Normală</option><option value="urgent">Urgentă</option></select></label></div><div className="form-actions"><button type="button" className="secondary" onClick={close}>Renunță</button><button className="primary">Creează cerința</button></div></form></Modal>;
}

function EngagementForm({ state, close, submit }: { state: State; close: () => void; submit: (engagement: Engagement, entity: Pick<State["entities"][number], "name" | "cui" | "address" | "contact_name" | "email">, memberIds: string[]) => void }) {
  const memberships = state.memberships.filter((item) => item.audit_firm_id === state.current_firm_id && item.active);
  const auditors = memberships.filter((item) => item.role === "manager" || item.role === "auditor");
  const clients = memberships.filter((item) => item.role === "client");
  const profileName = (id: string) => state.profiles.find((item) => item.id === id)?.name ?? state.profiles.find((item) => item.id === id)?.email ?? "Utilizator";
  return <Modal title="Creează misiune de audit" close={close} wide><form onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startDate = String(data.get("start_date"));
    const endDate = String(data.get("end_date"));
    const confirmationDate = String(data.get("confirmation_date"));
    const auditorId = String(data.get("auditor_id"));
    const clientId = String(data.get("client_id"));
    submit({ id: uid(), audit_firm_id: state.current_firm_id, entity_id: "", name: String(data.get("name")).trim(), period: `${startDate} – ${endDate}`, start_date: startDate, end_date: endDate, financial_statement_date: String(data.get("financial_statement_date")), confirmation_date: confirmationDate, deadline: confirmationDate, status: "active", manager_id: auditorId, auditor_id: auditorId, client_id: clientId }, { name: String(data.get("entity_name")).trim(), cui: String(data.get("cui")).trim(), address: String(data.get("address")).trim(), contact_name: String(data.get("contact_name")).trim(), email: String(data.get("email")).trim().toLowerCase() }, data.getAll("member_ids").map(String));
  }}>
    <h3>Client</h3><div className="form-grid">
      <label>Denumire client *<input name="entity_name" required/></label><label>CUI<input name="cui"/></label>
      <label>Adresă<input name="address" autoComplete="street-address"/></label><label>Persoană de contact<input name="contact_name" autoComplete="name"/></label>
      <label>Email *<input name="email" type="email" required autoComplete="email"/></label>
    </div>
    <h3>Misiune</h3><div className="form-grid">
      <label className="span-2">Denumire *<input name="name" required placeholder="Audit financiar 2026"/></label>
      <label>Început perioadă *<input name="start_date" type="date" required/></label><label>Sfârșit perioadă *<input name="end_date" type="date" required/></label>
      <label>Data situațiilor financiare *<input name="financial_statement_date" type="date" required/></label><label>Data confirmării *<input name="confirmation_date" type="date" required/></label>
      <label>Auditor *<select name="auditor_id" required defaultValue=""><option value="" disabled>Selectează…</option>{auditors.map((item) => <option key={item.user_id} value={item.user_id}>{profileName(item.user_id)} — {roleLabels[item.role]}</option>)}</select></label>
      <label>Client *<select name="client_id" required defaultValue=""><option value="" disabled>Selectează…</option>{clients.map((item) => <option key={item.user_id} value={item.user_id}>{profileName(item.user_id)} — Client</option>)}</select></label>
      <label className="span-2">Membrii echipei / acces client<select name="member_ids" multiple size={Math.min(7, Math.max(3, memberships.length))}>{memberships.map((item) => <option key={item.user_id} value={item.user_id}>{profileName(item.user_id)} — {roleLabels[item.role]}</option>)}</select><small>Ține apăsat Ctrl pentru a selecta mai mulți membri.</small></label>
    </div>
    {(!auditors.length || !clients.length) && <div className="error-box">Adaugă în „Echipă și acces” cel puțin un Auditor/Manager și un Client înainte de crearea misiunii.</div>}
    <div className="form-actions"><button type="button" className="secondary" onClick={close}>Renunță</button><button className="primary" disabled={!auditors.length || !clients.length}>Creează misiunea</button></div>
  </form></Modal>;
}

function ImportModal({ state, close, submit }: { state: State; close: () => void; submit: (rows: Partial<PbcRequest>[]) => void }) {
  const [rows, setRows] = useState<Partial<PbcRequest>[]>([]);
  const [error, setError] = useState("");
  return <Modal title="Importă lista de cerințe" close={close}><p>Acceptă fișiere Excel sau CSV. Antetele recunoscute includ Cod, Arie audit, Cerință, Descriere, Instrucțiuni, Perioadă, Deadline și Prioritate.</p><label className="upload-zone"><Upload/><strong>Alege fișierul cu cerințe</strong><span>.xlsx sau .csv</span><input type="file" accept=".xlsx,.csv" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setRows(await importRequests(file)); setError(""); } catch (reason) { setError((reason as Error).message); } }}/></label>{rows.length > 0 && <div className="import-success"><CheckCircle2/><span><strong>{rows.length} cerințe detectate</strong><small>Vor fi adăugate ca „Nesolicitat”.</small></span></div>}{error && <div className="error-box">{error}</div>}<button className="text-button template-download" onClick={() => void requestTemplate()}><Download/>Descarcă model Excel</button><div className="form-actions"><button className="secondary" onClick={close}>Renunță</button><button className="primary" disabled={!rows.length || !state.engagements.length} onClick={() => submit(rows)}>Importă {rows.length || ""} cerințe</button></div></Modal>;
}

function ActivityPage({ state, tenantRequests, profileName }: { state: State; tenantRequests: PbcRequest[]; profileName: (id: string) => string }) {
  const ids = new Set(tenantRequests.map((item) => item.id));
  const events = state.events.filter((item) => item.audit_firm_id === state.current_firm_id && (!item.request_id || ids.has(item.request_id))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <><div className="page-heading"><div><div className="eyebrow">DE LA ULTIMA AUTENTIFICARE</div><h1>Activitate recentă</h1><p>O urmă clară a documentelor, conversațiilor și modificărilor de status.</p></div></div><section className="panel activity-panel"><div className="activity-summary"><span><strong>{events.filter((item) => item.action === "DOCUMENT_UPLOADED").length}</strong> documente încărcate</span><span><strong>{events.filter((item) => item.action === "COMMENT_ADDED").length}</strong> mesaje noi</span><span><strong>{events.filter((item) => item.action === "STATUS_CHANGED").length}</strong> statusuri schimbate</span></div><div className="timeline">{events.map((event) => { const request = tenantRequests.find((item) => item.id === event.request_id); return <article key={event.id}><i/><div><div><strong>{request ? `${request.code} · ${request.title}` : "Administrare"}</strong><time>{formatDateTime(event.created_at)}</time></div><p>{event.details}</p><small>{profileName(event.actor_id)} · {event.action.replaceAll("_", " ")}</small></div></article>; })}</div></section></>;
}

function AuditFirmModal({ close, submit }: { close: () => void; submit: (firm: Omit<State["firms"][number], "id" | "active">) => void }) {
  return <Modal title="Firmă de audit nouă" close={close} wide>
    <p>Creează un spațiu de lucru separat, cu date și utilizatori izolați de celelalte firme.</p>
    <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ name: String(data.get("name")).trim(), code: String(data.get("code")).trim(), cui: String(data.get("cui")).trim(), email: String(data.get("email")).trim().toLowerCase(), phone: String(data.get("phone")).trim(), website: String(data.get("website")).trim(), address: String(data.get("address")).trim() }); }}>
      <div className="form-grid">
        <label>Denumire *<input name="name" required minLength={2} placeholder="Exemplu Audit SRL"/></label>
        <label>Cod unic *<input name="code" required minLength={2} maxLength={20} pattern="[A-Za-z0-9_-]+" placeholder="EXEMPLU"/><small>Doar litere, cifre, cratimă și underscore.</small></label>
        <label>CUI<input name="cui" placeholder="RO12345678"/></label>
        <label>Email *<input name="email" type="email" required autoComplete="email" placeholder="office@exemplu.ro"/></label>
        <label>Telefon<input name="phone" type="tel" autoComplete="tel" placeholder="+40 21 000 00 00"/></label>
        <label>Website<input name="website" type="url" placeholder="https://exemplu.ro"/></label>
        <label className="span-2">Adresă<input name="address" autoComplete="street-address" placeholder="Stradă, număr, localitate, județ"/></label>
      </div>
      <div className="notice"><ShieldCheck/>Administratorul curent va primi automat acces la noul tenant.</div>
      <div className="form-actions"><button type="button" className="secondary" onClick={close}>Renunță</button><button className="primary">Creează spațiul</button></div>
    </form>
  </Modal>;
}

function InviteUserModal({ firms, currentFirmId, close, submit }: { firms: State["firms"]; currentFirmId: string; close: () => void; submit: (auditFirmId: string, name: string, email: string, role: Role) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <Modal title="Invită utilizator" close={close}>
    <p>Utilizatorul va primi un email de acces și va fi alocat firmei de audit selectate.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      const data = new FormData(event.currentTarget);
      await submit(String(data.get("audit_firm_id")), String(data.get("name")).trim(), String(data.get("email")).trim(), data.get("role") as Role);
      setBusy(false);
    }}>
      <label>Nume complet *<input name="name" required minLength={2} autoComplete="name" placeholder="Maria Ionescu"/></label>
      <label>Email *<input name="email" type="email" required autoComplete="email" placeholder="maria@companie.ro"/></label>
      <label>Firmă audit<select name="audit_firm_id" defaultValue={currentFirmId} required>{firms.filter((firm) => firm.active).map((firm) => <option key={firm.id} value={firm.id}>{firm.name} · {firm.code}</option>)}</select></label>
      <label>Rol în tenant<select name="role" defaultValue="client"><option value="client">Client</option><option value="auditor">Auditor</option><option value="manager">Manager</option><option value="admin">Administrator</option></select></label>
      <div className="notice"><ShieldCheck/>Accesul este separat per firmă de audit și este protejat prin MFA.</div>
      <div className="form-actions"><button type="button" className="secondary" onClick={close}>Renunță</button><button className="primary" disabled={busy}>{busy ? "Se trimite…" : "Trimite invitația"}</button></div>
    </form>
  </Modal>;
}

function TeamPage({ state, save, invite }: { state: State; save: (state: State, message: string) => void; invite: () => void }) {
  const memberships = state.memberships.filter((item) => item.audit_firm_id === state.current_firm_id);
  return <><div className="page-heading"><div><div className="eyebrow">AUTORIZARE PER TENANT</div><h1>Echipă și acces</h1><p>Rolul este atribuit separat în fiecare firmă de audit.</p></div><button className="primary" onClick={invite}><Plus/>Invită utilizator</button></div><section className="panel"><div className="table-wrap flat"><table><thead><tr><th>Utilizator</th><th>Email</th><th>Rol în tenant</th><th>Status</th></tr></thead><tbody>{memberships.map((membership) => { const user = state.profiles.find((item) => item.id === membership.user_id)!; return <tr key={membership.id}><td><strong>{user.name}</strong></td><td>{user.email}</td><td><select value={membership.role} onChange={(event) => { const next = mutateState(state, (draft) => { const row = draft.memberships.find((item) => item.id === membership.id); if (row) row.role = event.target.value as Role; }); save(next, "Rolul a fost actualizat."); }}><option value="admin">Administrator</option><option value="manager">Manager</option><option value="auditor">Auditor</option><option value="client">Client</option></select></td><td><span className={`badge ${membership.active ? "complete" : "neutral"}`}><i/>{membership.active ? "Activ" : "Revocat"}</span></td></tr>; })}</tbody></table></div></section></>;
}

function SettingsPage({ state, live, persist, toggleFirm, createFirm }: { state: State; setState: (state: State) => void; notify: (message: string) => void; live: boolean; persist: (state: State, message: string) => void; toggleFirm: (firmId: string) => Promise<void>; createFirm: () => void }) {
  const [tab, setTab] = useState<"general" | "connections" | "tenants" | "security">("general");
  return <><div className="page-heading"><div><div className="eyebrow">DOAR ADMINISTRATOR</div><h1>Setări</h1><p>Configurația aplicației și conexiunile externe pot fi schimbate fără modificarea codului.</p></div></div><div className="settings-layout"><nav className="settings-nav"><button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}><Settings/>General</button><button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><Building2/>Conexiuni</button><button className={tab === "tenants" ? "active" : ""} onClick={() => setTab("tenants")}><Users/>Multi-tenant</button><button className={tab === "security" ? "active" : ""} onClick={() => setTab("security")}><ShieldCheck/>Securitate</button></nav><section className="panel settings-panel">
    {tab === "general" && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = mutateState(state, (draft) => { draft.settings.digest_hour = String(data.get("digest_hour")); draft.settings.retention_years = Number(data.get("retention_years")); }); persist(next, "Setările generale au fost salvate."); }}><h2>Preferințe operaționale</h2><p className="muted">Digestul reduce zgomotul și consolidează activitatea zilnică.</p><div className="form-grid"><label>Ora digestului<input name="digest_hour" type="time" defaultValue={state.settings.digest_hour}/></label><label>Retenție documente (ani)<input name="retention_years" type="number" min="1" max="20" defaultValue={state.settings.retention_years}/></label></div><button className="primary">Salvează</button></form>}
    {tab === "connections" && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = mutateState(state, (draft) => { if (!live) { draft.settings.supabase_url = String(data.get("supabase_url")); draft.settings.supabase_publishable_key = String(data.get("supabase_publishable_key")); } draft.settings.global_admin_email = String(data.get("global_admin_email")); draft.settings.sharepoint_host = String(data.get("sharepoint_host")); draft.settings.sharepoint_user = String(data.get("sharepoint_user")); draft.settings.sharepoint_site_path = String(data.get("sharepoint_site_path")); draft.settings.sharepoint_library = String(data.get("sharepoint_library")); }); persist(next, live ? "Configurația conexiunilor a fost salvată." : "Configurația conexiunilor a fost salvată local."); }}><h2>Conexiuni backend</h2><div className="connection-status"><span><i/>Supabase</span><strong>{live ? "Conectat · producție" : state.settings.supabase_url ? "Configurat" : "Neconfigurat"}</strong></div>{live ? <div className="notice"><ShieldCheck/>URL-ul și cheia publică Supabase sunt încărcate din configurația de deployment. Cheile private nu sunt expuse în browser.</div> : <><label>Supabase Project URL<input name="supabase_url" type="url" defaultValue={state.settings.supabase_url} placeholder="https://…supabase.co"/></label><label>Supabase publishable key<input name="supabase_publishable_key" type="password" defaultValue={state.settings.supabase_publishable_key} autoComplete="off" placeholder="sb_publishable_…"/></label></>}<label>Email Global Administrator<input name="global_admin_email" type="email" defaultValue={state.settings.global_admin_email} placeholder="administrator@firma.ro"/></label><div className="connection-status sharepoint"><span><i/>SharePoint / Microsoft 365</span><strong>{state.settings.sharepoint_host && state.settings.sharepoint_site_path ? "Configurat · Graph" : "Neconfigurat"}</strong></div><label>SharePoint host<input name="sharepoint_host" defaultValue={state.settings.sharepoint_host} placeholder="companie.sharepoint.com"/></label><label>Cale site SharePoint<input name="sharepoint_site_path" defaultValue={state.settings.sharepoint_site_path} placeholder="sites/Audit"/></label><label>Bibliotecă documente<input name="sharepoint_library" defaultValue={state.settings.sharepoint_library} placeholder="Documente"/></label><label>Utilizator Microsoft 365<input name="sharepoint_user" type="email" defaultValue={state.settings.sharepoint_user} placeholder="utilizator@companie.ro"/></label><div className="notice"><CircleAlert/>Secretul aplicației Microsoft este păstrat exclusiv în Supabase Secrets. Nicio parolă Microsoft nu este salvată în aplicație.</div><button className="primary">Salvează conexiunile</button></form>}
    {tab === "tenants" && <><div className="section-heading"><div><h2>Firme de audit</h2><p>Fiecare rând de business poartă obligatoriu identificatorul tenantului.</p></div>{state.is_global_admin && <button className="primary" onClick={createFirm}><Plus/>Firmă nouă</button>}</div><div className="tenant-list">{state.firms.map((firm) => <article key={firm.id}><span className="entity-mark">{firm.code.slice(0, 2)}</span><div><strong>{firm.name}</strong><small>{firm.code}{firm.email ? ` · ${firm.email}` : ""}</small></div><span className={`badge ${firm.active ? "complete" : "neutral"}`}><i/>{firm.active ? "Activ" : "Inactiv"}</span>{state.is_global_admin && <button className="secondary small-button" onClick={() => void toggleFirm(firm.id)}>{firm.active ? "Dezactivează" : "Activează"}</button>}</article>)}</div></>}
    {tab === "security" && <><h2>Controale de securitate</h2><div className="security-grid"><SecurityItem title="MFA" text="Impus prin furnizorul de identitate Microsoft / Supabase."/><SecurityItem title="RLS multi-tenant" text="Politicile bazei de date izolează fiecare firmă și client."/><SecurityItem title="Audit trail imuabil" text="Evenimentele pot fi adăugate, dar nu modificate de client."/><SecurityItem title="Jurnal acces" text="Downloadurile și schimbările de status sunt atribuite utilizatorului."/><SecurityItem title="Scanare fișiere" text="De activat în fluxul SharePoint/Graph înainte de producție."/><SecurityItem title="Revocare acces" text="Apartenența utilizatorului poate fi dezactivată imediat."/></div><div className="danger-zone"><div><strong>Resetează datele demonstrative</strong><small>Reface setul local de exemple. Nu afectează Supabase.</small></div><button className="secondary" onClick={() => { resetState(); location.reload(); }}>Reset demo</button></div></>}
  </section></div></>;
}

function SecurityItem({ title, text }: { title: string; text: string }) { return <article><ShieldCheck/><div><strong>{title}</strong><p>{text}</p></div></article>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><FileText/><strong>{title}</strong><p>{text}</p></div>; }
