import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, FileCheck2, LockKeyhole, ShieldCheck } from "lucide-react";
import App from "./App";
import { createLiveClient, inviteLiveUser, loadLiveState, loadRuntimeConfig, persistLiveDelta, saveLiveStorageCredential, testLiveStorage, uploadLiveDocument, type RuntimeConfig } from "./live";
import type { State } from "./domain";

export default function Root() {
  const [config, setConfig] = useState<RuntimeConfig | null | undefined>(undefined);
  useEffect(() => { void loadRuntimeConfig().then((value) => { sessionStorage.setItem("portal-runtime-mode", value ? "live" : "demo"); setConfig(value); }); }, []);
  if (config === undefined) return <div className="loading"><FileCheck2/><h2>Se inițializează portalul…</h2></div>;
  if (!config) return <App />;
  return <LiveRoot config={config}/>;
}

function LiveRoot({ config }: { config: RuntimeConfig }) {
  const client = useMemo(() => createLiveClient(config), [config]);
  const [sessionReady, setSessionReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [mfa, setMfa] = useState<{ mode: "challenge" | "enroll"; factorId: string; qr?: string } | null>(null);
  const [mustSetPassword, setMustSetPassword] = useState(false);

  const refresh = async (firm?: string | null) => {
    setError("");
    try { setState(await loadLiveState(client, firm)); }
    catch (reason) { setError((reason as Error).message); }
  };
  const secureSession = async () => {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (userData.user?.user_metadata?.must_set_password === true) {
      setMustSetPassword(true);
      setMfa(null);
      return;
    }
    setMustSetPassword(false);
    const { data: level, error: levelError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (levelError) throw levelError;
    if (level.currentLevel === "aal2") { setMfa(null); await refresh(); return; }
    const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = factors.totp.find((factor) => factor.status === "verified");
    if (verified) { setMfa({ mode: "challenge", factorId: verified.id }); return; }
    const pending = factors.all.find((factor) => factor.factor_type === "totp" && factor.status !== "verified");
    if (pending) { await client.auth.mfa.unenroll({ factorId: pending.id }); }
    const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Portal Documente" });
    if (enrollError) throw enrollError;
    setMfa({ mode: "enroll", factorId: enrolled.id, qr: enrolled.totp.qr_code });
  };
  useEffect(() => {
    void client.auth.getSession().then(({ data }) => { setSignedIn(!!data.session); setSessionReady(true); if (data.session) void secureSession().catch((reason) => setError((reason as Error).message)); });
    const { data } = client.auth.onAuthStateChange((event, session) => { setSignedIn(!!session); if (session && event === "SIGNED_IN") void secureSession().catch((reason) => setError((reason as Error).message)); else if (!session) { setState(null); setMfa(null); } });
    return () => data.subscription.unsubscribe();
  }, [client]);
  if (!sessionReady) return <div className="loading"><ShieldCheck/><h2>Se verifică sesiunea securizată…</h2></div>;
  if (!signedIn) return <Login client={client} error={error} setError={setError}/>;
  if (mustSetPassword) return <SetPasswordGate client={client} error={error} setError={setError} completed={() => void secureSession().catch((reason) => setError((reason as Error).message))}/>;
  if (mfa) return <MfaGate client={client} factor={mfa} error={error} setError={setError} verified={() => void secureSession().catch((reason) => setError((reason as Error).message))}/>;
  if (!state) return <div className="loading"><ShieldCheck/><h2>{error || "Se încarcă spațiul de audit…"}</h2>{error && <button className="secondary" onClick={() => void refresh()}>Reîncearcă</button>}</div>;
  return <App initialState={state} live persist={(before, after) => persistLiveDelta(client, before, after)} reload={(firm) => loadLiveState(client, firm)} uploadLive={(requestId, file, description, period) => uploadLiveDocument(client, requestId, file, description, period)} testStorage={(auditFirmId, provider, configuration) => testLiveStorage(client, auditFirmId, provider, configuration)} saveStorageCredential={(auditFirmId, tenantId, refreshToken) => saveLiveStorageCredential(client, auditFirmId, tenantId, refreshToken)} inviteLive={(auditFirmId, name, email, role) => inviteLiveUser(client, auditFirmId, name, email, role)} logout={() => client.auth.signOut()}/>;
}

function SetPasswordGate({ client, error, setError, completed }: { client: ReturnType<typeof createLiveClient>; error: string; setError: (value: string) => void; completed: () => void }) {
  const [busy, setBusy] = useState(false);
  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password.length < 12) setError("Parola trebuie să conțină minimum 12 caractere.");
    else if (password !== confirmation) setError("Parolele introduse nu coincid.");
    else {
      const { data: userData } = await client.auth.getUser();
      const { error: updateError } = await client.auth.updateUser({ password, data: { ...(userData.user?.user_metadata ?? {}), must_set_password: false } });
      if (updateError) setError(updateError.message); else completed();
    }
    setBusy(false);
  }
  return <div className="mfa-page"><section className="mfa-card"><span className="brand-icon"><LockKeyhole/></span><div className="eyebrow">PRIMA AUTENTIFICARE</div><h1>Configurează parola</h1><p>Alege o parolă nouă pentru accesările viitoare ale portalului.</p><form onSubmit={savePassword}><label>Parolă nouă<input name="password" type="password" minLength={12} autoComplete="new-password" required/></label><label>Confirmă parola<input name="confirmation" type="password" minLength={12} autoComplete="new-password" required/></label><button className="primary" disabled={busy}>{busy ? "Se salvează…" : "Salvează și continuă"}</button></form>{error && <div className="error-box">{error}</div>}</section></div>;
}

function MfaGate({ client, factor, error, setError, verified }: { client: ReturnType<typeof createLiveClient>; factor: { mode: "challenge" | "enroll"; factorId: string; qr?: string }; error: string; setError: (value: string) => void; verified: () => void }) {
  const [busy, setBusy] = useState(false);
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.factorId, code });
    if (error) setError("Codul de autentificare nu este valid."); else verified();
    setBusy(false);
  }
  return <div className="mfa-page"><section className="mfa-card"><span className="brand-icon"><ShieldCheck/></span><div className="eyebrow">AUTENTIFICARE MULTIFACTOR</div><h1>{factor.mode === "enroll" ? "Protejează contul" : "Confirmă autentificarea"}</h1>{factor.mode === "enroll" ? <><p>Scanează codul QR cu Microsoft Authenticator, Google Authenticator sau o aplicație TOTP compatibilă.</p>{factor.qr && <img src={factor.qr} alt="Cod QR pentru activarea MFA"/>}</> : <p>Introdu codul de șase cifre din aplicația de autentificare.</p>}<form onSubmit={verify}><label>Cod de verificare<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000"/></label><button className="primary" disabled={busy}>{busy ? "Se verifică…" : "Continuă"}</button></form>{error && <div className="error-box">{error}</div>}<button className="text-button" onClick={() => void client.auth.signOut()}>Deconectare</button></section></div>;
}

function Login({ client, error, setError }: { client: ReturnType<typeof createLiveClient>; error: string; setError: (value: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const { error } = await client.auth.signInWithPassword({ email: String(data.get("email")), password: String(data.get("password")) });
    if (error) setError("Autentificarea nu a reușit. Verifică emailul și parola.");
    setBusy(false);
  }
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const { error } = await client.auth.resetPasswordForEmail(String(data.get("reset_email")), { redirectTo: `${location.origin}/` });
    if (error) setError(error.message); else setResetSent(true);
    setBusy(false);
  }
  return <div className="login">
    <section className="login-story"><div className="brand"><span className="brand-icon"><FileCheck2/></span><b>Portal<span>Documente</span></b></div><div><div className="eyebrow">CELENTIS AUDIT · SPAȚIU SECURIZAT</div><h1>Cerințe clare.<br/>Documente sub control.</h1><p>Răspundeți solicitărilor de audit într-un singur loc, fără să căutați foldere sau să urmăriți versiuni prin email.</p><div className="login-steps"><span>01 / Cerință</span><span>02 / Document</span><span>03 / Revizuire</span></div></div><small>Acces protejat · activitate jurnalizată</small></section>
    <section className="login-panel"><div><div className="eyebrow">BUN VENIT</div><h2>Intră în portalul de audit</h2><p className="muted">Folosește contul primit de la echipa de audit.</p><form onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Parolă<input name="password" type="password" autoComplete="current-password" required/></label><button className="primary" disabled={busy}>{busy ? "Se verifică…" : "Autentificare"}<ArrowRight/></button></form>{error && <div className="error-box">{error}</div>}<details><summary>Am uitat parola</summary>{resetSent ? <div className="notice"><LockKeyhole/>Dacă adresa există, vei primi instrucțiunile de resetare.</div> : <form onSubmit={resetPassword}><label>Email<input name="reset_email" type="email" required/></label><button className="secondary" disabled={busy}>Trimite linkul de resetare</button></form>}</details></div></section>
  </div>;
}
