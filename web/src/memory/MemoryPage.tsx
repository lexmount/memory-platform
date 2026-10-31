import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Brain, Info, KeyRound, LayoutGrid, LoaderCircle, Settings, Users } from "lucide-react";
import { AccountKeys } from "../AccountKeys";
import { MemoryFrame } from "../MemoryFrame";
import { Badge, Button, Input, Select } from "../ui/index";
import { emptyMemoryBridge, memoryRequest, type MemoryBridge, type MemoryProject, type MemoryProviderModule, type MemoryWorkspaceContext, type MemoryUserPage } from "./contracts";
import { memoryModuleRegistry, memoryProviderModules } from "./registry";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NativeWriteNotices } from "./NativeWrites";
import { memoryPath, memoryProjectSearch } from "./routes";
import { CreateProject, ProjectSettings, type IssuedSecret } from "./ProjectSettings";

type Load<T> = { key: string; value?: T; failed?: boolean };
function useMemoryLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<Load<T>>({ key }), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState({ key });
    void load(controller.signal).then(value => { if (!controller.signal.aborted) setState({ key, value }); }, () => {
      if (!controller.signal.aborted) setState({ key, failed: true });
    });
    return () => controller.abort();
  }, [key, load, revision]);
  return { ...(state.key === key ? state : { key }), retry: useCallback(() => setRevision(value => value + 1), []) };
}
function Status({ failed = false, retry }: { failed?: boolean; retry?(): void }) {
  const { t } = useTranslation();
  return <div className="memory-status" role={failed ? "alert" : "status"}>{failed ? <Info size={20} /> : <LoaderCircle size={20} />}<p>{t(failed ? "memoryProject.failed" : "memory.loading")}</p>
    {retry && <Button onClick={retry}>{t("memory.retry")}</Button>}</div>;
}
function UserPicker({ bridge, project, user, onSelect, list = false }: { bridge: MemoryBridge; project: MemoryProject; user: string; list?: boolean; onSelect(user: string): void }) {
  const { t } = useTranslation(), [cursor, setCursor] = useState(""), [search, setSearch] = useState("");
  const load = useCallback((signal: AbortSignal) => bridge.users(project.id, cursor, signal), [bridge, project.id, cursor]);
  const users = useMemoryLoad(`${project.id}:${cursor}`, load);
  const [all, setAll] = useState<MemoryUserPage["items"]>([]);
  useEffect(() => { if (users.value) setAll(previous => [...new Map([...previous, ...users.value!.items].map(item => [item.user_id, item])).values()]); }, [users.value]);
  const visible = all.filter(item => item.user_id.toLowerCase().includes(search.toLowerCase()));
  return <div className="memory-user-picker">
    {list && <div className="app-section-heading"><div><h2>{t("appFlow.users")}</h2><p>{t("appFlow.userIntro")}</p></div><Button onClick={() => { setCursor(""); users.retry(); }}>{t("appFlow.refresh")}</Button></div>}
    {!project.enabled && <p role="alert">{t("appFlow.disabledHint")}</p>}
    {all.length > 0 && list ? <><Input aria-label={t("appFlow.searchUsers")} placeholder={t("appFlow.searchUsers")} value={search} onChange={e => setSearch(e.target.value)} />
      <div className="app-user-list">{visible.map(item => <button type="button" className="app-user-row" key={item.user_id} disabled={!project.enabled} onClick={() => onSelect(item.user_id)}><Users size={18} /><strong>{item.user_id}</strong><Badge>{t(item.provisioned ? "appFlow.ready" : "appFlow.pending")}</Badge><span>{t("memoryProject.openUser")} <ArrowRight size={16} /></span></button>)}{!visible.length && <p className="app-empty">{t("appFlow.noMatches")}</p>}</div></> : all.length > 0 ? <Select label={t("memoryProject.knownUsers")} value={all.some(item => item.user_id === user) ? user : ""}
      options={[{ value: "", label: t("memoryProject.chooseUser") }, ...all.map(item => ({ value: item.user_id, label: item.user_id }))]}
      onChange={value => { if (value) onSelect(value); }} /> : users.value && !users.failed ? <div className="app-empty"><Users size={28} /><h3>{t("appFlow.emptyUsers")}</h3><p>{t("memoryProject.noUsers")}</p><Link className="app-action-link" to={memoryPath(project.provider, "access", new URLSearchParams({ project: project.id }).toString())}>{t("appFlow.goAccess")} <ArrowRight size={16} /></Link></div> : null}
    {!users.value && !users.failed && <p role="status">{t("memory.loading")}</p>}
    {users.failed && <div role="alert"><p>{t("memoryProject.failed")}</p><Button size="sm" onClick={users.retry}>{t("memory.retry")}</Button></div>}
    {users.value?.next_cursor && users.value.next_cursor !== cursor && <Button size="sm" onClick={() => setCursor(users.value!.next_cursor)}>{t("memory.more")}</Button>}
  </div>;
}
function providerName(id: string) { return id === "openviking" ? "OpenViking" : id === "hindsight" ? "Hindsight" : id; }
function ApplicationOverview({ project, bridge }: { project: MemoryProject; bridge: MemoryBridge }) {
  const { t } = useTranslation();
  const load = useCallback((signal: AbortSignal) => bridge.users(project.id, "", signal), [bridge, project.id]);
  const connected = useMemoryLoad(project.id, load);
  const hasUsers = Boolean(connected.value?.items.length);
  const target = (page: string) => memoryPath(project.provider, page, new URLSearchParams({ project: project.id }).toString());
  return <div className="app-overview"><div className="app-overview-summary"><div><h2>{providerName(project.provider)}</h2><p>{t(`appFlow.${project.provider}`, { defaultValue: project.provider })}</p></div><Badge tone={project.enabled ? "green" : "neutral"}>{t(project.enabled ? "memoryProject.enabled" : "memoryProject.disabled")}</Badge></div>
    <dl className="app-facts"><div><dt>{t("appFlow.created")}</dt><dd>{new Date(project.created_at).toLocaleDateString()}</dd></div><div><dt>App ID</dt><dd><code>{project.id}</code></dd></div></dl>
    {hasUsers && <div className="app-connected"><div><h2>{t("appFlow.connectedTitle")}</h2><p>{t("appFlow.connectedHint")}</p></div><Link className="app-action-link is-primary" to={target("users")}>{t("appFlow.users")} <ArrowRight size={16} /></Link></div>}
    <details className="app-onboarding-details" open={!hasUsers}><summary>{t(hasUsers ? "appFlow.integrationGuide" : "appFlow.next")}</summary><ol className="app-onboarding">{[["stepCredentials", "access", KeyRound], ["stepUser", "access", Users], ["stepExplore", "users", Brain]].map(([key, page, Icon], index) => { const Glyph = Icon as typeof Brain; return <li key={String(key)}><span className="app-step">{index + 1}</span><div><Link to={target(String(page))}><Glyph size={18} /><strong>{t(`appFlow.${key}`)}</strong><ArrowRight size={16} /></Link><p>{t(`appFlow.${key}Hint`)}</p></div></li>; })}</ol></details>
    <div className="app-project-actions"><Link className={`app-action-link ${hasUsers ? "" : "is-primary"}`} to={target("access")}>{t("appFlow.access")} <ArrowRight size={16} /></Link></div>
  </div>;
}
function useWorkspace(bridge: MemoryBridge, project: MemoryProject | undefined, user: string) {
  const identity = JSON.stringify([bridge.identity, project?.id, project?.enabled, user]);
  const resolve = useCallback((signal: AbortSignal) => project?.enabled && user ? bridge.resolveUser(project.id, user, signal) : Promise.resolve(undefined), [bridge, project, user]);
  const result = useMemoryLoad(identity, resolve);
  const [context, setContext] = useState<MemoryWorkspaceContext>();
  const valid = result.value && result.value.project_id === project?.id && result.value.user_id === user && result.value.provider.provider === project.provider;
  useEffect(() => {
    if (!valid || !project || !result.value) return;
    const controller = new AbortController(), resolved = result.value;
    setContext(Object.freeze({
      identity, project, user: Object.freeze({ ...resolved, mapping: Object.freeze({ ...resolved.mapping }) }), provider: resolved.provider, signal: controller.signal,
      schema: (operation: string, signal?: AbortSignal) => memoryRequest(controller.signal, signal, linked => bridge.schema(project.id, user, operation, linked)),
      invoke: (operation: string, input: Parameters<MemoryBridge["invoke"]>[3], signal?: AbortSignal, upload?: FormData) => memoryRequest(controller.signal, signal, linked => bridge.invoke(project.id, user, operation, input, linked, upload)),
    }));
    return () => controller.abort();
  }, [bridge, identity, project, result.value, user, valid]);
  return { context: valid && context?.identity === identity && !context.signal.aborted ? context : undefined, failed: result.failed || Boolean(result.value && !valid), retry: result.retry };
}
function MemoryHost({ bridge, formatTimeBucket, modules, accountID }: { bridge: MemoryBridge; formatTimeBucket?: MemoryBridge["formatTimeBucket"]; modules: readonly MemoryProviderModule[]; accountID?: string; }) {
  const { t } = useTranslation(), params = useParams(), location = useLocation(), navigate = useNavigate();
  const query = new URLSearchParams(location.search), projectID = query.get("project") ?? "", user = query.get("userid") ?? "";
  const accountPage = location.pathname === "/account/keys";
  const registry = useMemo(() => memoryModuleRegistry(modules), [modules]);
  const loadProjects = useCallback((signal: AbortSignal) => bridge.projects(signal), [bridge]);
  const list = useMemoryLoad(bridge.identity, loadProjects);
  const loadProviders = useCallback((signal: AbortSignal) => bridge.providers(signal), [bridge]);
  const providers = useMemoryLoad(bridge.identity, loadProviders);
  const project = list.value?.find(item => item.id === projectID), module = registry.get(project?.provider ?? "");
  const visibleProjects=list.value??[];
  const rememberKey = `memory:last-application:${bridge.identity}`;
  useEffect(()=>{if(project)try{localStorage.setItem(rememberKey,project.id)}catch{}},[project,rememberKey]);
  let remembered="";try{remembered=localStorage.getItem(rememberKey)||""}catch{}
  const defaultProject=visibleProjects.find(p=>p.id===remembered) ?? visibleProjects.find(p=>p.enabled&&!p.revoked) ?? visibleProjects[0];
  const page = params["*"] || "project", pageID = page.split("/")[0] ?? "project";
  const [issued, setIssued] = useState<IssuedSecret>();
  useEffect(() => { setIssued(previous => previous && previous.project === projectID && pageID === "access" ? previous : undefined); }, [projectID, pageID]);
  const active = project && params.provider === project.provider && !["project", "access", "users", "app-settings"].includes(pageID) ? project : undefined;
  const workspace = useWorkspace(bridge, active, user);
  const choose = (p: MemoryProject, nextUser = "", nextPage = "project") => {
    if (p.id !== projectID) setIssued(undefined);
    const search = new URLSearchParams({ project: p.id }); if (nextUser) search.set("userid", nextUser);
    navigate(memoryPath(p.provider, nextPage, search.toString()));
  };
  const navigation = (close: () => void) => <div className="platform-navigation">
    <div className="platform-nav-heading"><span>{t("sidebar.workspace")}</span></div>
    {project && <><div className="nav-group-label sidebar-section-label">{t("nativeUI.application")}</div><div className="nav-group">{[{id:"project",label:"overview",icon:LayoutGrid},{id:"access",label:"access",icon:KeyRound},{id:"users",label:"users",icon:Users},{id:"app-settings",label:"settings",icon:Settings}].map(({id,label,icon:Icon})=><Link key={id} title={t(`appFlow.${label}`)} className={`nav-item ${pageID===id?"is-active":""}`} aria-current={pageID===id?"page":undefined} to={memoryPath(project.provider,id,new URLSearchParams({project:project.id}).toString())} onClick={close}><Icon size={18}/><span>{t(`appFlow.${label}`)}</span></Link>)}</div>
    {active && user && module && <><div className="memory-context app-user-context"><div className="nav-group-label">{t("appFlow.native")}</div><UserPicker key={project.id} bridge={bridge} project={project} user={user} onSelect={value=>{choose(project,value,pageID);close()}}/></div><div className="nav-group workspace-navigation">{module.navigation.map(({id,labelKey,icon:Icon})=><Link key={id} title={t(labelKey)} className={`nav-item ${pageID===id?"is-active":""}`} aria-current={pageID===id?"page":undefined} to={memoryPath(module.id,id,pageID===id?location.search:memoryProjectSearch(location.search))} onClick={close}><Icon size={18}/><span>{t(labelKey)}</span></Link>)}</div></>}
    </>}
    <div className="sidebar-account"><Link className={`nav-item ${accountPage?"is-active":""}`} title={t("appFlow.accountSettings")} aria-current={accountPage?"page":undefined} to="/account/keys" onClick={close}><Settings size={18}/><span>{t("appFlow.accountSettings")}</span></Link></div>
  </div>;
  const content = () => {
    if (accountPage) return <AccountKeys accountID={accountID} embedded />;
    if (list.failed || providers.failed) return <Status failed retry={() => { list.retry(); providers.retry(); }} />;
    if (!list.value || !providers.value) return <Status />;
    if (!projectID) {
      if(query.get("view")!=="new" && defaultProject) return <Navigate replace to={memoryPath(defaultProject.provider,"project",new URLSearchParams({project:defaultProject.id}).toString())}/>;
      return <><p className="app-intro">{t("appFlow.intro")}</p><CreateProject bridge={bridge} providers={providers.value} onCreate={(p,secret)=>{list.retry();choose(p,"","access");setIssued({project:p.id,app_key:p.app_key,app_secret:secret})}}/></>;
    }
    if (!project || !module || params.provider !== project.provider) return <Status failed retry={list.retry} />;
    if (pageID === "project") return <ApplicationOverview key={project.id} project={project} bridge={bridge} />;
    if (pageID === "users") return <UserPicker key={project.id} list bridge={bridge} project={project} user={user} onSelect={value => choose(project, value, module.defaultPage)} />;
    if (["access", "app-settings"].includes(pageID)) return <ProjectSettings key={`${project.id}:${pageID}`} mode={pageID === "access" ? "access" : "settings"} bridge={bridge} project={project} issued={issued} clearSecret={() => setIssued(undefined)} onSecret={setIssued} reload={list.retry} />;
    if (!module.navigation.some(item => item.id === pageID)) return <Status failed />;
    if (!user) return <UserPicker key={project.id} list bridge={bridge} project={project} user={user} onSelect={value => choose(project, value, pageID)} />;
    if (!project.enabled || workspace.failed) return <Status failed retry={workspace.retry} />;
    if (!workspace.context) return <Status />;
    return <module.Workspace key={workspace.context.identity} context={workspace.context} page={page} formatTimeBucket={formatTimeBucket} />;
  };
  return <><WorkspaceSwitcher applications={visibleProjects} currentApplication={(project??defaultProject)?.id} onSelectApplication={choose} onCreateApplication={()=>navigate('/memory?view=new')}/><MemoryFrame navigationContent={navigation}>
    <section className={`memory-page ${active && user ? "is-native-workspace" : ""}`} data-provider={project?.provider}>
      {workspace.context && <NativeWriteNotices workspace={workspace.context.identity} />}
      {content()}
    </section>
  </MemoryFrame></>;
}
export function MemoryPage({ bridge = emptyMemoryBridge, modules = memoryProviderModules, accountID }: { accountID?: string; bridge?: MemoryBridge; modules?: readonly MemoryProviderModule[]; }) {
  const { identity, workspaces, createWorkspace, providers, projects, createProject, updateProject, rotateCredential, revokeCredential, users, resolveUser, schema, invoke } = bridge;
  const transport = useMemo(() => ({ identity, workspaces, createWorkspace, providers, projects, createProject, updateProject, rotateCredential, revokeCredential, users, resolveUser, schema, invoke }),
    [identity, workspaces, createWorkspace, providers, projects, createProject, updateProject, rotateCredential, revokeCredential, users, resolveUser, schema, invoke]);
  return <MemoryHost accountID={accountID} key={identity} bridge={transport} formatTimeBucket={bridge.formatTimeBucket} modules={modules} />;
}
