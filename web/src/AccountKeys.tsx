import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Input } from "./ui/index";
import { MemoryFrame } from "./MemoryFrame";

type APIKey = { id: string; name: string; prefix: string; created_at: string; revoked_at: string | null };
export function AccountKeys({ accountID, embedded = false }: { accountID?: string; embedded?: boolean }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<APIKey[]>(), [name, setName] = useState(""), [issued, setIssued] = useState<{ key: string; secret: string }>(), [error, setError] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError(false);
    void fetch("/v1/account/keys", { signal: abort.signal, cache: "no-store", headers: accountID ? { "X-Memory-Account": accountID } : {} }).then(async r => {
      if (!r.ok) throw new Error(); const data = await r.json(); if (!abort.signal.aborted) setKeys(data.keys);
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [revision, accountID]);
  const change = async (id?: string) => {
    setBusy(true); setError(false);
    try {
      const r = await fetch(`/v1/account/keys${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "DELETE" : "POST", headers: { "Content-Type": "application/json", ...(accountID ? { "X-Memory-Account": accountID } : {}) }, body: id ? undefined : JSON.stringify({ name }) });
      if (!r.ok) throw new Error();
      if (!id) { const created = await r.json(); setIssued({ key: created.key.id, secret: created.secret }); setName(""); }
      else setIssued(previous => previous?.key === id ? undefined : previous);
      setRevision(v => v + 1);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const content = <>
    <section className="memory-page memory-account"><h1>{t("memoryAccount.keys")}</h1><p>{t("memoryAccount.keyHint")}</p>
      <form onSubmit={e => { e.preventDefault(); void change(); }}><label>{t("memoryAccount.keyName")}<Input aria-label={t("memoryAccount.keyName")} value={name} onChange={e => setName(e.target.value)} maxLength={100} required /></label><Button type="submit" disabled={busy || !name.trim()}>{t("memoryAccount.createKey")}</Button></form>
      {issued && <div className="memory-secret" role="status"><p>{t("memoryAccount.secretOnce")}</p><code>{issued.secret}</code><Button onClick={() => setIssued(undefined)}>{t("memoryAccount.dismiss")}</Button></div>}
      {error && <p role="alert">{t("memoryProject.failed")} <Button onClick={() => setRevision(v => v + 1)}>{t("memory.retry")}</Button></p>}
      {!keys && !error && <p role="status">{t("memory.loading")}</p>}
      <div className="memory-account-keys">{keys?.map(key => <article key={key.id}><div><strong>{key.name}</strong><code>{key.prefix}…</code><span>{new Date(key.created_at).toLocaleDateString()}</span></div>
        {key.revoked_at ? <span>{t("memoryAccount.revoked")}</span> : <Button disabled={busy} onClick={() => void change(key.id)}>{t("memoryAccount.revoke")}</Button>}
      </article>)}</div>
    </section>
  </>;
  return embedded ? content : <MemoryFrame navigationContent={() => <Link className="nav-item" to="/memory">{t("memoryProject.projects")}</Link>}>{content}</MemoryFrame>;
}
