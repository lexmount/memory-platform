import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Field, Input, Modal, SectionHeader } from "../ui/index";
import type { MemoryBridge, MemoryProject, MemoryProvider } from "./contracts";

export type IssuedSecret = { project: string; app_key: string; app_secret: string };
function useLifetime() {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); ref.current = controller; return () => controller.abort(); }, []);
  return ref;
}
export function CreateProject({ bridge, providers, onCreate, workspaceID }: {
  bridge: MemoryBridge; workspaceID?:string; providers: readonly MemoryProvider[]; onCreate(project: MemoryProject, secret: string): void;
}) {
  const { t } = useTranslation(), lifetime = useLifetime();
  const [name, setName] = useState(""), [provider, setProvider] = useState(providers.find(item => item.provider === "hindsight")?.provider ?? providers[0]?.provider ?? "");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  return <Card className="memory-project-card"><SectionHeader title={t("memoryProject.newProject")} description={t("memoryProject.projectDescription")} />
    <form onSubmit={event => {
      event.preventDefault(); const signal = lifetime.current?.signal; if (!signal || signal.aborted || busy) return;
      setBusy(true); setFailed(false);
      void bridge.createProject(name.trim(), provider, signal, workspaceID).then(result => {
        if (!signal.aborted) onCreate(result.project, result.app_secret);
      }, () => { if (!signal.aborted) setFailed(true); }).finally(() => { if (!signal.aborted) setBusy(false); });
    }}>
      <Field label={t("memoryProject.projectName")}><Input aria-label={t("memoryProject.projectName")} value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy} /></Field>
      <fieldset className="app-provider-options" disabled={busy}><legend>{t("memory.provider")}</legend>{providers.map(item => <label key={item.provider} className={provider === item.provider ? "is-selected" : ""}><input type="radio" name="provider" value={item.provider} checked={provider === item.provider} onChange={() => setProvider(item.provider)} /><span><strong>{item.provider === "openviking" ? "OpenViking" : item.provider === "hindsight" ? "Hindsight" : item.provider}</strong><small>{t(`appFlow.${item.provider}`, { defaultValue: item.provider })}</small></span></label>)}</fieldset>
      {!providers.length && <p>{t("memoryProject.noProviders")}</p>}
      {failed && <p role="alert">{t("memoryProject.failed")}</p>}
      <Button type="submit" variant="primary" disabled={busy || !name.trim() || !provider}>{t(busy ? "memoryProject.working" : "memoryProject.create")}</Button>
    </form>
  </Card>;
}

export function ProjectSettings({ bridge, project, issued, clearSecret, onSecret, reload }: {
  bridge: MemoryBridge; project: MemoryProject; issued?: IssuedSecret; clearSecret(): void;
  onSecret(value: IssuedSecret): void; reload(): void;
}) {
  const { t } = useTranslation(), lifetime = useLifetime();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [action, setAction] = useState<"rotate" | "revoke">();
  const run = (call: (signal: AbortSignal) => Promise<unknown>) => {
    const signal = lifetime.current?.signal; if (!signal || signal.aborted || busy) return;
    setBusy(true); setFailed(false);
    void call(signal).then(() => { if (!signal.aborted) { setAction(undefined); reload(); } }, () => {
      if (!signal.aborted) setFailed(true);
    }).finally(() => { if (!signal.aborted) setBusy(false); });
  };
  const origin = window.location.origin;
  const headers = { "X-App-Key": project.app_key, "X-App-Secret": "YOUR_APP_SECRET", "X-User-Id": "your-user-id" };
  const firstRequest = `curl -X POST '${origin}/v1/memory/identity' \\\n  -H 'X-App-Key: ${project.app_key}' \\\n  -H 'X-App-Secret: YOUR_APP_SECRET' \\\n  -H 'X-User-Id: your-user-id'`;
  return <div className="memory-project-settings">
    <><SectionHeader title={t("appFlow.access")} description={t("appFlow.credentialsHint")} />
    {(!project.enabled || project.revoked) && <p role="alert">{t("appFlow.credentialWarning")}</p>}
    <Card><h3>{t("memoryProject.credentials")}</h3><p><Badge>{t(project.revoked ? "memoryProject.revokedCredential" : "memoryProject.activeCredential")}</Badge></p>
      <Field label="App Key"><Input readOnly value={project.app_key} aria-label="App Key" /></Field><CopyValue value={project.app_key} />
      {!issued && <p className="app-muted">{t("appFlow.secretHidden")}</p>}
      {issued?.project === project.id && <div className="memory-issued-secret" role="status"><p>{t("memoryProject.secretOnce")}</p>
        <Field label="App Secret"><Input readOnly value={issued.app_secret} aria-label="App Secret" autoComplete="off" /></Field>
        <CopyValue value={issued.app_secret} /><Button onClick={clearSecret}>{t("memoryProject.savedSecret")}</Button>
      </div>}
      <div className="memory-project-actions"><Button disabled={busy} onClick={() => setAction("rotate")}>{t("memoryProject.rotate")}</Button>
        <Button variant="danger" disabled={busy || project.revoked} onClick={() => setAction("revoke")}>{t("memoryProject.revoke")}</Button></div>
    </Card>
    <Card><h3>{t("appFlow.firstRequest")}</h3><p>{t("appFlow.firstRequestHint")}</p><CodeExample value={firstRequest} /><p>{t("memoryProject.integrationHint")}</p></Card>
    <Card><details><summary>{t("appFlow.mcp")}</summary><CodeExample value={JSON.stringify({ mcpServers: { memory: { url: `${origin}/mcp/memory`, headers } } }, null, 2)} /><p>HTTP: <code>{origin}/v1/memory/native</code></p><p>{t("memoryProject.identityHint")}</p></details></Card></>
    {failed && <p role="alert">{t("memoryProject.failed")}</p>}
    {action && <Modal open title={t(action === "rotate" ? "memoryProject.confirmRotate" : "memoryProject.confirmRevoke")} onClose={() => { if (!busy) setAction(undefined); }}
      footer={<><Button disabled={busy} onClick={() => setAction(undefined)}>{t("memoryProject.cancel")}</Button><Button variant="danger" disabled={busy} onClick={() => run(async signal => {
        if (action === "revoke") { await bridge.revokeCredential(project.id, signal); if (!signal.aborted) clearSecret(); }
        else { const result = await bridge.rotateCredential(project.id, signal); if (!signal.aborted) onSecret({ project: project.id, ...result }); }
      })}>{t(busy ? "memoryProject.working" : "memoryProject.confirm")}</Button></>}><p>{t("memoryProject.integrationHint")}</p></Modal>}
  </div>;
}

function CopyValue({ value }: { value: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"copy" | "copied" | "copyFailed">("copy");
  useEffect(() => { if (status === "copy") return; const timer = setTimeout(() => setStatus("copy"), 2500); return () => clearTimeout(timer); }, [status]);
  return <span className="app-copy"><Button size="sm" onClick={() => { void navigator.clipboard.writeText(value).then(() => setStatus("copied"), () => setStatus("copyFailed")); }}>{t(`appFlow.${status === "copyFailed" ? "copy" : status}`)}</Button>{status === "copyFailed" && <small role="alert">{t("appFlow.copyFailed")}</small>}</span>;
}
function CodeExample({ value }: { value: string }) { return <div className="app-code"><pre>{value}</pre><CopyValue value={value} /></div>; }
