import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, ChevronRight, Check } from "lucide-react";
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
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const displayName = session.account.name || session.account.email;
  const closeMenu = () => { if (accountMenu.current) accountMenu.current.open = false; setLanguagesOpen(false); };
  useEffect(() => {
    const outside = (event: Event) => { if (accountMenu.current && !event.composedPath().includes(accountMenu.current)) closeMenu(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const switchLanguage = (language: string) => {
    const url = new URL(location.href); url.searchParams.set("lang", language);
    history.replaceState(history.state, "", url); void i18n.changeLanguage(language); closeMenu();
  };
  const header = <header className="memory-topbar"><div className="memory-brand"><Brain size={24} />Memory</div><span data-workspace-switcher />
    <div className="memory-account-actions"><details className="account-dropdown" ref={accountMenu} onToggle={()=>{if(!accountMenu.current?.open)setLanguagesOpen(false)}} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();closeMenu();accountMenu.current?.querySelector("summary")?.focus()}}}>
      <summary aria-label={t("accountMenu.open")} title={displayName}><span className="account-avatar">{Array.from(displayName || "M")[0]?.toUpperCase()}</span></summary>
      <div className="account-popover"><div className="account-profile"><span className="account-avatar account-avatar-large">{Array.from(displayName || "M")[0]?.toUpperCase()}</span><div><strong>{displayName}</strong>{session.account.email && session.account.email !== displayName && <small>{session.account.email}</small>}</div></div>
        <div className="account-menu-section"><button type="button" className="account-menu-item" aria-expanded={languagesOpen} onClick={()=>setLanguagesOpen(value=>!value)}><span>{t("accountMenu.language")}</span><ChevronRight size={18} className={languagesOpen?"is-open":""}/></button>
          {languagesOpen && <div className="account-language-options">{[{code:"zh",label:"简体中文"},{code:"en",label:"English"}].map(language=><button key={language.code} type="button" className="account-menu-item" aria-pressed={i18n.language===language.code} onClick={()=>switchLanguage(language.code)}><span>{language.label}</span>{i18n.language===language.code&&<Check size={16}/>}</button>)}</div>}
          <button type="button" className="account-menu-item" onClick={()=>{closeMenu();action(client.switchAccount)}}><span>{t("memoryAccount.switch")}</span><ChevronRight size={18}/></button>
        </div><div className="account-menu-section account-menu-signout"><button type="button" className="account-menu-item" onClick={()=>{closeMenu();action(client.logout)}}>{t("accountMenu.logout")}</button></div>
      </div></details>
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
