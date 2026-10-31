function formatBucketTz(bucket: string, timezone: string, granularity: "hour" | "day", language?: string) {
  return new Intl.DateTimeFormat(language || "en", { timeZone: timezone, month: "short", day: "numeric", ...(granularity === "hour" ? { hour: "2-digit", minute: "2-digit", hour12: false } as const : {}) }).format(new Date(bucket));
}
import { projectBridge } from "./test/memory-project-fixtures";
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IntegratedApp from "../src/MemoryConsole";
import developerI18n from "../src/i18n/index";
import { hindsightOperations } from "../src/memory/hindsight/operations";
import type { MemoryBridge, MemoryNativeInput } from "../src/memory/contracts";
import { record } from "../src/memory/hindsight/types";
import fixture from "./test/fixtures/hindsight-ui.json";
import manifest from "../../internal/profiles/hindsight/manifest.json";
import { useMemoryBridge } from "../src/bridge";


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement, shadow: ShadowRoot, navigate: NavigateFunction, address: string;
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const responses = fixture.responses as Record<string, unknown>;
const t = (key: string) => developerI18n.t(`hindsight.${key}`);
const operations = manifest.operations.filter(operation => hindsightOperations.includes(operation.id as typeof hindsightOperations[number])).map(operation => {
  if (operation.method === "GET" || ["recall_memories", "reflect", "dry_run_extract_memories", "preview_prompt", "preview_consolidation_strategies", "dry_run_refresh_mental_model"].includes(operation.id)) {
    return { ...operation, permission: "memory.read" };
  }
  return { ...operation, permission: operation.method === "DELETE" ? "memory.delete" : "memory.update" };
});
function inputObject(input: MemoryNativeInput) { return typeof input === "string" ? JSON.parse(input) : input; }
function bridge(readOnly = false): MemoryBridge {
  return {
    ...projectBridge({ provider: "hindsight", version: "0.10.3", operations: readOnly ? operations.filter(op => op.permission === "memory.read") : operations }),
    schema: vi.fn(async () => ({ type: "object" })),
    invoke: vi.fn(async (_provider, _scope, operation, input) => {
      const request = inputObject(input);
      if (operation === "get_memory" && request.path?.memory_id === "obs-a") return Response.json({ id: "obs-a", type: "observation", text: "Atlas uses careful release checks" });
      if (operation === "get_bank_attachment") return new Response("image-bytes", { headers: { "Content-Type": "image/png", "Content-Disposition": 'inline; filename="diagram.png"' } });
      return Response.json(responses[operation] ?? { success: true });
    }),
  };
}
function Driver({ memory }: { memory: MemoryBridge }) {
  navigate = useNavigate();
  const location = useLocation(); address = location.pathname + location.search;
  return <IntegratedApp memory={memory} />;
}
async function render(page: string, memory = bridge(), extra = "") {
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={[`/memory/hindsight/${page}?project=project&userid=one${extra}`]}><Driver memory={memory} /></MemoryRouter></StrictMode>));
  shadow = node.querySelector("[data-memory-console]")!.shadowRoot!;
  await settle(() => Boolean(shadow.querySelector("[data-hindsight-workspace]")));
  return memory;
}
async function settle(predicate: () => boolean) {
  await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(predicate()).toBe(true); });
}
async function click(label: string, within: ParentNode = shadow) {
  if (within === shadow) within = [...shadow.querySelectorAll("dialog[open]")].at(-1) ?? shadow;
  const button = [...within.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function calls(memory: MemoryBridge, operation: string) {
  return vi.mocked(memory.invoke).mock.calls.filter(call => call[2] === operation);
}
beforeEach(async () => {
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  await developerI18n.changeLanguage("en");
});
afterEach(async () => {
  await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

it.each([
  ["overview", "get_agent_stats", "150"],
  ["memories", "list_memories", "Alice works on the Atlas project"],
  ["documents", "list_documents", "doc-a"],
  ["entities", "list_entities", "John"],
  ["models", "list_mental_models", "Atlas summary"],
  ["knowledge", "get_knowledge_base_tree", "Team knowledge"],
  ["playground", "", "Recall"],
  ["management", "list_directives", "Use evidence"],
])("renders the %s page from native-shaped fixtures", async (page, operation, visible) => {
  const memory = await render(page!);
  await settle(() => Boolean(shadow.textContent?.includes(visible!)));
  if (operation) expect(calls(memory, operation).length).toBeGreaterThan(0);
  expect(shadow.querySelectorAll(".sidebar .workspace-navigation .nav-item")).toHaveLength(8);
  expect(shadow.textContent).not.toContain("hindsight.");
});
it("opens an observation history without offering edits to derived observations", async () => {
  const memory = await render("memories", bridge(), "&hs-resource=obs-a");
  await settle(() => calls(memory, "get_observation_history").length > 0);
  expect(shadow.textContent).not.toContain(t("operations.update_memory"));
  expect(shadow.textContent).toContain("Atlas previously used manual checks");
});
it("shows native detail defaults but only patches edited memory fields", async () => {
  const memory = await render("memories", bridge(), "&hs-resource=mem-a");
  await settle(() => Boolean(shadow.textContent?.includes("Alice works on the Atlas project")));
  await click(t("operations.update_memory"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Alice leads the Atlas project");
  await click(t("submit"), modal);
  await settle(() => calls(memory, "update_memory").length === 1);
  expect(inputObject(calls(memory, "update_memory")[0]![3])).toEqual({
    path: { memory_id: "mem-a" },
    body: { text: "Alice leads the Atlas project" },
  });
});
it("reverts an invalidated memory without resubmitting its content or type", async () => {
  const memory = bridge(), original = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => args[2] === "get_memory"
    ? Promise.resolve(Response.json({ ...record(responses.get_memory), state: "invalidated" })) : original(...args));
  await render("memories", memory, "&hs-resource=mem-a");
  await click(t("operations.update_memory"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  const state = modal.querySelector<HTMLSelectElement>(`select[aria-label="${t("state")}"]`)!;
  expect(state.value).toBe("invalidated");
  await act(async () => { state.value = "valid"; state.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(t("submit"), modal);
  await settle(() => calls(memory, "update_memory").length === 1);
  expect(inputObject(calls(memory, "update_memory")[0]![3])).toEqual({ path: { memory_id: "mem-a" }, body: { state: "valid" } });
});
it("sends only new edits after saving memory content in the same dialog", async () => {
  const memory = await render("memories", bridge(), "&hs-resource=mem-a");
  await click(t("operations.update_memory"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Saved fact");
  await click(t("submit"), modal);
  const state = modal.querySelector<HTMLSelectElement>(`select[aria-label="${t("state")}"]`)!;
  await act(async () => { state.value = "invalidated"; state.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(t("submit"), modal);
  expect(calls(memory, "update_memory").map(call => inputObject(call[3]).body)).toEqual([
    { text: "Saved fact" }, { state: "invalidated" },
  ]);
  await click(t("advanced"), modal);
  expect(JSON.parse(modal.querySelector<HTMLTextAreaElement>("textarea.hs-code")!.value).body).toEqual({});
});
it.each(["Later draft", "Submitted fact"])("keeps edits made during a pending save and retries only unacknowledged fields: %s", async draft => {
  const memory = bridge(), original = memory.invoke;
  let finish!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => args[2] === "update_memory"
    ? new Promise(resolve => { finish = resolve; }) : original(...args));
  await render("memories", memory, "&hs-resource=mem-a");
  await click(t("operations.update_memory"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  const content = modal.querySelector<HTMLTextAreaElement>("textarea")!;
  await change(content, "Submitted fact");
  await click(t("submit"), modal);
  await change(content, "Intermediate draft");
  await change(content, draft);
  const context = [...modal.querySelectorAll("label")].find(label => label.querySelector("span")?.textContent === t("context"))!.querySelector<HTMLInputElement>("input")!;
  await change(context, "Later context");
  await act(async () => finish(Response.json({ success: true })));
  expect(content.value).toBe(draft);
  await click(t("submit"), modal);
  expect(inputObject(calls(memory, "update_memory")[1]![3]).body).toEqual({ text: draft, context: "Later context" });
  await act(async () => finish(Response.json({ detail: "Try again" }, { status: 503, headers: { "X-Memory-Native-Status": "503" } })));
  await click(t("submit"), modal);
  expect(inputObject(calls(memory, "update_memory")[2]![3]).body).toEqual({ text: draft, context: "Later context" });
  await act(async () => finish(Response.json({ success: true })));
  await click(t("advanced"), modal);
  expect(JSON.parse(modal.querySelector<HTMLTextAreaElement>("textarea.hs-code")!.value).body).toEqual({});
});
it("does not resubmit an acknowledged knowledge source query when renaming the page", async () => {
  const memory = await render("knowledge", bridge(), "&hs-resource=page-a");
  await settle(() => Boolean(shadow.textContent?.includes(t("operations.update_knowledge_node"))));
  await click(t("operations.update_knowledge_node"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Updated source query");
  await click(t("submit"), modal);
  const name = [...modal.querySelectorAll("label")].find(label => label.querySelector("span")?.textContent === t("name"))!.querySelector<HTMLInputElement>("input")!;
  await change(name, "New title");
  await click(t("submit"), modal);
  expect(calls(memory, "update_knowledge_node").map(call => inputObject(call[3]).body)).toEqual([
    { source_query: "Updated source query" }, { name: "New title" },
  ]);
});
it("retains submitted create-form defaults when editing another field for the next request", async () => {
  const memory = await render("memories");
  await click(t("operations.retain_memories"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Retained fact");
  await click(t("submit"), modal);
  const document = [...modal.querySelectorAll("label")].find(label => label.querySelector("span")?.textContent === t("documentId"))!.querySelector<HTMLInputElement>("input")!;
  await change(document, "next-doc");
  await click(t("submit"), modal);
  expect(inputObject(calls(memory, "retain_memories")[1]![3]).body).toEqual({ items: [{ content: "Retained fact", document_id: "next-doc" }], async: true });
});
it.each([
  ["memories", "retain_memories", { items: [{ content: "Pasted fact" }], async: false }],
  ["models", "create_mental_model", { name: "Model", source_query: "Summarize facts" }],
  ["management", "create_directive", { name: "Rule", content: "Cite evidence" }],
  ["knowledge", "create_knowledge_page", { name: "Page", source_query: "Summarize facts" }],
] as const)("opens the advanced %s draft before required form fields are complete", async (page, operation, body) => {
  const memory = await render(page);
  await click(t(`operations.${operation}`));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await click(t("submit"), modal);
  expect(calls(memory, operation)).toHaveLength(0);
  expect(modal.textContent).toContain(t("required"));
  await click(t("advanced"), modal);
  expect(modal.querySelector('[role="alert"]')).toBeNull();
  const editor = modal.querySelector<HTMLTextAreaElement>("textarea.hs-code")!;
  expect(editor).not.toBeNull();
  const raw = JSON.stringify({ body });
  await change(editor, raw);
  await click(t("submit"), modal);
  await settle(() => calls(memory, operation).length === 1);
  expect(calls(memory, operation)[0]![3]).toBe(raw);
});
it.each([
  ["memories", "", "list_memories", ["any", "all", "any_strict", "all_strict", "exact"], "any"],
  ["documents", "", "list_documents", ["any", "all", "any_strict", "all_strict"], "any_strict"],
  ["entities", "", "list_entities", ["any", "all", "any_strict", "all_strict", "exact"], "any"],
  ["models", "", "list_mental_models", ["any", "all", "exact"], "any"],
  ["management", "&hs-view=directives", "list_directives", ["any", "all", "exact"], "any"],
] as const)("uses native tag modes and defaults for %s", async (page, extra, operation, modes, defaultMode) => {
  const memory = await render(page, bridge(), extra);
  const select = shadow.querySelector<HTMLSelectElement>(`select[aria-label="${t("tagMatch")}"]`)!;
  expect([...select.options].map(option => option.value)).toEqual(modes);
  expect(select.value).toBe(defaultMode);
  const field = [...shadow.querySelectorAll(".hs-filters label")].find(item => item.querySelector("span")?.textContent === t("tags"))!;
  await change(field.querySelector<HTMLInputElement>("input")!, "atlas");
  await act(async () => { select.value = modes[modes.length - 1]!; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(t("apply"));
  await settle(() => calls(memory, operation).some(call => inputObject(call[3]).query?.tags_match === modes[modes.length - 1]));
});
it("offers only diagnostic periods implemented by the pinned native service", async () => {
  const memory = await render("management", bridge(), "&hs-view=diagnostics");
  const select = shadow.querySelector<HTMLSelectElement>(`select[aria-label="${t("period")}"]`)!;
  expect([...select.options].map(option => option.value)).toEqual(["1d", "7d", "30d"]);
  await act(async () => { select.value = "30d"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle(() => calls(memory, "audit_log_stats").some(call => inputObject(call[3]).query?.period === "30d"));
  await click(t("llm"));
  await settle(() => calls(memory, "llm_request_stats").some(call => inputObject(call[3]).query?.period === "30d"));
});
it("renders chunks from items and loads attachments only through the scoped bridge", async () => {
  const createURL = vi.fn(() => "blob:private"), revokeURL = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createURL; static revokeObjectURL = revokeURL; });
  const memory = await render("documents", bridge(), "&hs-resource=doc-a");
  await settle(() => Boolean(shadow.textContent?.includes("Original Atlas context")));
  await click(t("details"));
  await settle(() => calls(memory, "get_chunk").length > 0);
  expect(inputObject(calls(memory, "get_chunk")[0]![3])).toEqual({ path: { chunk_id: "chunk-a" } });
  await click("diagram.png");
  await settle(() => Boolean(shadow.querySelector('a[href="blob:private"]')));
  expect(calls(memory, "get_bank_attachment")).toHaveLength(1);
  expect(shadow.querySelector('[href^="https://native.invalid"]')).toBeNull();
  await act(async () => navigate("/memory/hindsight/memories?project=project&userid=two"));
  expect(revokeURL).toHaveBeenCalledWith("blob:private");
});
it("uses the page node ID for reads and the linked mental-model ID for refresh", async () => {
  const memory = await render("knowledge");
  await settle(() => Boolean(shadow.textContent?.includes("Release guide")));
  await click("Release guide");
  await settle(() => calls(memory, "get_knowledge_page").length > 0);
  expect(inputObject(calls(memory, "get_knowledge_page")[0]![3])).toEqual({ path: { page_id: "page-a" } });
  const pageReads = calls(memory, "get_knowledge_page").length;
  await click(t("operations.refresh_mental_model"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await click(t("submit"), modal);
  await settle(() => calls(memory, "refresh_mental_model").length === 1);
  expect(inputObject(calls(memory, "refresh_mental_model")[0]![3])).toEqual({ path: { mental_model_id: "model-a" } });
  await settle(() => calls(memory, "get_knowledge_page").length > pageReads);
});
it.each([
  ["folder-a", "name", "Release notes", { name: "Release notes" }],
  ["folder-a", "parentId", "folder-b", { parent_id: "folder-b" }],
  ["page-a", "name", "Release guide v2", { name: "Release guide v2" }],
] as const)("patches only the edited knowledge node field for %s / %s", async (id, label, value, body) => {
  const memory = await render("knowledge", bridge(), `&hs-resource=${id}`);
  await settle(() => Boolean(shadow.textContent?.includes(t("operations.update_knowledge_node"))));
  await click(t("operations.update_knowledge_node"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  const field = [...modal.querySelectorAll(".hs-form label")].find(item => item.querySelector("span")?.textContent === t(label))!;
  await change(field.querySelector<HTMLInputElement>("input")!, value);
  await click(t("submit"), modal);
  await settle(() => calls(memory, "update_knowledge_node").length === 1);
  expect(inputObject(calls(memory, "update_knowledge_node")[0]![3])).toEqual({ path: { node_id: id }, body });
  if (id === "folder-a") expect(modal.textContent).not.toContain(t("sourceQuery"));
});
it("submits Reflect evidence options as native objects and renders returned evidence", async () => {
  const memory = await render("playground", bridge(), "&hs-view=reflect");
  await change(shadow.querySelector<HTMLTextAreaElement>(".hs-form textarea")!, "What do we know about AI?");
  await act(async () => shadow.querySelector<HTMLFormElement>(".hs-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle(() => calls(memory, "reflect").length === 1);
  expect(inputObject(calls(memory, "reflect")[0]![3]).body.include).toEqual({ facts: {}, tool_calls: {} });
  await settle(() => Boolean(shadow.textContent?.includes("AI is used in healthcare")));
});
it("keeps all mutation and initialize controls disabled for a read-only subject", async () => {
  await render("memories", bridge(true));
  await settle(() => Boolean(shadow.textContent?.includes("Alice works on the Atlas project")));
  const retain = [...shadow.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === t("operations.retain_memories"))!;
  expect(retain.disabled).toBe(true);
  expect(shadow.textContent).not.toContain(t("initialize"));
});
it("preserves a native missing-bank result without recreating it from the console", async () => {
  const memory = bridge();
  memory.invoke = vi.fn(async () => Response.json({ detail: "Bank not found" }, { status: 404, headers: { "X-Memory-Native-Status": "404" } }));
  await render("memories", memory);
  await settle(() => Boolean(shadow.querySelector('[role="alert"]')));
  expect(shadow.textContent).not.toContain(t("initialize"));
});
it("uses the host time-zone formatter for native minute buckets", async () => {
  const memory = bridge(), original = memory.invoke;
  memory.formatTimeBucket = vi.fn(() => "Oct 20, 08:30");
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => args[2] === "get_memories_timeseries"
    ? Promise.resolve(Response.json({ trunc: "minute", buckets: [{ time: "2026-10-20T00:30:00Z", world: 1 }] }))
    : original(...args));
  await render("overview", memory);
  await settle(() => Boolean(shadow.querySelector('.hs-bar[title="Oct 20, 08:30 · 1"]')));
  expect(memory.formatTimeBucket).toHaveBeenCalledWith("2026-10-20T00:30:00Z", "hour", "en");
});
it("updates host timezone labels without retiring drafts, in-flight writes or accepted tasks", async () => {
  const previousTimezone = "UTC"; let setTimezone!: (zone: string) => void;
  const memory = bridge();
  let deliver!: (response: Response) => void, writeSignal!: AbortSignal;
  const bucket = "2026-10-20T00:30:00Z";
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "https://workspace.test"), signal = init!.signal as AbortSignal;
    if (url.pathname.endsWith("/workspaces")) return Response.json({workspaces:[{id:"default",name:"默认项目空间",is_default:true,created_at:"2026-10-31"}]});
    if (url.pathname.endsWith("/providers")) return Response.json({ providers: await memory.providers(signal) });
    if (url.pathname.endsWith("/projects")) return Response.json({ projects: await memory.projects(signal) });
    if (url.pathname.endsWith("/users")) return Response.json(await memory.users("project", "", signal));
    if (url.pathname.endsWith("/identity")) return Response.json(await memory.resolveUser("project", JSON.parse(String(init!.body)).user_id, signal));
    const operation = url.pathname.split("/").pop()!;
    if (operation === "retain_memories") { writeSignal = signal; return new Promise<Response>(resolve => { deliver = resolve; }); }
    if (operation === "get_operation_status") return Response.json({ status: "processing" });
    if (operation === "get_memories_timeseries") return Response.json({ trunc: "hour", buckets: [{ time: bucket, world: 1 }] });
    const envelope = JSON.parse(String(init!.body));
    return memory.invoke("project", "one", operation, envelope, signal);
  });
  vi.stubGlobal("fetch", fetch);
  function Host() { const bridge = useMemoryBridge("test-account"); const [timezone, updateTimezone] = useState("UTC"); setTimezone = updateTimezone; return <Driver memory={{ ...bridge, formatTimeBucket: (bucket, granularity, language) => formatBucketTz(bucket, timezone, granularity, language) }} />; }
  try {
    await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={["/memory/hindsight/memories?project=project&userid=one"]}><Host /></MemoryRouter></StrictMode>));
    shadow = node.querySelector("[data-memory-console]")!.shadowRoot!;
    await settle(() => Boolean(shadow.querySelector("[data-hindsight-workspace]")));
    await click(t("operations.retain_memories"));
    const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
    await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Keep this draft");
    await click(t("submit"), modal);
    const reads = fetch.mock.calls.length;
    await act(async () => setTimezone("Asia/Shanghai"));
    expect(shadow.querySelector("dialog.hs-modal[open]")).toBe(modal);
    expect(modal.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep this draft");
    expect(writeSignal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(reads);
    await act(async () => deliver(Response.json({ operation_id: "accepted-task" })));
    await settle(() => Boolean(modal.querySelector(".hs-task")));
    const acceptedReads = fetch.mock.calls.length;
    await act(async () => setTimezone("UTC"));
    expect(shadow.querySelector("dialog.hs-modal[open]")).toBe(modal);
    expect(modal.querySelector(".hs-task > code")!.textContent).toBe("accepted-task");
    expect(fetch).toHaveBeenCalledTimes(acceptedReads);
    await act(async () => navigate("/memory/hindsight/overview?project=project&userid=one"));
    await settle(() => Boolean(shadow.querySelector(".hs-bar")));
    expect(shadow.querySelector(".hs-bar")!.getAttribute("title")).toBe(`${formatBucketTz(bucket, "UTC", "hour", "en")} · 1`);
    const overviewReads = fetch.mock.calls.length;
    await act(async () => setTimezone("Asia/Shanghai"));
    expect(shadow.querySelector(".hs-bar")!.getAttribute("title")).toBe(`${formatBucketTz(bucket, "Asia/Shanghai", "hour", "en")} · 1`);
    expect(fetch).toHaveBeenCalledTimes(overviewReads);
  } finally { await act(async () => setTimezone(previousTimezone)); }
});
it("clears resource IDs, filters, pagination and unsaved forms when the subject changes", async () => {
  const memory = await render("documents", bridge(), "&hs-resource=doc-a&hs-offset=25&hs-filters=%7B%22q%22%3A%22private%22%7D");
  await settle(() => Boolean(shadow.textContent?.includes("Atlas meeting notes")));
  await click(t("operations.update_document"));
  expect(shadow.querySelector("dialog.hs-modal[open]")).not.toBeNull();
  await act(async()=>[...shadow.querySelectorAll<HTMLButtonElement>('.sidebar-user-switcher .workspace-options button')].find(b=>b.textContent==='two')!.click());
  await settle(() => address === "/memory/hindsight/documents?project=project&userid=two");
  expect(shadow.querySelector("dialog.hs-modal[open]")).toBeNull();
  expect(address).not.toContain("hs-resource");
  expect(calls(memory, "update_document")).toHaveLength(0);
});
it.each(["not_found", "new_native_state", "pending", "completed", "failed", "cancelled"])("preserves task %s and offers only valid ordinary actions", async status => {
  const memory = bridge();
  memory.invoke = vi.fn(async (_provider, _scope, operation) => Response.json(operation === "get_operation_status" ? { operation_id: "op-a", operation_type: "retain", status } : {}));
  await render("management", memory, "&hs-view=tasks&hs-resource=op-a");
  await settle(() => Boolean(shadow.querySelector(".hs-panel .ifd-badge")));
  const action = (id: string) => [...shadow.querySelectorAll<HTMLButtonElement>(".hs-actions button")].some(button => button.textContent === t(`operations.${id}`));
  expect(action("retry_operation")).toBe(["failed", "cancelled"].includes(status));
  expect(action("cancel_operation")).toBe(status === "pending");
  expect(action("delete_operation")).toBe(["completed", "failed", "cancelled"].includes(status));
  if (status === "new_native_state") expect(shadow.textContent).toContain("new_native_state");
});
it("returns to the task list after synchronous deletion without monitoring the deleted ID", async () => {
  const memory = bridge();
  memory.invoke = vi.fn(async (_provider, _scope, operation) => {
    switch (operation) {
      case "get_operation_status": return Response.json({ operation_id: "op-a", task_type: "retain", status: "completed" });
      case "delete_operation": return Response.json({ success: true, message: "Operation op-a deleted", operation_id: "op-a" });
      default: return Response.json({ operations: [], total: 0, limit: 25, offset: 0 });
    }
  });
  await render("management", memory, "&hs-view=tasks&hs-resource=op-a");
  await settle(() => Boolean(shadow.textContent?.includes(t("operations.delete_operation"))));
  const reads = calls(memory, "get_operation_status").length;
  await click(t("operations.delete_operation"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await act(async () => modal.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click(t("submit"), modal);
  await settle(() => calls(memory, "delete_operation").length === 1);
  expect(calls(memory, "get_operation_status")).toHaveLength(reads);
  expect(address).not.toContain("hs-resource");
  expect(shadow.querySelector("dialog.hs-modal[open]")).toBeNull();
  expect(calls(memory, "list_operations").length).toBeGreaterThan(0);
});
it("imports into the current bank with merge and never collects another target bank", async () => {
  const memory = await render("management", bridge(), "&hs-view=transfer");
  await click(t("operations.import_bank_transfer"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  expect(modal.textContent).not.toContain("target_bank_id");
  const file = modal.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(file, "files", { value: [new File(["zip"], "archive.zip", { type: "application/zip" })], configurable: true });
    file.dispatchEvent(new Event("change", { bubbles: true }));
    modal.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  // The request/body-size path is covered in the native client test; jsdom's
  // File implementation is not the browser's multipart encoder.
  expect(modal.querySelector<HTMLSelectElement>("select")!.value).toBe("skip");
  expect(calls(memory, "import_bank_transfer")).toHaveLength(0);
});
it("surfaces a native write failure once, without replaying it", async () => {
  const memory = bridge();
  const original = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "retain_memories"
    ? Response.json({ error: { code: "transport", message: "Lost response", dispatched: true } }, { status: 502 })
    : original(...args));
  await render("memories", memory);
  await click(t("operations.retain_memories"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "A useful project fact");
  await click(t("submit"), modal);
  await settle(() => Boolean(modal.querySelector('[role="alert"]')));
  expect(calls(memory, "retain_memories")).toHaveLength(1);
  expect(modal.textContent).toContain(t("uncertain"));
});
it("warns about an uncertain native 500 write with a plain detail body", async () => {
  const memory = bridge(), original = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => args[2] === "retain_memories"
    ? Promise.resolve(Response.json({ detail: "Native failure after dispatch" }, { status: 500, headers: { "X-Memory-Native-Status": "500" } }))
    : original(...args));
  await render("memories", memory);
  await click(t("operations.retain_memories"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Fact");
  await click(t("submit"), modal);
  await settle(() => Boolean(modal.querySelector('[role="alert"]')));
  expect(modal.textContent).toContain(t("uncertain"));
  expect(modal.textContent).toContain("Native failure after dispatch");
  expect(calls(memory, "retain_memories")).toHaveLength(1);
});
it("keeps accepted tasks through another pending/failed submission and accumulates later IDs", async () => {
  const memory = bridge(), original = memory.invoke;
  let attempt = 0, rejectSecond!: (error: Error) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => {
    if (args[2] === "retain_memories") {
      attempt++;
      if (attempt === 2) return new Promise((_resolve, reject) => { rejectSecond = reject; });
      return Promise.resolve(Response.json({ operation_ids: attempt === 1 ? ["first", "second"] : ["third"] }));
    }
    if (args[2] === "get_operation_status") return Promise.resolve(Response.json({ status: "processing" }));
    return original(...args);
  });
  await render("memories", memory);
  await click(t("operations.retain_memories"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await change(modal.querySelector<HTMLTextAreaElement>("textarea")!, "Fact");
  await click(t("submit"), modal);
  await settle(() => modal.querySelectorAll(".hs-task").length === 2);
  await click(t("submit"), modal);
  expect(modal.querySelectorAll(".hs-task")).toHaveLength(2);
  await act(async () => rejectSecond(new Error("Second request failed")));
  expect(modal.textContent).toContain("Second request failed");
  expect(modal.querySelectorAll(".hs-task")).toHaveLength(2);
  await click(t("submit"), modal);
  await settle(() => modal.querySelectorAll(".hs-task").length === 3);
  expect([...modal.querySelectorAll(".hs-task > code")].map(item => item.textContent)).toEqual(["first", "second", "third"]);
  const readCount = calls(memory, "get_operation_status").length;
  await click(t("refresh"), modal.querySelector(".hs-task-monitor")!);
  await settle(() => calls(memory, "get_operation_status").length >= readCount + 3);
  expect(calls(memory, "get_operation_status").slice(-3).map(call => inputObject(call[3]).path.operation_id)).toEqual(["first", "second", "third"]);
  expect(calls(memory, "retain_memories")).toHaveLength(3);
});
it("refetches model history with detail on manual refresh, mutation acceptance and task completion", async () => {
  const memory = bridge(), original = memory.invoke;
  let version = 1, taskStatus = "processing";
  let finishDetail!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => {
    switch (args[2]) {
      case "get_mental_model": return version === 2 ? new Promise(resolve => { finishDetail = resolve; })
        : Promise.resolve(Response.json({ id: "model-a", name: "Model", content: `Current version ${version}` }));
      case "get_mental_model_history": return Promise.resolve(Response.json({ history: [{ id: String(version), previous_content: `Previous version ${version}` }] }));
      case "refresh_mental_model": version = 3; return Promise.resolve(Response.json({ operation_ids: ["refresh-a", "unavailable-task"] }));
      case "get_operation_status": return Promise.resolve(Response.json({ status: inputObject(args[3]).path.operation_id === "unavailable-task" ? "not_found" : taskStatus }));
      default: return original(...args);
    }
  });
  await render("models", memory, "&hs-resource=model-a");
  await settle(() => Boolean(shadow.textContent?.includes("Previous version 1")));
  version = 2;
  await click(t("refresh"));
  await settle(() => Boolean(shadow.textContent?.includes("Previous version 2")));
  expect(shadow.querySelector(".hs-history")!.textContent).not.toContain("Current version 1");
  await act(async () => finishDetail(Response.json({ id: "model-a", name: "Model", content: "Current version 2" })));
  expect(shadow.textContent).toContain("Current version 2");
  expect(shadow.textContent).not.toContain("Previous version 1");
  await click(t("operations.refresh_mental_model"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await click(t("submit"), modal);
  await settle(() => Boolean(shadow.textContent?.includes("Previous version 3")));
  expect(shadow.querySelector("dialog.hs-modal[open]")).toBe(modal);
  await settle(() => Boolean(modal.querySelector(".hs-task")));
  version = 4; taskStatus = "completed";
  await click(t("refresh"), modal.querySelector(".hs-task-monitor")!);
  await settle(() => Boolean(shadow.textContent?.includes("Previous version 4")));
  expect(shadow.textContent).toContain("Current version 4");
  expect(shadow.querySelector("dialog.hs-modal[open]")).toBe(modal);
  expect(calls(memory, "refresh_mental_model")).toHaveLength(1);
  await click(t("cancel"), modal);
  version = 5;
  await click(t("refresh"), shadow.querySelector(".hs-history")!.closest(".hs-read")!);
  await settle(() => Boolean(shadow.textContent?.includes("Previous version 5")));
  expect(shadow.querySelector(".hs-history")!.textContent).toContain("Current version 5");
});
it("notifies terminal tasks once per accepted ID without re-notifying unrelated completed jobs", async () => {
  const memory = bridge(), original = memory.invoke;
  let attempt = 0;
  const statuses = new Map([["job-a", "completed"], ["job-b", "processing"]]);
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => {
    if (args[2] === "refresh_mental_model") return Promise.resolve(Response.json({ operation_id: ++attempt === 2 ? "job-b" : "job-a" }));
    if (args[2] === "get_operation_status") return Promise.resolve(Response.json({ status: statuses.get(inputObject(args[3]).path.operation_id) }));
    return original(...args);
  });
  await render("models", memory, "&hs-resource=model-a");
  await click(t("operations.refresh_mental_model"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  const taskStatus = (id: string) => [...modal.querySelectorAll(".hs-task")].find(task => task.querySelector("code")?.textContent === id)?.textContent;
  await click(t("submit"), modal);
  await settle(() => Boolean(taskStatus("job-a")?.includes(t("completed"))));
  let reads = calls(memory, "get_mental_model").length;
  await click(t("submit"), modal);
  await settle(() => Boolean(taskStatus("job-b")?.includes(t("processing"))));
  expect(calls(memory, "get_mental_model")).toHaveLength(reads + 1);
  statuses.set("job-b", "completed");
  await click(t("refresh"), modal.querySelector(".hs-task-monitor")!);
  expect(calls(memory, "get_mental_model")).toHaveLength(reads + 2);
  await click(t("refresh"), modal.querySelector(".hs-task-monitor")!);
  expect(calls(memory, "get_mental_model")).toHaveLength(reads + 2);

  reads = calls(memory, "get_mental_model").length;
  statuses.set("job-a", "processing");
  await click(t("submit"), modal);
  await settle(() => Boolean(taskStatus("job-a")?.includes(t("processing"))));
  expect(calls(memory, "get_mental_model")).toHaveLength(reads + 1);
  statuses.set("job-a", "completed");
  await click(t("refresh"), modal.querySelector(".hs-task-monitor")!);
  expect(calls(memory, "get_mental_model")).toHaveLength(reads + 2);
  await click(t("refresh"), modal.querySelector(".hs-task-monitor")!);
  expect(calls(memory, "get_mental_model")).toHaveLength(reads + 2);
});
it("preserves a resource action and its accepted task when the follow-up detail read fails", async () => {
  const memory = bridge(), original = memory.invoke;
  let accepted = false;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => {
    if (args[2] === "refresh_mental_model") { accepted = true; return Promise.resolve(Response.json({ operation_id: "refresh-a" })); }
    if (args[2] === "get_mental_model" && accepted) return Promise.resolve(Response.json({ detail: "Read unavailable" }, { status: 503, headers: { "X-Memory-Native-Status": "503" } }));
    if (args[2] === "get_operation_status") return Promise.resolve(Response.json({ status: "processing" }));
    return original(...args);
  });
  await render("models", memory, "&hs-resource=model-a");
  await click(t("operations.refresh_mental_model"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await click(t("submit"), modal);
  await settle(() => Boolean(shadow.textContent?.includes("Read unavailable")));
  expect(shadow.querySelector("dialog.hs-modal[open]")).toBe(modal);
  expect(modal.querySelector(".hs-task > code")!.textContent).toBe("refresh-a");
  expect(calls(memory, "refresh_mental_model")).toHaveLength(1);
});
it("opens the next document at its first chunk page", async () => {
  const memory = bridge(), original = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => {
    if (args[2] === "list_documents") return Promise.resolve(Response.json({ items: [{ id: "doc-b" }], total: 1 }));
    if (args[2] === "list_document_chunks") return Promise.resolve(Response.json({ items: [], total: 60 }));
    return original(...args);
  });
  await render("documents", memory, "&hs-resource=doc-a");
  await settle(() => calls(memory, "list_document_chunks").length > 0);
  await click(t("next"));
  await settle(() => calls(memory, "list_document_chunks").some(call => inputObject(call[3]).query.offset === 25));
  await click(t("back"));
  await settle(() => Boolean(shadow.textContent?.includes("doc-b")));
  await click(t("details"));
  await settle(() => calls(memory, "list_document_chunks").some(call => inputObject(call[3]).path.document_id === "doc-b"));
  expect(inputObject(calls(memory, "list_document_chunks").slice(-1)[0]![3])).toEqual({ path: { document_id: "doc-b" }, query: { offset: 0, limit: 25 } });
  expect(address).not.toContain("hs-chunks-offset");
});
it("keeps the selected task status when applying advanced filters", async () => {
  const memory = await render("management", bridge(), "&hs-view=tasks");
  const status = shadow.querySelector<HTMLSelectElement>(`select[aria-label="${t("status")}"]`)!;
  await act(async () => { status.value = "pending"; status.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(t("apply"));
  expect(JSON.parse(new URLSearchParams(address.split("?")[1]).get("hs-filters")!).status).toBe("pending");
  expect(inputObject(calls(memory, "list_operations").slice(-1)[0]![3]).query.status).toBe("pending");
});
it("preserves native task type filters across repeated Apply and browser history", async () => {
  const memory = await render("management", bridge(), "&hs-view=tasks");
  const advanced = () => shadow.querySelector<HTMLTextAreaElement>(".hs-filters textarea")!;
  const filters = { type: "retain", exclude_parents: true };
  await change(advanced(), JSON.stringify(filters));
  await click(t("apply"));
  await click(t("apply"));
  expect(inputObject(calls(memory, "list_operations").slice(-1)[0]![3]).query).toEqual({ ...filters, limit: 25, offset: 0 });
  expect(JSON.parse(advanced().value)).toEqual(filters);

  await click(t("clearFilters"));
  await act(async () => navigate(-1));
  expect(JSON.parse(advanced().value)).toEqual(filters);
  await act(async () => navigate(1));
  expect(JSON.parse(advanced().value)).toEqual({});
  await act(async () => navigate(-1));
  await click(t("apply"));
  expect(JSON.parse(new URLSearchParams(address.split("?")[1]).get("hs-filters")!)).toEqual(filters);
  expect(inputObject(calls(memory, "list_operations").slice(-1)[0]![3]).query).toEqual({ ...filters, limit: 25, offset: 0 });
});
it("clears only task status when selecting All, preserving native filters from a deep link", async () => {
  const filters = { status: "pending", type: "retain", exclude_parents: true };
  const memory = await render("management", bridge(), `&hs-view=tasks&hs-filters=${encodeURIComponent(JSON.stringify(filters))}`);
  const status = shadow.querySelector<HTMLSelectElement>(`select[aria-label="${t("status")}"]`)!;
  await act(async () => { status.value = ""; status.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(t("apply"));
  expect(JSON.parse(new URLSearchParams(address.split("?")[1]).get("hs-filters")!)).toEqual({ type: "retain", exclude_parents: true });
  expect(inputObject(calls(memory, "list_operations").slice(-1)[0]![3]).query).toEqual({ type: "retain", exclude_parents: true, limit: 25, offset: 0 });
});
it.each([
  ["second", "atlas"],
  ["first", "release"],
  ["second", "release"],
])("restores knowledge query/tags with Back and Forward after searching %s / %s", async (query, tags) => {
  const memory = await render("knowledge");
  const inputs = () => [...shadow.querySelectorAll<HTMLInputElement>("form.hs-filter-fields input")];
  await change(inputs()[0]!, "first"); await change(inputs()[1]!, "atlas");
  await click(t("search"));
  await change(inputs()[0]!, query); await change(inputs()[1]!, tags);
  await click(t("search"));
  await act(async () => navigate(-1));
  expect(inputs().map(input => input.value)).toEqual(["first", "atlas"]);
  expect(inputObject(calls(memory, "search_knowledge_base").slice(-1)[0]![3]).query).toEqual({ q: "first", tags: ["atlas"], limit: 50 });
  await act(async () => navigate(1));
  expect(inputs().map(input => input.value)).toEqual([query, tags]);
  expect(inputObject(calls(memory, "search_knowledge_base").slice(-1)[0]![3]).query).toEqual({ q: query, tags: [tags], limit: 50 });
  await act(async () => navigate(-1));
  await click(t("search"));
  const params = new URLSearchParams(address.split("?")[1]);
  expect(params.get("hs-q")).toBe("first");
  expect(params.get("hs-tags")).toBe("atlas");
  await click(t("clearFilters"));
  expect(inputs().map(input => input.value)).toEqual(["", ""]);
  await act(async () => navigate(-1));
  expect(inputs().map(input => input.value)).toEqual(["first", "atlas"]);
});
it("preserves unsent knowledge search drafts through resource navigation and refresh", async () => {
  const memory = await render("knowledge", bridge(), "&hs-q=first&hs-tags=atlas");
  await settle(() => Boolean(shadow.textContent?.includes("Release guide")));
  const inputs = () => [...shadow.querySelectorAll<HTMLInputElement>("form.hs-filter-fields input")];
  await change(inputs()[0]!, "unsent query"); await change(inputs()[1]!, "unsent tag");
  const searches = calls(memory, "search_knowledge_base").length;
  await click("Release guide");
  await settle(() => calls(memory, "get_knowledge_page").length > 0);
  expect(inputs().map(input => input.value)).toEqual(["unsent query", "unsent tag"]);
  expect(calls(memory, "search_knowledge_base")).toHaveLength(searches);
  await act(async () => navigate(-1));
  expect(inputs().map(input => input.value)).toEqual(["unsent query", "unsent tag"]);
  await click(t("refresh"));
  expect(inputs().map(input => input.value)).toEqual(["unsent query", "unsent tag"]);
  expect(inputObject(calls(memory, "search_knowledge_base").slice(-1)[0]![3]).query).toEqual({ q: "first", tags: ["atlas"], limit: 50 });
});
it("restores graph filter controls with browser Back and Forward", async () => {
  const memory = await render("entities", bridge(), "&hs-view=memoryGraph");
  const search = () => shadow.querySelector<HTMLInputElement>(".hs-filters input")!;
  await change(search(), "first"); await click(t("apply"));
  await change(search(), "second"); await click(t("apply"));
  await act(async () => navigate(-1));
  expect(search().value).toBe("first");
  expect(inputObject(calls(memory, "get_graph").slice(-1)[0]![3]).query.q).toBe("first");
  await act(async () => navigate(1));
  expect(search().value).toBe("second");
  await act(async () => navigate(-1));
  await click(t("apply"));
  expect(JSON.parse(new URLSearchParams(address.split("?")[1]).get("hs-filters")!).q).toBe("first");
});
it("renders both graphs using nested native data and offers a detail read", async () => {
  const memory = await render("entities", bridge(), "&hs-view=entityGraph");
  await settle(() => shadow.querySelectorAll("svg.hs-graph g").length > 0);
  await act(async () => shadow.querySelector<SVGGElement>("svg.hs-graph g")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle(() => calls(memory, "get_entity").length > 0);
  await click(t("memoryGraph"));
  await settle(() => calls(memory, "get_graph").length > 0);
  expect(shadow.querySelector("svg.hs-graph line")).not.toBeNull();
});
it.each([
  ["entityGraph", "get_entity_graph", "get_entity", "entity_id"],
  ["memoryGraph", "get_graph", "get_memory", "memory_id"],
] as const)("keeps %s details within the current nodes across browser history and refresh", async (view, graphOperation, detailOperation, idField) => {
  const memory = bridge(), original = memory.invoke;
  const detail = (id: string, label: string) => ({ ...record(responses[detailOperation]), id, [detailOperation === "get_entity" ? "canonical_name" : "text"]: label });
  let empty = false, fail = false, pending = false;
  let finish!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>((...args) => {
    const input = inputObject(args[3]);
    if (args[2] === graphOperation) {
      if (fail) return Promise.resolve(Response.json({ detail: "Graph unavailable" }, { status: 503 }));
      const id = input.query.tags?.[0] ?? "first";
      return Promise.resolve(Response.json({ nodes: empty ? [] : [{ data: { id, label: `Node ${id}` } }], edges: [] }));
    }
    if (args[2] === detailOperation) {
      if (pending) return new Promise(resolve => { finish = resolve; });
      return Promise.resolve(Response.json(detail(input.path[idField], `Detail ${input.path[idField]}`)));
    }
    return original(...args);
  });
  await render("entities", memory, `&hs-view=${view}`);
  const tags = () => [...shadow.querySelectorAll(".hs-filters label")].find(label => label.querySelector("span")?.textContent === t("tags"))!.querySelector<HTMLInputElement>("input")!;
  const graphNode = (id: string) => shadow.querySelector<SVGGElement>(`svg.hs-graph g[aria-label="Node ${id}"]`);
  const select = async (id: string) => {
    await settle(() => Boolean(graphNode(id)));
    await act(async () => graphNode(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  };
  await change(tags(), "first"); await click(t("apply"));
  await change(tags(), "second"); await click(t("apply"));
  await select("second");
  expect(shadow.querySelector(".hs-read")?.textContent).toContain("Detail second");
  let reads = calls(memory, detailOperation).length;
  await act(async () => navigate(-1));
  await settle(() => Boolean(graphNode("first")));
  expect(shadow.querySelector(".hs-read")).toBeNull();
  expect(calls(memory, detailOperation)).toHaveLength(reads);

  await select("first");
  expect(shadow.querySelector(".hs-read")?.textContent).toContain("Detail first");
  reads = calls(memory, detailOperation).length;
  await act(async () => navigate(1));
  await settle(() => Boolean(graphNode("second")));
  expect(shadow.querySelector(".hs-read")).toBeNull();
  expect(calls(memory, detailOperation)).toHaveLength(reads);

  await select("second");
  fail = true;
  await click(t("refresh"));
  expect(shadow.querySelector(".hs-read")?.textContent).toContain("Detail second");
  fail = false; empty = true;
  await click(t("refresh"));
  expect(shadow.querySelector("svg.hs-graph")).toBeNull();
  expect(shadow.querySelector(".hs-read")).toBeNull();

  empty = false;
  await act(async () => navigate(-1));
  pending = true;
  await select("first");
  const request = calls(memory, detailOperation).slice(-1)[0]!;
  await act(async () => navigate(1));
  expect(request[4]?.aborted).toBe(true);
  await act(async () => finish(Response.json(detail("first", "Late detail first"))));
  await settle(() => Boolean(graphNode("second")));
  expect(shadow.querySelector(".hs-read")).toBeNull();
  expect(shadow.textContent).not.toContain("Late detail first");
});
it("uses configuration updates and native model history shapes", async () => {
  const memory = await render("management", bridge(), "&hs-view=config");
  await settle(() => Boolean(shadow.textContent?.includes("retain_extraction_mode")));
  await click(t("operations.update_bank_config"));
  const modal = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await click(t("submit"), modal);
  await settle(() => calls(memory, "update_bank_config").length === 1);
  expect(inputObject(calls(memory, "update_bank_config")[0]![3])).toEqual({ body: { updates: record(responses.get_bank_config).overrides } });
  await act(async () => navigate("/memory/hindsight/models?project=project&userid=one&hs-resource=model-a"));
  await settle(() => Boolean(shadow.textContent?.includes("Atlas was preparing")));
  expect(shadow.textContent).toContain("Upstream timeout");
});

it("filters memory types through the native request and resets pagination", async () => {
  const memory = await render("memories", bridge(), '&hs-offset=25');
  await click(developerI18n.t("nativeUI.observation"));
  await settle(() => calls(memory,"list_memories").some(call => inputObject(call[3]).query.type === "observation"));
  expect(inputObject(calls(memory,"list_memories").at(-1)![3]).query).toMatchObject({type:"observation",offset:0});
});
it("closes a resource viewer back to its filtered document list", async () => {
  await render("documents", bridge(), '&hs-filters='+encodeURIComponent(JSON.stringify({q:"Atlas"})));
  await click(t("details"));
  await settle(() => Boolean(shadow.querySelector("dialog.hs-resource-modal[open]")));
  await click(t("back"));
  expect(shadow.querySelector("dialog.hs-resource-modal[open]")).toBeNull();
  expect(address).toContain("hs-filters="); expect(address).not.toContain("hs-resource=");
});
it("keeps the resource viewer open when cancelling a nested action", async () => {
  await render("documents", bridge());
  await click(t("details"));
  await click(t("operations.update_document"));
  const action = shadow.querySelector<HTMLDialogElement>("dialog.hs-modal[open]")!;
  await act(async () => action.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
  expect(shadow.querySelector("dialog.hs-modal[open]")).toBeNull();
  expect(shadow.querySelector("dialog.hs-resource-modal[open]")).not.toBeNull();
  expect(address).toContain("hs-resource=");
});
