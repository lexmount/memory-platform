import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Brain, Info, LoaderCircle, Settings } from "lucide-react";
import { MemoryFrame } from "../MemoryFrame";
import { Button, Select } from "../ui/index";
import { emptyMemoryBridge, memoryRequest, type MemoryBridge, type MemoryProject, type MemoryProviderModule, type MemoryWorkspaceContext, type MemoryUserPage } from "./contracts";
import { memoryModuleRegistry, memoryProviderModules } from "./registry";
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
  const { t } = useTranslation(), [cursor, setCursor] = useState("");
  const load = useCallback((signal: AbortSignal) => bridge.users(project.id, cursor, signal), [bridge, project.id, cursor]);
  const users = useMemoryLoad(`${project.id}:${cursor}`, load);
  const [all, setAll] = useState<MemoryUserPage["items"]>([]);
  useEffect(() => { if (users.value) setAll(previous => [...new Map([...previous, ...users.value!.items].map(item => [item.user_id, item])).values()]); }, [users.value]);
  return <div className="memory-user-picker">
    {all.length > 0 && list ? <div className="memory-project-users"><h3>{t("memoryProject.knownUsers")}</h3>{all.map(item => <Button key={item.user_id} variant="text" onClick={() => onSelect(item.user_id)}>{item.user_id}</Button>)}</div> : all.length > 0 ? <Select label={t("memoryProject.knownUsers")} value={all.some(item => item.user_id === user) ? user : ""}
      options={[{ value: "", label: t("memoryProject.chooseUser") }, ...all.map(item => ({ value: item.user_id, label: item.user_id }))]}
      onChange={value => { if (value) onSelect(value); }} /> : <p>{t("memoryProject.noUsers")}</p>}
    {users.failed && <Button size="sm" onClick={users.retry}>{t("memory.retry")}</Button>}
    {users.value?.next_cursor && users.value.next_cursor !== cursor && <Button size="sm" onClick={() => setCursor(users.value!.next_cursor)}>{t("memory.more")}</Button>}
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
function MemoryHost({ bridge, formatTimeBucket, modules }: { bridge: MemoryBridge; formatTimeBucket?: MemoryBridge["formatTimeBucket"]; modules: readonly MemoryProviderModule[]; }) {
  const { t } = useTranslation(), params = useParams(), location = useLocation(), navigate = useNavigate();
  const query = new URLSearchParams(location.search), projectID = query.get("project") ?? "", user = query.get("userid") ?? "";
  const registry = useMemo(() => memoryModuleRegistry(modules), [modules]);
  const loadProjects = useCallback((signal: AbortSignal) => bridge.projects(signal), [bridge]);
  const list = useMemoryLoad(bridge.identity, loadProjects);
  const loadProviders = useCallback((signal: AbortSignal) => bridge.providers(signal), [bridge]);
  const providers = useMemoryLoad(bridge.identity, loadProviders);
  const project = list.value?.find(item => item.id === projectID), module = registry.get(project?.provider ?? "");
  const page = params["*"] || "project", pageID = page.split("/")[0];
  const [issued, setIssued] = useState<IssuedSecret>();
  useEffect(() => { setIssued(previous => previous && previous.project === projectID && pageID === "project" ? previous : undefined); }, [projectID, pageID]);
  const active = project && params.provider === project.provider && pageID !== "project" ? project : undefined;
  const workspace = useWorkspace(bridge, active, user);
  const choose = (p: MemoryProject, nextUser = "", nextPage = "project") => {
    if (p.id !== projectID) setIssued(undefined);
    const search = new URLSearchParams({ project: p.id }); if (nextUser) search.set("userid", nextUser);
    navigate(memoryPath(p.provider, nextPage, search.toString()));
  };
  const navigation = (close: () => void) => <>
    <div className="memory-context"><Select label={t("memoryProject.project")} value={project?.id ?? ""}
      options={[{ value: "", label: t("memoryProject.chooseProject") }, ...(list.value ?? []).map(p => ({ value: p.id, label: p.name }))]}
      onChange={value => { const p = list.value?.find(item => item.id === value); if (p) choose(p); else { setIssued(undefined); navigate(memoryPath()); } close(); }} />
      <Button variant="text" size="sm" onClick={() => { setIssued(undefined); navigate(memoryPath()); close(); }}>{t("memoryProject.newProject")}</Button>
      {project && pageID !== "project" && <><p>{project.provider}</p><UserPicker key={project.id} bridge={bridge} project={project} user={user} onSelect={value => { choose(project, value, module?.defaultPage); close(); }} /></>}
      {workspace.context && <details className="memory-connection"><summary>{t("memory.connectionDetails")}</summary><dl>
        {Object.entries(workspace.context.user.mapping).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
      </dl></details>}
    </div>
    <div className="nav-group"><div className="nav-group-label">{t("memory.title")}</div>
      {project && module ? <>
        <Link className={`nav-item ${pageID === "project" ? "is-active" : ""}`} to={memoryPath(module.id, "project", memoryProjectSearch(location.search))} onClick={close}><Settings size={18} /><span>{t("memoryProject.settings")}</span></Link>
        {module.navigation.map(({ id, labelKey, icon: Icon }) => <Link key={id} className={`nav-item ${pageID === id ? "is-active" : ""}`} aria-current={pageID === id ? "page" : undefined}
          to={memoryPath(module.id, id, pageID === id ? location.search : memoryProjectSearch(location.search))} onClick={close}><Icon size={18} /><span>{t(labelKey)}</span></Link>)}
      </> : <Link className="nav-item is-active" to={memoryPath()} onClick={close}><Brain size={18} /><span>{t("memoryProject.projects")}</span></Link>}
    </div>
  </>;
  const content = () => {
    if (list.failed || providers.failed) return <Status failed retry={() => { list.retry(); providers.retry(); }} />;
    if (!list.value || !providers.value) return <Status />;
    if (!projectID) return <><div className="memory-project-list">{list.value.map(p => <Button key={p.id} variant="text" onClick={() => choose(p)}>{p.name} · {p.provider}</Button>)}</div><CreateProject bridge={bridge} providers={providers.value} onCreate={(p, secret) => { list.retry(); choose(p); setIssued({ project: p.id, app_key: p.app_key, app_secret: secret }); }} /></>;
    if (!project || !module || params.provider !== project.provider) return <Status failed retry={list.retry} />;
    if (pageID === "project") return <><UserPicker key={project.id} list bridge={bridge} project={project} user={user} onSelect={value => choose(project, value, module.defaultPage)} /><ProjectSettings key={project.id} bridge={bridge} project={project} issued={issued} clearSecret={() => setIssued(undefined)} onSecret={setIssued} reload={list.retry} /></>;
    if (!module.navigation.some(item => item.id === pageID)) return <Status failed />;
    if (!user) return <p className="memory-status">{t("memoryProject.userHint")}</p>;
    if (!project.enabled || workspace.failed) return <Status failed retry={workspace.retry} />;
    if (!workspace.context) return <Status />;
    return <module.Workspace key={workspace.context.identity} context={workspace.context} page={page} formatTimeBucket={formatTimeBucket} />;
  };
  return <MemoryFrame navigationContent={navigation}>
    <section className="memory-page" data-provider={project?.provider}>
      <header className="memory-heading"><h1>{project?.name ?? t("memoryProject.projects")}</h1>{project && user && <p>userid: <strong>{user}</strong></p>}</header>
      {workspace.context && <NativeWriteNotices workspace={workspace.context.identity} />}
      {content()}
    </section>
  </MemoryFrame>;
}
export function MemoryPage({ bridge = emptyMemoryBridge, modules = memoryProviderModules }: { bridge?: MemoryBridge; modules?: readonly MemoryProviderModule[]; }) {
  const { identity, providers, projects, createProject, updateProject, rotateCredential, revokeCredential, users, resolveUser, schema, invoke } = bridge;
  const transport = useMemo(() => ({ identity, providers, projects, createProject, updateProject, rotateCredential, revokeCredential, users, resolveUser, schema, invoke }),
    [identity, providers, projects, createProject, updateProject, rotateCredential, revokeCredential, users, resolveUser, schema, invoke]);
  return <MemoryHost key={identity} bridge={transport} formatTimeBucket={bridge.formatTimeBucket} modules={modules} />;
}
