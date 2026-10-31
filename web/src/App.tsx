import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Brain, Languages } from "lucide-react";
import { Button } from "./ui/index";
import i18n from "./i18n/index";
import MemoryConsole, { MemorySurface } from "./MemoryConsole";
import { createServerClient } from "./identity-client";
import { useMemoryBridge } from "./bridge";

type Session = { account: { id: string; name: string; email: string }; expires: number };
type Client = ReturnType<typeof createServerClient>;
function SignedIn({ session, client, error, action }: { session: Session; client: Client; error: boolean; action: (fn: () => Promise<unknown>) => void }) {
  const { t } = useTranslation(undefined, { i18n });
  const bridge = useMemoryBridge(`${session.account.id}:${session.expires}`, session.account.id);
  const switchLanguage = () => {
    const language = i18n.language === "zh" ? "en" : "zh";
    const url = new URL(location.href); url.searchParams.set("lang", language);
    history.replaceState(history.state, "", url); void i18n.changeLanguage(language);
  };
  const header = <header className="memory-topbar"><Link className="memory-brand" to="/memory"><Brain size={24} />Memory</Link>
    <nav><Link to="/memory">{t("memoryProject.projects")}</Link><Link to="/account/keys">{t("memoryAccount.keys")}</Link></nav>
    <div className="memory-account-actions"><span>{session.account.name || session.account.email}</span>
      <Button variant="text" aria-label={t("header.language")} onClick={switchLanguage}><Languages size={18} /></Button>
      <Button variant="text" onClick={() => action(client.switchAccount)}>{t("memoryAccount.switch")}</Button><Button variant="text" onClick={() => action(client.logout)}>{t("memoryAccount.logout")}</Button>
    </div>{error && <span role="alert">{t("memoryAccount.failed")}</span>}</header>;
  return <MemoryConsole memory={bridge} header={header} accountID={session.account.id} />;
}
export default function App() {
  const { t } = useTranslation(undefined, { i18n });
  const [session, setSession] = useState<Session | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(false);
  const client = useRef<Client | null>(null);
  useEffect(() => { document.documentElement.lang = i18n.language === "zh" ? "zh-CN" : "en"; }, [t]);
  useEffect(() => {
    let active = true; const auth = createServerClient(); client.current = auth;
    auth.onChange(value => { if (active) { setSession(value as Session | null); setReady(true); setError(false); } });
    auth.onError(() => { if (active) setError(true); });
    void auth.getSession().then(value => { if (active && !value) return auth.autoLogin(); }).catch(() => { if (active) { setError(true); setReady(true); } });
    return () => { active = false; auth.dispose(); client.current = null; };
  }, []);
  const action = (fn: () => Promise<unknown>) => { setError(false); void fn().catch(() => setError(true)); };
  if (session && client.current) return <SignedIn key={`${session.account.id}:${session.expires}`} session={session} client={client.current} error={error} action={action} />;
  return <MemorySurface><main className="memory-login"><Brain size={36} /><h1>Memory</h1><p>{t("memoryAccount.intro")}</p>
    {ready ? <Button onClick={() => { if (client.current) action(client.current.login); }}>{t("memoryAccount.login")}</Button> : <p role="status">{t("memory.loading")}</p>}
    {error && <p role="alert">{t("memoryAccount.failed")}</p>}
  </main></MemorySurface>;
}
