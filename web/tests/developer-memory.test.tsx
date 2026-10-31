import { memoryProject, projectBridge } from "./test/memory-project-fixtures";
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Brain } from "lucide-react";
import IntegratedApp from "../src/MemoryConsole";
import developerI18n from "../src/i18n/index";
import { memoryProviderModules } from "../src/memory/registry";
import { LegacyOpenVikingWorkspace } from "../src/memory/openviking/Workspace";
// This suite verifies legacy write recovery; native source transport has its own suite.
const legacyModules = memoryProviderModules.map(module => module.id === "openviking" ? {...module, Workspace: LegacyOpenVikingWorkspace} : module);
import {
  emptyMemoryBridge, type MemoryBridge, type MemoryOperation, type MemoryProvider,
  type MemoryProviderModule, type MemoryIdentity, type MemoryWorkspaceContext,
} from "../src/memory/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement, shadow: ShadowRoot, navigate: NavigateFunction, address: string;
let active: MemoryWorkspaceContext | undefined;
const contexts: MemoryWorkspaceContext[] = [];
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const providers: MemoryProvider[] = ["hindsight", "openviking"].map(provider => ({
  provider, version: "test", operations: [],
}));
function Probe({ context, page }: { context: MemoryWorkspaceContext; page: string }) {
  useEffect(() => { active = context; contexts.push(context); }, [context]);
  return <output data-workspace>{`${context.provider.provider}:${context.user.user_id}:${page}`}</output>;
}
const modules: MemoryProviderModule[] = providers.map(({ provider }) => ({
  id: provider, labelKey: `test.${provider}`, defaultPage: "browse",
  navigation: [{ id: "browse", labelKey: "memory.title", icon: Brain }, { id: "details", labelKey: "memory.mapping", icon: Brain }],
  Workspace: Probe,
}));
function bridge(identity = "test-session"): MemoryBridge {
  return { ...projectBridge(providers[0]!), identity, providers: vi.fn(async () => providers),
    projects: vi.fn(async () => providers.map(p => memoryProject(p.provider, p.provider))),
    resolveUser: vi.fn(async (project_id, user_id) => ({ project_id, user_id, provider: providers.find(p => p.provider === project_id)!, mapping: { namespace: `${project_id}-${user_id}` } })),
  };
}
function Driver({ memory, registered }: { memory?: MemoryBridge; registered?: readonly MemoryProviderModule[] }) {
  navigate = useNavigate();
  const location = useLocation();
  address = location.pathname + location.search;
  return <IntegratedApp memory={memory} memoryModules={registered ?? legacyModules} />;
}
async function render(path: string, memory?: MemoryBridge, registered?: readonly MemoryProviderModule[]) {
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={[path]}><Driver memory={memory} registered={registered} /></MemoryRouter></StrictMode>));
  shadow = node.querySelector("[data-memory-console]")!.shadowRoot!;
}
async function settle(predicate: () => boolean) {
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(predicate()).toBe(true);
  });
}
beforeEach(async () => {
  localStorage.clear();
  contexts.length = 0; active = undefined;
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  await developerI18n.changeLanguage("en");
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

async function click(label: string, within: ParentNode = shadow) {
  const button = [...within.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click());
}
it("opens connected users without scope selectors or manual userid entry", async () => {
  const memory = bridge(); await render("/memory/hindsight/users?project=hindsight", memory, modules);
  await settle(() => Boolean(shadow.querySelector(".app-user-list")));
  expect(shadow.querySelector('input[name="userid"]')).toBeNull(); expect(shadow.querySelector('select[aria-label="Subject type"]')).toBeNull();
  expect(memory.resolveUser).not.toHaveBeenCalled(); await act(async () => shadow.querySelector<HTMLButtonElement>(".app-user-row")!.click());
  await settle(() => active?.user.user_id === "one"); expect(active?.project.id).toBe("hindsight");
  expect(address).toContain("project=hindsight&userid=one"); expect(active).not.toHaveProperty("scope");
});
it("does not create users when viewing an unused project", async () => {
  const memory = bridge(); memory.users = vi.fn(async () => ({ items: [], next_cursor: "" }));
  await render("/memory/hindsight/users?project=hindsight", memory, modules);
  await settle(() => Boolean(shadow.textContent?.includes("No users have connected")));
  expect(memory.resolveUser).not.toHaveBeenCalled(); expect(memory.invoke).not.toHaveBeenCalled();
});
it("binds native requests to the selected project and user", async () => {
  const memory = bridge(); await render("/memory/hindsight/browse?project=hindsight&userid=one", memory, modules); await settle(() => Boolean(active));
  const raw = '{"body":{"n":9223372036854775807}}'; const response = await active!.invoke("recall", raw); await response.text();
  expect(memory.invoke).toHaveBeenCalledWith("hindsight", "one", "recall", raw, expect.any(AbortSignal), undefined);
});
it("retires native requests on project/user changes", async () => {
  const memory = bridge(); await render("/memory/hindsight/browse?project=hindsight&userid=one", memory, modules); await settle(() => Boolean(active)); const old = active!;
  await act(async () => navigate("/memory/openviking/browse?project=openviking&userid=two")); await settle(() => active?.user.user_id === "two");
  expect(old.signal.aborted).toBe(true); await expect(old.invoke("read", {})).rejects.toMatchObject({ name: "AbortError" }); expect(memory.invoke).not.toHaveBeenCalled();
});
it("discards identity resolution arriving after a user switch", async () => {
  const memory = bridge(); let deliver!: (value: MemoryIdentity) => void;
  memory.resolveUser = vi.fn(async (project_id, user_id) => user_id === "one" ? new Promise<MemoryIdentity>(resolve => { deliver = resolve; }) : { project_id, user_id, provider: providers[0]!, mapping: { namespace: "new-private" } });
  await render("/memory/hindsight/browse?project=hindsight&userid=one", memory, modules);
  await act(async () => navigate("/memory/hindsight/browse?project=hindsight&userid=two")); await settle(() => active?.user.user_id === "two");
  await act(async () => deliver({ project_id: "hindsight", user_id: "one", provider: providers[0]!, mapping: { namespace: "old-private" } }));
  expect(active?.user.mapping.namespace).toBe("new-private"); expect(shadow.textContent).not.toContain("old-private");
});
it("rejects a provider mismatch or unknown project before native access", async () => {
  const memory = bridge(); await render("/memory/openviking/browse?project=hindsight&userid=one", memory, modules); await settle(() => Boolean(shadow.querySelector('[role="alert"]')));
  expect(memory.resolveUser).not.toHaveBeenCalled(); await act(async () => navigate("/memory/hindsight/browse?project=foreign&userid=one")); expect(memory.resolveUser).not.toHaveBeenCalled();
});
it("rejects an identity reply for another project", async () => {
  const memory = bridge(); memory.resolveUser = vi.fn(async () => ({ project_id: "foreign", user_id: "one", provider: providers[0]!, mapping: { namespace: "private" } }));
  await render("/memory/hindsight/browse?project=hindsight&userid=one", memory, modules); await settle(() => Boolean(shadow.querySelector('[role="alert"]')));
  expect(active).toBeUndefined(); expect(shadow.querySelector("[data-workspace]")).toBeNull();
});
it("drops native resource parameters but preserves project/user navigation", async () => {
  const memory = bridge(); await render("/memory/hindsight/browse?project=hindsight&userid=one&resource=secret", memory, modules); await settle(() => Boolean(active));
  const link = [...shadow.querySelectorAll<HTMLAnchorElement>(".sidebar a")].find(a => a.href.includes("/details?"))!;
  expect(link.href).toContain("project=hindsight&userid=one"); expect(link.href).not.toContain("resource=secret");
  const activeLink = shadow.querySelector<HTMLAnchorElement>('a[aria-current="page"]')!;
  expect(activeLink.href).toContain("resource=secret");
  await act(async () => activeLink.click());
  expect(address).toContain("resource=secret");
});
it("creates a project and retires its one-time secret when leaving API integration", async () => {
  const memory = bridge(), p = memoryProject("hindsight", "created"); let items = await memory.projects(new AbortController().signal);
  memory.projects = vi.fn(async () => items); memory.createProject = vi.fn(async () => { items = [p]; return { project: p, app_secret: "one-time-secret" }; });
  await render("/memory?view=new", memory, modules); await settle(() => Boolean(shadow.querySelector('input[aria-label="Project name"]')));
  const input = shadow.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Created"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => shadow.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle(() => Boolean(shadow.querySelector('input[aria-label="App Secret"]')));
  expect(shadow.querySelector<HTMLInputElement>('input[aria-label="App Secret"]')!.value).toBe("one-time-secret"); expect(memory.createProject).toHaveBeenCalledOnce();
  await act(async () => navigate("/memory")); await act(async () => navigate("/memory/hindsight/access?project=created"));
  await settle(() => Boolean(shadow.querySelector('input[aria-label="App Key"]'))); expect(shadow.querySelector('input[aria-label="App Secret"]')).toBeNull();
});
it("rotates and revokes the owned project credential", async () => {
  const memory = bridge(); memory.rotateCredential = vi.fn(async () => ({ app_key: "mp_hindsight", app_secret: "rotated-secret" })); memory.revokeCredential = vi.fn(async () => undefined);
  await render("/memory/hindsight/access?project=hindsight", memory, modules); await settle(() => Boolean(shadow.querySelector('input[aria-label="App Key"]')));
  await click("Rotate App Secret"); await click("Confirm", shadow.querySelector("dialog[open]")!); await settle(() => Boolean(shadow.querySelector('input[aria-label="App Secret"]')));
  expect(memory.rotateCredential).toHaveBeenCalledWith("hindsight", expect.any(AbortSignal));
  await click("Revoke credential"); await click("Confirm", shadow.querySelector("dialog[open]")!); await settle(() => vi.mocked(memory.revokeCredential).mock.calls.length === 1);
  expect(shadow.querySelector('input[aria-label="App Secret"]')).toBeNull();
});
it("renders standalone without network access", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); await render("/memory", emptyMemoryBridge, memoryProviderModules);
  await settle(() => Boolean(shadow.textContent?.includes("Create project"))); expect(fetch).not.toHaveBeenCalled(); expect(shadow.querySelector('input[name="userid"]')).toBeNull();
});

it.each(["rotate", "revoke"])("preserves the displayed secret when %s fails", async action => {
  const memory = bridge();
  memory.rotateCredential = vi.fn(async () => ({ app_key: "mp_hindsight", app_secret: "keep-this-secret" }));
  memory.revokeCredential = vi.fn(async () => { throw new Error("unavailable"); });
  await render("/memory/hindsight/access?project=hindsight", memory, modules);
  await settle(() => Boolean(shadow.querySelector('input[aria-label="App Key"]')));
  await click("Rotate App Secret"); await click("Confirm", shadow.querySelector("dialog[open]")!);
  await settle(() => Boolean(shadow.querySelector('input[aria-label="App Secret"]')));
  if (action === "rotate") vi.mocked(memory.rotateCredential).mockRejectedValueOnce(new Error("unavailable"));
  await click(action === "rotate" ? "Rotate App Secret" : "Revoke credential");
  await click("Confirm", shadow.querySelector("dialog[open]")!);
  await settle(() => Boolean(shadow.querySelector('[role="alert"]')));
  expect(shadow.querySelector<HTMLInputElement>('input[aria-label="App Secret"]')?.value).toBe("keep-this-secret");
});

const nativeCases = [
  { provider: "openviking", operation: "add_resource", page: "resources", next: "skills" },
  { provider: "hindsight", operation: "retain", page: "native", next: "playground" },
];
function nativeBridge() {
  const memory = bridge();
  memory.providers = async () => nativeCases.map(({ provider, operation }) => ({
    provider, version: "test",
    operations: [{ id: operation, method: "POST", path: provider === "openviking" ? "/api/v1/resources" : "/v1/default/banks/{bank_id}/memories",
      description: operation, request_media: ["application/json"], permission: "memory.update" } satisfies MemoryOperation],
  }));
  memory.resolveUser = async (project_id, user_id) => ({
    project_id, user_id, provider: (await memory.providers(new AbortController().signal)).find(p => p.provider === project_id)!,
    mapping: { memory_uri: `viking://user/${user_id}/memories`, bank_id: user_id },
  });
  return memory;
}
async function submitNative() {
  await settle(() => Boolean(shadow.querySelector(".memory-native-form form")));
  await act(async () => shadow.querySelector(".memory-native-form form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
function unconfirmedNotice() { return shadow.querySelector(".memory-write-notice"); }
function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
it.each(nativeCases)("preserves an uncertain $provider write across sidebar navigation and browser back", async ({ provider, operation, page, next }) => {
  const memory = nativeBridge();
  let deliver!: (response: Response) => void, signal: AbortSignal | undefined;
  memory.invoke = vi.fn((_project, _user, _operation, _input, linked) => {
    signal = linked;
    return new Promise<Response>(resolve => { deliver = resolve; });
  });
  await render(`/memory/${provider}/${page}?project=${provider}&userid=one`, memory);
  await submitNative();
  const href = `/memory/${provider}/${next}?project=${provider}&userid=one`;
  const links = [...shadow.querySelectorAll<HTMLAnchorElement>(".sidebar a")];
  expect(links.map(link => link.getAttribute("href"))).toContain(href);
  await act(async () => links.find(link => link.getAttribute("href") === href)!.click());
  expect(address).toBe(href);
  expect(signal?.aborted).toBe(true);
  expect(unconfirmedNotice()?.textContent).toContain(operation);
  expect(unconfirmedNotice()?.textContent).toContain(developerI18n.t("nativeMemory.uncertain"));
  await act(async () => navigate(-1));
  await settle(() => Boolean(shadow.querySelector(".memory-native-form")));
  await act(async () => deliver(new Response("late private result", { headers: { "X-Memory-Native-Status": "200" } })));
  expect(shadow.textContent).not.toContain("late private result");
  expect(unconfirmedNotice()?.textContent).toContain(operation);
  expect(memory.invoke).toHaveBeenCalledTimes(1);
  await act(async () => { await developerI18n.changeLanguage("zh"); });
  expect(unconfirmedNotice()?.textContent).toContain(developerI18n.t("nativeMemory.uncertain"));
  await act(async () => unconfirmedNotice()!.querySelector<HTMLButtonElement>("button")!.click());
  expect(unconfirmedNotice()).toBeNull();
  expect(memory.invoke).toHaveBeenCalledTimes(1);
});
it("preserves a write notice after leaving Memory, but isolates users, projects and login epochs", async () => {
  const memory = nativeBridge();
  let deliver!: (response: Response) => void;
  memory.invoke = vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; }));
  const path = "/memory/openviking/resources?project=openviking&userid=one";
  await render(path, memory); await submitNative();
  expect(unloadPrevented()).toBe(true);
  await act(async () => navigate("/managed-agent/agents"));
  await act(async () => navigate(path));
  await settle(() => Boolean(unconfirmedNotice()));
  expect(unconfirmedNotice()?.textContent).toContain("add_resource");
  for (const other of ["/memory/openviking/resources?project=openviking&userid=two", "/memory/hindsight/native?project=hindsight&userid=one"]) {
    await act(async () => navigate(other));
    await settle(() => Boolean(shadow.querySelector(".memory-native-form")));
    expect(unconfirmedNotice()).toBeNull();
    await act(async () => navigate(path));
    await settle(() => Boolean(unconfirmedNotice()));
  }
  expect(memory.invoke).toHaveBeenCalledTimes(1);
  await render(path, { ...memory, identity: "new-login" });
  await settle(() => Boolean(shadow.querySelector(".memory-native-form")));
  expect(unconfirmedNotice()).toBeNull();
  expect(unloadPrevented()).toBe(false);
  await act(async () => deliver(new Response("previous login private data", { headers: { "X-Memory-Native-Status": "200" } })));
  expect(unconfirmedNotice()).toBeNull();
  expect(shadow.textContent).not.toContain("previous login private data");
});
it.each(["confirmed", "failed"])("retains only unconfirmed results after a write is %s and the page is revisited", async outcome => {
  const memory = nativeBridge();
  memory.invoke = vi.fn(async () => {
    if (outcome === "failed") throw new Error("connection lost");
    return Response.json({ saved: true }, { headers: { "X-Memory-Native-Status": "200" } });
  });
  const path = "/memory/openviking/resources?project=openviking&userid=one";
  await render(path, memory); await submitNative();
  await act(async () => navigate("/memory/openviking/skills?project=openviking&userid=one"));
  await act(async () => navigate(path));
  await settle(() => Boolean(shadow.querySelector(".memory-native-form")));
  expect(Boolean(unconfirmedNotice())).toBe(outcome === "failed");
  expect(unloadPrevented()).toBe(outcome === "failed");
  if (outcome === "failed") {
    await act(async () => unconfirmedNotice()!.querySelector<HTMLButtonElement>("button")!.click());
    expect(unloadPrevented()).toBe(false);
  }
  expect(memory.invoke).toHaveBeenCalledTimes(1);
});
it("keeps a write uncertain when navigation interrupts the response body after headers arrive", async () => {
  const memory = nativeBridge(), cancel = vi.fn();
  memory.invoke = vi.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); },
    cancel,
  }), { headers: { "Content-Type": "application/json", "X-Memory-Native-Status": "200" } }));
  await render("/memory/openviking/resources?project=openviking&userid=one", memory);
  await submitNative();
  expect(unloadPrevented()).toBe(true);
  await act(async () => navigate("/memory/openviking/skills?project=openviking&userid=one"));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(unconfirmedNotice()?.textContent).toContain("add_resource");
  expect(shadow.textContent).not.toContain('{"partial":');
  expect(memory.invoke).toHaveBeenCalledTimes(1);
});

it("does not warn or retain a notice when navigating away from a native read", async () => {
  const memory = nativeBridge(), catalog = await memory.providers(new AbortController().signal);
  memory.providers = async () => catalog.map(provider => ({ ...provider,
    operations: provider.operations.map(operation => ({ ...operation, permission: "memory.read" })),
  }));
  memory.invoke = vi.fn(() => new Promise<Response>(() => {}));
  await render("/memory/openviking/resources?project=openviking&userid=one", memory);
  await submitNative();
  expect(unloadPrevented()).toBe(false);
  await act(async () => navigate("/memory/openviking/skills?project=openviking&userid=one"));
  expect(unconfirmedNotice()).toBeNull();
  expect(unloadPrevented()).toBe(false);
});

it.each([
  { label: "dispatched platform failure", status: 502, body: '{"error":{"code":"memory_transport","message":"Unknown result","dispatched":true}}', native: false, uncertain: true },
  { label: "unclassified successful proxy page", status: 200, body: "<html>Sign in</html>", native: false, uncertain: true },
  { label: "pre-dispatch platform failure", status: 502, body: '{"error":{"code":"memory_transport","message":"Not sent","dispatched":false}}', native: false, uncertain: false },
  { label: "dispatched platform scope failure", status: 403, body: '{"error":{"code":"memory_scope","message":"Unknown result","dispatched":true}}', native: false, uncertain: true },
  { label: "unclassified authorization-shaped response", status: 403, body: '{"error":"Forbidden"}', native: false, uncertain: true },
  { label: "unclassified proxy timeout", status: 408, body: "Request Timeout", native: false, uncertain: true },
  { label: "unclassified dispatch-like field", status: 408, body: '{"error":{"dispatched":false}}', native: false, uncertain: true },
  { label: "unclassified proxy failure", status: 502, body: "<html>Bad gateway</html>", native: false, uncertain: true },
  { label: "missing platform dispatch flag", status: 502, body: '{"error":{"message":"Unavailable"}}', native: false, uncertain: true },
  { label: "native failure with a same-named true field", status: 422, body: '{"error":{"dispatched":true},"id":9223372036854775807}', native: true, uncertain: true },
  { label: "native failure with a same-named false field", status: 422, body: '{"error":{"dispatched":false}}', native: true, uncertain: true },
  { label: "native server failure with a same-named field", status: 502, body: '{"error":{"dispatched":false}}', native: true, uncertain: true },
])("classifies $label without rewriting native HTTP response bytes", async ({ status, body, native, uncertain }) => {
  const memory = nativeBridge();
  memory.invoke = vi.fn(async () => new Response(body, { status, headers: {
    "Content-Type": "application/json",
    ...(native ? { "X-Memory-Native-Status": String(status) } : {}),
  } }));
  const path = "/memory/openviking/resources?project=openviking&userid=one";
  await render(path, memory); await submitNative();
  expect([...shadow.querySelectorAll(".memory-native-form section pre")].map(item => item.textContent)).toContain(body);
  expect(Boolean(unconfirmedNotice())).toBe(uncertain);
  expect(unloadPrevented()).toBe(uncertain);
  await act(async () => navigate("/memory/openviking/skills?project=openviking&userid=one"));
  await act(async () => navigate(path));
  await settle(() => Boolean(shadow.querySelector(".memory-native-form")));
  expect(Boolean(unconfirmedNotice())).toBe(uncertain);
  expect(unloadPrevented()).toBe(uncertain);
  expect(memory.invoke).toHaveBeenCalledTimes(1);
});

it("opens a project from the directory and exposes native navigation after selecting a user", async () => {
  const memory = bridge(); await render("/memory", memory, modules);
  await settle(() => Boolean(shadow.querySelector(".directory-project-link")));
  expect(address).toBe("/memory");
  await act(async()=>shadow.querySelector<HTMLButtonElement>(".directory-project-link")!.click());
  await settle(() => address.includes("/project?project=hindsight"));
  expect(shadow.querySelectorAll(".workspace-applications .workspace-options .project-select")).toHaveLength(2);
  expect(shadow.querySelector(".app-directory")).toBeNull();
  expect(shadow.querySelector(".workspace-applications .workspace-add")).not.toBeNull();
  expect(shadow.querySelector(".sidebar .sidebar-app-list")).toBeNull();
  expect(address).toContain("/project?project=hindsight");
  expect(shadow.querySelector('.sidebar a[href*="/browse?"]')).not.toBeNull();
  expect(shadow.textContent).toContain("Get project credentials");
  expect(memory.resolveUser).not.toHaveBeenCalled();
  await act(async () => navigate("/memory/hindsight/users?project=hindsight"));
  await settle(() => Boolean(shadow.querySelector(".app-user-row")));
  await act(async () => shadow.querySelector<HTMLButtonElement>(".app-user-row")!.click());
  await settle(() => Boolean(active));
  expect(shadow.querySelector('.sidebar a[href*="/browse?"]')).not.toBeNull();
});

it("shows a retryable users error without claiming the application has no users", async () => {
  const memory = bridge(); memory.users = vi.fn(async () => { throw new Error("offline"); });
  await render("/memory/hindsight/users?project=hindsight", memory, modules);
  await settle(() => Boolean(shadow.querySelector('[role="alert"]')));
  expect(shadow.textContent).not.toContain("Waiting for your first user");
  expect(memory.resolveUser).not.toHaveBeenCalled();
});

it("keeps navigation while creating an application and on account settings", async () => {
  const memory = bridge(); await render("/memory?view=new", memory, modules);
  await settle(() => Boolean(shadow.querySelector('input[aria-label="Project name"]')));
  expect(shadow.querySelectorAll(".workspace-applications .workspace-options .project-select")).toHaveLength(2);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({keys:[]})));
  await act(async () => navigate("/account/keys"));
  await settle(() => shadow.querySelectorAll(".workspace-applications .workspace-options .project-select").length === 2);
  expect(shadow.querySelectorAll(".memory-shell")).toHaveLength(1);
  expect(shadow.querySelector('.sidebar a[href="/account/keys"]')).toBeNull();
});
it("remembers the selected application without retaining another user's workspace", async () => {
  const memory = bridge(); await render("/memory/openviking/browse?project=openviking&userid=two",memory,modules);
  await settle(() => active?.user.user_id === "two");
  await act(async () => navigate("/memory"));
  await settle(() => Boolean(shadow.querySelector(".project-directory")));
  expect(address).toBe("/memory");
  expect(shadow.querySelector("[data-workspace]")).toBeNull();
});
it("opens creation with a persistent menu when there are no applications", async () => {
  const memory=bridge();memory.createProject=vi.fn(memory.createProject);memory.projects=vi.fn(async()=>[]);await render("/memory",memory,modules);
  await settle(()=>Boolean(shadow.querySelector(".directory-toolbar button")));
  await act(async()=>shadow.querySelector<HTMLButtonElement>(".directory-toolbar button")!.click());
  await settle(()=>Boolean(shadow.querySelector('input[aria-label="Project name"]')));
  expect(shadow.querySelector(".workspace-applications .workspace-add")).not.toBeNull();
  expect(shadow.querySelector(".sidebar .sidebar-app-list")).toBeNull();
  expect(shadow.querySelector('.app-directory')).toBeNull();
  expect(memory.createProject).not.toHaveBeenCalled();
});

it("switches projects directly without retaining the previous user's context", async () => {
 const memory=bridge();memory.workspaces=vi.fn(async()=>[]);
 await render('/memory/hindsight/browse?project=hindsight&userid=one',memory,modules);await settle(()=>Boolean(active));const old=active!;
 const switcher=shadow.querySelector<HTMLDetailsElement>('.workspace-picker')!;switcher.open=true;
 const target=switcher.querySelectorAll<HTMLButtonElement>('.workspace-options .project-select')[1]!;const name=target.textContent;
 await act(async()=>target.click());await settle(()=>address==='/memory/openviking/project?project=openviking&userid=default');
 expect(old.signal.aborted).toBe(true);expect(shadow.querySelector('[data-workspace]')).toBeNull();expect(switcher.open).toBe(false);
 expect(switcher.querySelector('summary')?.textContent).toContain(name);expect(memory.workspaces).not.toHaveBeenCalled();
 expect(switcher.querySelectorAll('.workspace-options')).toHaveLength(1);
});
it("opens project creation directly from the project selector", async () => {
 const memory=bridge();memory.createProject=vi.fn(memory.createProject);memory.createWorkspace=vi.fn();
 await render('/memory/hindsight/project?project=hindsight',memory,modules);await settle(()=>Boolean(shadow.querySelector('.workspace-add')));
 const switcher=shadow.querySelector<HTMLDetailsElement>('.workspace-picker')!;switcher.open=true;
 await act(async()=>switcher.querySelector<HTMLButtonElement>('.workspace-add')!.click());
 await settle(()=>address==='/memory');expect(switcher.open).toBe(false);
 await act(async()=>shadow.querySelector<HTMLButtonElement>('.directory-toolbar button')!.click());
 await settle(()=>address==='/memory?view=new');
 expect(shadow.querySelector('input[aria-label="Project name"]')).not.toBeNull();
 expect(memory.createWorkspace).not.toHaveBeenCalled();expect(memory.createProject).not.toHaveBeenCalled();
});

it("opens project actions without switching and renames through the bridge", async () => {
 const memory=bridge();memory.updateProject=vi.fn(memory.updateProject);
 await render('/memory/hindsight/project?project=hindsight',memory,modules);
 await settle(()=>shadow.querySelectorAll('.project-more').length===2);
 await act(async()=>shadow.querySelector<HTMLButtonElement>('.project-more')!.click());
 expect(address).toBe('/memory/hindsight/project?project=hindsight');
 const rename=[...shadow.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b=>b.textContent==='Rename')!;
 await act(async()=>rename.click());
 const input=shadow.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Renamed');input.dispatchEvent(new Event('input',{bubbles:true}))});
 await act(async()=>shadow.querySelector('.project-action-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(memory.updateProject).toHaveBeenCalledWith('hindsight',{name:'Renamed'},expect.any(AbortSignal));
});
it("requires confirmation before deleting a project and selects the remaining project", async () => {
 const memory=bridge();memory.deleteProject=vi.fn(async()=>{});
 await render('/memory/hindsight/project?project=hindsight',memory,modules);
 await settle(()=>shadow.querySelectorAll('.project-more').length===2);
 await act(async()=>shadow.querySelector<HTMLButtonElement>('.project-more')!.click());
 await act(async()=>[...shadow.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b=>b.textContent==='Delete')!.click());
 expect(memory.deleteProject).not.toHaveBeenCalled();
 await act(async()=>shadow.querySelector('.project-action-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(memory.deleteProject).toHaveBeenCalledWith('hindsight',expect.any(AbortSignal));
 expect(address).toBe('/memory/openviking/project?project=openviking&userid=default');
});

it("filters directory projects without entering their workspaces", async()=>{
 const memory=bridge();await render('/memory',memory,modules);
 await settle(()=>shadow.querySelectorAll('.directory-table tbody tr').length===2);
 const input=shadow.querySelector<HTMLInputElement>('input[aria-label="Search project name or App ID"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'openviking');input.dispatchEvent(new Event('input',{bubbles:true}))});
 expect(shadow.querySelectorAll('.directory-table tbody tr')).toHaveLength(1);
 expect(address).toBe('/memory');expect(memory.resolveUser).not.toHaveBeenCalled();
 await act(async()=>shadow.querySelector<HTMLButtonElement>('.directory-project-link')!.click());
 expect(address).toBe('/memory/openviking/project?project=openviking&userid=default');
});
it("defaults to a user and keeps application information above API access in the footer",async()=>{
 const memory=bridge();memory.users=vi.fn(async()=>({items:[{user_id:'default',provisioned:true},{user_id:'two',provisioned:true}],next_cursor:''}));
 await render('/memory/hindsight/project?project=hindsight',memory,modules);
 await settle(()=>shadow.querySelectorAll('.sidebar .sidebar-user-switcher .workspace-options button').length===2);
 expect(shadow.querySelector('.sidebar-user-switcher summary')?.textContent).toContain('Default user');
 expect(shadow.querySelector('.sidebar .platform-navigation')?.firstElementChild?.classList.contains('sidebar-user-switcher')).toBe(true);
 expect(shadow.querySelector('.sidebar-footer a[href*="/users?"]')).toBeNull();
 expect([...shadow.querySelectorAll('.sidebar .sidebar-footer a')].map(a=>a.textContent)).toEqual(['Application information','API integration']);
 expect(shadow.querySelector('.workspace-navigation a')?.getAttribute('href')).toContain('userid=default');
 await act(async()=>[...shadow.querySelectorAll<HTMLButtonElement>('.sidebar-user-switcher .workspace-options button')].find(b=>b.textContent==='two')!.click());
 expect(address).toBe('/memory/hindsight/project?project=hindsight&userid=two');
 expect(shadow.querySelector('.workspace-navigation a')?.getAttribute('href')).toContain('userid=two');
});
