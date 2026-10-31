import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Field, Input, Modal, SectionHeader, Select } from "../ui/index";
import type { MemoryBridge, MemoryProject, MemoryProvider } from "./contracts";

export type IssuedSecret = { project: string; app_key: string; app_secret: string };
function useLifetime() {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); ref.current = controller; return () => controller.abort(); }, []);
  return ref;
}
export function CreateProject({ bridge, providers, onCreate }: {
  bridge: MemoryBridge; providers: readonly MemoryProvider[]; onCreate(project: MemoryProject, secret: string): void;
}) {
  const { t } = useTranslation(), lifetime = useLifetime();
  const [name, setName] = useState(""), [provider, setProvider] = useState(providers[0]?.provider ?? "");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  return <Card className="memory-project-card"><SectionHeader title={t("memoryProject.newProject")} description={t("memoryProject.projectDescription")} />
    <form onSubmit={event => {
      event.preventDefault(); const signal = lifetime.current?.signal; if (!signal || signal.aborted || busy) return;
      setBusy(true); setFailed(false);
      void bridge.createProject(name, provider, signal).then(result => {
        if (!signal.aborted) onCreate(result.project, result.app_secret);
      }, () => { if (!signal.aborted) setFailed(true); }).finally(() => { if (!signal.aborted) setBusy(false); });
    }}>
      <Field label={t("memoryProject.projectName")}><Input aria-label={t("memoryProject.projectName")} value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy} /></Field>
      <Field label={t("memory.provider")}><Select label={t("memory.provider")} value={provider} onChange={setProvider} options={providers.map(item => ({ value: item.provider, label: item.provider }))} /></Field>
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
  const [name, setName] = useState(project.name), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
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
  return <div className="memory-project-settings">
    <SectionHeader title={t("memoryProject.settings")} description={t("memoryProject.providerFixed")} />
    <Card><form onSubmit={event => { event.preventDefault(); run(signal => bridge.updateProject(project.id, { name }, signal)); }}>
      <Field label={t("memoryProject.projectName")}><Input aria-label={t("memoryProject.projectName")} value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy} /></Field>
      <p>{project.provider} <Badge>{t(project.enabled ? "memoryProject.enabled" : "memoryProject.disabled")}</Badge></p>
      <div className="memory-project-actions"><Button type="submit" disabled={busy || !name.trim()}>{t("memoryProject.save")}</Button>
        <Button type="button" variant="text" disabled={busy} onClick={() => run(signal => bridge.updateProject(project.id, { enabled: !project.enabled }, signal))}>{t(project.enabled ? "memoryProject.disable" : "memoryProject.enable")}</Button></div>
    </form></Card>
    <Card><h3>{t("memoryProject.credentials")}</h3><p><Badge>{t(project.revoked ? "memoryProject.revokedCredential" : "memoryProject.activeCredential")}</Badge></p>
      <Field label="App Key"><Input readOnly value={project.app_key} aria-label="App Key" /></Field>
      {issued?.project === project.id && <div className="memory-issued-secret" role="status"><p>{t("memoryProject.secretOnce")}</p>
        <Field label="App Secret"><Input readOnly value={issued.app_secret} aria-label="App Secret" autoComplete="off" /></Field>
        <Button onClick={clearSecret}>{t("memoryProject.savedSecret")}</Button>
      </div>}
      <div className="memory-project-actions"><Button disabled={busy} onClick={() => setAction("rotate")}>{t("memoryProject.rotate")}</Button>
        <Button variant="danger" disabled={busy || project.revoked} onClick={() => setAction("revoke")}>{t("memoryProject.revoke")}</Button></div>
    </Card>
    <Card><h3>{t("memoryProject.integration")}</h3><p>{t("memoryProject.integrationHint")}</p>
      <pre>{JSON.stringify({ mcpServers: { memory: { url: `${origin}/mcp/memory`, headers } } }, null, 2)}</pre>
      <p>HTTP: <code>{origin}/v1/memory/native</code></p><p>{t("memoryProject.identityHint")}</p>
      <pre>{`curl -X POST '${origin}/v1/memory/identity' \\\n  -H 'X-App-Key: ${project.app_key}' \\\n  -H 'X-App-Secret: YOUR_APP_SECRET' \\\n  -H 'X-User-Id: your-user-id'`}</pre>
    </Card>
    {failed && <p role="alert">{t("memoryProject.failed")}</p>}
    {action && <Modal open title={t(action === "rotate" ? "memoryProject.confirmRotate" : "memoryProject.confirmRevoke")} onClose={() => { if (!busy) setAction(undefined); }}
      footer={<><Button disabled={busy} onClick={() => setAction(undefined)}>{t("memoryProject.cancel")}</Button><Button variant="danger" disabled={busy} onClick={() => run(async signal => {
        if (action === "revoke") { await bridge.revokeCredential(project.id, signal); if (!signal.aborted) clearSecret(); }
        else { const result = await bridge.rotateCredential(project.id, signal); if (!signal.aborted) onSecret({ project: project.id, ...result }); }
      })}>{t(busy ? "memoryProject.working" : "memoryProject.confirm")}</Button></>}><p>{t("memoryProject.integrationHint")}</p></Modal>}
  </div>;
}
