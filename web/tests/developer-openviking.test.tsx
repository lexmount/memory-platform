// Regression coverage for the retained legacy/fallback workspace. Official integration has separate transport and browser coverage.
import {openVikingModule,LegacyOpenVikingWorkspace} from "../src/memory/openviking/Workspace";
import { projectBridge } from "./test/memory-project-fixtures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtures, manifest } from "./test/openviking-fixtures";
import IntegratedApp from "../src/MemoryConsole";
import developerI18n from "../src/i18n/index";
import type { MemoryBridge, MemoryNativeInput, MemoryProvider } from "../src/memory/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const memoryRoot = "viking://user/subject/memories";
const file = memoryRoot + "/preferences/editor.md";
let root: Root, node: HTMLDivElement, shadow: ShadowRoot, navigate: NavigateFunction, address: string;
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const provider: MemoryProvider = {
  provider: "openviking", version: manifest.version,
  operations: manifest.operations.map(operation => ({
    ...operation, permission: operation.method === "GET" || ["find", "search", "grep", "glob", "export_ovpack"].includes(operation.id)
      ? "memory.read" : operation.method === "DELETE" || operation.id === "mv" ? "memory.delete" : "memory.update",
  })),
};
function nativeResult(operation: string, input: MemoryNativeInput): unknown {
  const native = typeof input === "string" ? JSON.parse(input) : input;
  const uri = native.query?.uri as string;
  if (operation === "stat" && !uri.endsWith(".md")) return { uri, isDir: true };
  if (operation === "ls" && uri.endsWith("/experiences")) return [{ uri: memoryRoot + "/experiences/review.md", name: "review.md", isDir: false }];
  if (operation === "search" && native.body?.mode === "context") return fixtures.find(row => row.case === "search_context")!.result;
  if (operation === "list_tasks") return { items: [], has_more: false, next_cursor: null };
  return fixtures.find(row => row.case === operation)?.result ?? {};
}
function bridge(actions = ["memory.read", "memory.update", "memory.delete"]): MemoryBridge {
  return {
    ...projectBridge({ ...provider, operations: provider.operations.filter(op => actions.includes(op.permission)) }, { memory_uri: memoryRoot }),
    schema: async () => ({}),
    invoke: vi.fn(async (_, __, operation, input) => Response.json({ status: "ok", result: nativeResult(operation, input) })),
  };
}
function Driver({ memory }: { memory: MemoryBridge }) {
  navigate = useNavigate();
  const location = useLocation(); address = location.pathname + location.search;
  return <IntegratedApp memoryModules={[{...openVikingModule,Workspace:LegacyOpenVikingWorkspace}]} memory={memory} />;
}
async function render(path: string, memory = bridge()) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Driver memory={memory} /></MemoryRouter>));
  shadow = node.querySelector("[data-memory-console]")!.shadowRoot!;
  await settle(() => Boolean(shadow.querySelector(".ov-workspace")));
  return memory;
}
async function settle(predicate: () => boolean) {
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(predicate()).toBe(true);
  });
}
function button(label: string, scope: ParentNode = shadow): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string, scope: ParentNode = shadow) { await act(async () => button(label, scope).click()); }
async function value(selector: string, text: string, scope: ParentNode = shadow) {
  const field = scope.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  });
}
beforeEach(async () => {
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  await developerI18n.changeLanguage("en");
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
it("registers guided and native OV pages and restores file/layer deep links", async () => {
  const memory = await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`);
  await settle(() => shadow.textContent?.includes("Use small patches.") === true);
  expect(address).toContain("/memory/openviking/content?");
  expect(shadow.querySelectorAll('.sidebar .workspace-navigation a[href^="/memory/openviking/"]')).toHaveLength(15);
  await click("L0 · Abstract");
  await settle(() => vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "abstract"));
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "abstract")?.[3]).toEqual({ query: { uri: memoryRoot + "/preferences" } });
});
it("disables mutations for read-only subjects without hiding native content", async () => {
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`, bridge(["memory.read"]));
  await settle(() => shadow.textContent?.includes("Use small patches.") === true);
  expect(button("Edit content").disabled).toBe(true);
  expect(button("Reindex").disabled).toBe(true);
  expect(button("Download").disabled).toBe(false);
});
it("does not retry a dispatched write and exposes its uncertainty in the editor", async () => {
  const memory = bridge();
  const base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "write"
    ? Response.json({ error: { message: "connection lost", dispatched: true } }, { status: 502 })
    : base(...args));
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`, memory);
  await settle(() => !button("Edit content").disabled);
  await click("Edit content");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("textarea", "Updated preference", dialog);
  await click("Save", dialog);
  await settle(() => dialog.textContent?.includes("The write may have reached the service.") === true);
  expect(vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "write")).toHaveLength(1);
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "write")?.[3]).toEqual({ body: { uri: file, content: "Updated preference", mode: "replace", wait: false } });
});
it("keeps the edit draft and uncertainty warning when a successful write receipt is malformed", async () => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "write"
    ? Response.json({ status: "ok", result: null }) : base(...args));
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`, memory);
  await settle(() => !button("Edit content").disabled);
  await click("Edit content");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("textarea", "Keep this draft", dialog);
  await click("Save", dialog);
  await settle(() => dialog.textContent?.includes("The write may have reached the service.") === true);
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.querySelector("textarea")?.value).toBe("Keep this draft");
  expect(vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "write")).toHaveLength(1);
});
it.each([null, { unexpected: "not file text" }])("prevents editing malformed content %j", async result => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "read"
    ? Response.json({ status: "ok", result }) : base(...args));
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`, memory);
  await settle(() => shadow.textContent?.includes("The service returned an unexpected response.") === true);
  expect(button("Edit content").disabled).toBe(true);
  await click("Edit content");
  expect(shadow.querySelector("dialog[open]")).toBeNull();
  expect(vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "write")).toBe(false);
});
it.each([true, false])("locks the content draft until saving settles (success=%s)", async success => {
  const memory = bridge(), base = memory.invoke;
  let finish!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "write"
    ? new Promise<Response>(resolve => { finish = resolve; }) : base(...args));
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`, memory);
  await settle(() => !button("Edit content").disabled);
  await click("Edit content");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("textarea", "Submitted draft", dialog);
  await click("Save", dialog);
  expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  expect(button("Cancel", dialog).disabled).toBe(true);
  await click("Saving…", dialog);
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "write");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[3]).toMatchObject({ body: { content: "Submitted draft" } });
  await act(async () => finish(success
    ? Response.json({ result: nativeResult("write", {}) })
    : Response.json({ error: { message: "disconnected", dispatched: true } }, { status: 502 })));
  if (success) {
    expect(shadow.querySelector("dialog[open]")).toBeNull();
  } else {
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Submitted draft");
    expect(dialog.textContent).toContain("The write may have reached the service.");
  }
});
it("allows editing a legitimately empty file", async () => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "read"
    ? Response.json({ status: "ok", result: "" }) : base(...args));
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`, memory);
  await settle(() => !button("Edit content").disabled);
  await click("Edit content");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog.querySelector("textarea")?.value).toBe("");
  await value("textarea", "First content", dialog);
  await click("Save", dialog);
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "write")?.[3]).toMatchObject({ body: { content: "First content" } });
});
it.each(["list", "tree"])("keeps Previous available on an empty nonfirst %s page", async view => {
  const memory = bridge(), base = memory.invoke;
  const operation = "ls"; // Explorer loads directories lazily in both modes.
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => {
    const input = args[3] as { query?: { offset: number } };
    if (args[2] === operation) return Response.json({ result: input.query?.offset === 50 ? [] : fixtures.find(row => row.case === "ls")!.result });
    return base(...args);
  });
  await render(`/memory/openviking/content?project=project&userid=one&offset=50&view=${view}`, memory);
  await settle(() => shadow.querySelector(".ov-list-panel")?.textContent?.includes("No results") === true);
  expect(button("Previous").disabled).toBe(false);
  await click("Previous");
  await settle(() => shadow.querySelector(".ov-list-panel")?.textContent?.includes("editor.md") === true);
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === operation);
  expect(calls[calls.length - 1]?.[3]).toMatchObject({ query: { offset: 0 } });
});
it("clears resource query state, drafts and in-flight writes when switching subjects", async () => {
  const memory = bridge();
  const base = memory.invoke;
  let signal: AbortSignal | undefined;
  let finish!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => {
    if (args[2] !== "write") return base(...args);
    signal = args[4]; return new Promise<Response>(resolve => { finish = resolve; });
  });
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}&cursor=private&task=private`, memory);
  await settle(() => !button("Edit content").disabled);
  await click("Edit content");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("textarea", "private draft", dialog);
  await click("Save", dialog);
  await click("Saving…", dialog);
  expect(vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "write")).toHaveLength(1);
  await act(async () => {
    const target=[...shadow.querySelectorAll<HTMLButtonElement>('.sidebar-user-switcher .workspace-options button')].find(b=>b.textContent==='two')!;
    target.click();
  });
  await settle(() => address === "/memory/openviking/content?project=project&userid=two");
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json({ result: { status: "success" } })));
  expect(shadow.querySelector("dialog[open]")).toBeNull();
  expect(shadow.textContent).not.toContain("private draft");
});
it("uses context/archive endpoints and appends messages without calling a model", async () => {
  const memory = await render("/memory/openviking/sessions?project=project&userid=one&session=session-one");
  await settle(() => shadow.textContent?.includes("Previous conversation summary") === true);
  await value(".ov-composer textarea", "A new memory");
  await act(async () => shadow.querySelector("form.ov-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle(() => vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "add_message"));
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "add_message")?.[3]).toEqual({ path: { session_id: "session-one" }, body: { role: "user", content: "A new memory" } });
  await click("Archives");
  await click("Latest archive");
  await settle(() => shadow.textContent?.includes("Earlier conversation") === true);
  expect(vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "read")).toBe(false);
  expect(vi.mocked(memory.invoke).mock.calls.every(row => provider.operations.some(op => op.id === row[2]))).toBe(true);
});
it.each([{}, { session_id: 123 }])("keeps the creation dialog and requested ID after an invalid receipt %j", async result => {
  const memory = bridge(), base = memory.invoke;
  let finish!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "create_session"
    ? new Promise<Response>(resolve => { finish = resolve; }) : base(...args));
  await render("/memory/openviking/sessions?project=project&userid=one", memory);
  await click("Create session");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("input", "requested-id", dialog);
  await click("Create", dialog);
  expect(dialog.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
  await act(async () => finish(Response.json({ status: "ok", result })));
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.querySelector<HTMLInputElement>("input")?.disabled).toBe(false);
  expect(dialog.querySelector<HTMLInputElement>("input")?.value).toBe("requested-id");
  expect(dialog.textContent).toContain("The write may have reached the service.");
  expect(new URLSearchParams(address.split("?")[1]).has("session")).toBe(false);
  expect(vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "create_session")).toHaveLength(1);
});
it.each(["", "requested-id"])("opens the validated session returned after creating with ID '%s'", async requested => {
  const memory = await render("/memory/openviking/sessions?project=project&userid=one");
  await click("Create session");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("input", requested, dialog);
  await click("Create", dialog);
  expect(shadow.querySelector("dialog[open]")).toBeNull();
  expect(new URLSearchParams(address.split("?")[1]).get("session")).toBe("session-one");
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "create_session")?.[3]).toEqual(
    requested ? { body: { session_id: requested } } : {},
  );
});
it.each([
  { mode: "text", success: true }, { mode: "parts", success: true },
  { mode: "text", success: false }, { mode: "parts", success: false },
])("locks the complete message draft while sending $mode (success=$success)", async ({ mode, success }) => {
  const memory = bridge(), base = memory.invoke;
  let finish!: (response: Response) => void;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "add_message"
    ? new Promise<Response>(resolve => { finish = resolve; }) : base(...args));
  await render("/memory/openviking/sessions?project=project&userid=one&session=session-one", memory);
  const parts = [{ type: "text", text: "Submitted parts" }];
  await value(mode === "parts" ? ".ov-composer details textarea" : ".ov-composer textarea",
    mode === "parts" ? JSON.stringify(parts) : "Submitted message");
  await click("Append message");
  const fields = [...shadow.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>(".ov-composer textarea, .ov-composer select")];
  expect(fields).toHaveLength(3);
  expect(fields.every(field => field.disabled)).toBe(true);
  await click("Processing…", shadow.querySelector(".ov-composer")!);
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "add_message");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[3]).toEqual({ path: { session_id: "session-one" }, body: mode === "parts"
    ? { role: "user", parts } : { role: "user", content: "Submitted message" } });
  await act(async () => finish(success
    ? Response.json({ result: nativeResult("add_message", {}) })
    : Response.json({ error: { message: "disconnected", dispatched: true } }, { status: 502 })));
  expect(fields.every(field => !field.disabled)).toBe(true);
  const drafts = [...shadow.querySelectorAll<HTMLTextAreaElement>(".ov-composer textarea")].map(field => field.value);
  if (success) expect(drafts).toEqual(["", ""]);
  else {
    expect(drafts).toEqual(mode === "parts" ? ["", JSON.stringify(parts)] : ["Submitted message", ""]);
    expect(shadow.querySelector(".ov-workspace [role=alert]")?.textContent).toContain("The write may have reached the service.");
  }
});
it.each(["text", "parts"])("preserves conflicting message inputs until the user selects %s", async mode => {
  const memory = await render("/memory/openviking/sessions?project=project&userid=one&session=session-one");
  const parts = [{ type: "text", text: "Structured text" }];
  await value(".ov-composer textarea", "Message body");
  await value(".ov-composer details textarea", JSON.stringify(parts));
  const submit = async () => act(async () => {
    shadow.querySelector("form.ov-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await submit();
  expect(shadow.querySelector(".ov-composer [role=alert]")?.textContent).toContain("Use either message text or structured parts");
  expect(vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "add_message")).toBe(false);
  expect([...shadow.querySelectorAll<HTMLTextAreaElement>(".ov-composer textarea")].map(field => field.value)).toEqual(["Message body", JSON.stringify(parts)]);
  await value(mode === "text" ? ".ov-composer details textarea" : ".ov-composer textarea", "");
  await submit();
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "add_message");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[3]).toEqual({ path: { session_id: "session-one" }, body: mode === "text" ? { role: "user", content: "Message body" } : { role: "user", parts } });
  expect([...shadow.querySelectorAll<HTMLTextAreaElement>(".ov-composer textarea")].map(field => field.value)).toEqual(["", ""]);
});
it("does not let invalid commit retention disable session deletion", async () => {
  const memory = await render("/memory/openviking/sessions?project=project&userid=one&session=session-one");
  await click("Commit session");
  let dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  await value("input[type=number]", "-1", dialog);
  expect(button("Commit session", dialog).disabled).toBe(true);
  await act(async () => { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); });
  await click("Delete session");
  dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog.querySelector("input[type=number]")).toBeNull();
  expect(button("Delete session", dialog).disabled).toBe(false);
  await click("Delete session", dialog);
  expect(vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "delete_session")).toHaveLength(1);
  expect(vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "commit_session")).toBe(false);
});
it("shows a skipped commit without a task link", async () => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "commit_session"
    ? Response.json({ result: { status: "skipped", reason: "no_messages", task_id: null } }) : base(...args));
  await render("/memory/openviking/sessions?project=project&userid=one&session=session-one", memory);
  await click("Commit session");
  await click("Commit session", shadow.querySelector("dialog[open]")!);
  await settle(() => shadow.textContent?.includes("No new messages to commit.") === true);
  expect(shadow.querySelector(".ov-receipt button")).toBeNull();
});
it("renders assembled context entries and only links valid memory URIs", async () => {
  await render("/memory/openviking/retrieval?project=project&userid=one&method=search&mode=context&q=editor");
  await settle(() => shadow.querySelector(".ov-prose")?.textContent?.includes("Use small patches.") === true);
  expect(shadow.querySelectorAll(".ov-workspace table tbody tr")).toHaveLength(1);
});
it.each(["find", "search", "grep", "glob"])("refreshes unchanged %s submissions and sends changed queries once", async method => {
  const memory = bridge(), base = memory.invoke;
  let revision = 0;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === method
    ? Response.json({ result: { memories: [{ uri: file, abstract: `Result ${++revision}` }] } }) : base(...args));
  await render(`/memory/openviking/retrieval?project=project&userid=one&method=${method}&q=editor`, memory);
  await vi.waitFor(() => expect(shadow.querySelector(".ov-workspace table")?.textContent).toContain("Result 1"));
  const submit = async () => act(async () => {
    shadow.querySelector(".ov-workspace form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await submit();
  await vi.waitFor(() => expect(shadow.querySelector(".ov-workspace table")?.textContent).toContain("Result 2"));
  const unchangedAddress = address;
  await submit();
  await vi.waitFor(() => expect(shadow.querySelector(".ov-workspace table")?.textContent).toContain("Result 3"));
  expect(address).toBe(unchangedAddress);
  await value("input[name=q]", "updated query");
  await submit();
  await vi.waitFor(() => expect(shadow.querySelector(".ov-workspace table")?.textContent).toContain("Result 4"));
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === method);
  expect(calls).toHaveLength(4);
  expect(calls[calls.length - 1]?.[3]).toMatchObject({ body: { [method === "grep" || method === "glob" ? "pattern" : "query"]: "updated query" } });
});
it("clears page-specific pagination and filters when using sidebar navigation", async () => {
  await render("/memory/openviking/content?project=project&userid=one&offset=50&q=private&cursor=old");
  await act(async () => shadow.querySelector<HTMLAnchorElement>('.sidebar a[href^="/memory/openviking/sessions"]')!.click());
  await settle(() => address === "/memory/openviking/sessions?project=project&userid=one");
  await settle(() => shadow.querySelector(".ov-workspace table")?.textContent?.includes("session-one") === true);
});
it("shows pinned task timestamps, stage and execution history", async () => {
  await render("/memory/openviking/tasks?project=project&userid=one&task=task-one");
  await settle(() => shadow.textContent?.includes("stage_changed") === true);
  const workspace = shadow.querySelector(".ov-workspace")!;
  expect(workspace.textContent).toContain("2026-10-21T08:00:00+00:00");
  expect(workspace.textContent).toContain("extracting");
  expect(workspace.textContent).toContain("2026-10-21T08:00:01+00:00");
});
it.each([0, 7])("requires an explicit retention choice when resubmitting a commit, including %i", async keep => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "get_task"
    ? Response.json({ result: { task_id: "task-one", task_type: "session_commit", status: "failed", resource_id: "session-one" } }) : base(...args));
  await render("/memory/openviking/tasks?project=project&userid=one&task=task-one", memory);
  await settle(() => !button("Submit again").disabled);
  await click("Submit again");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog.textContent).toContain("0 archives all messages");
  expect(dialog.querySelector<HTMLInputElement>("input[type=number]")?.value).toBe("");
  expect(button("Submit", dialog).disabled).toBe(true);
  for (const invalid of ["-1", "10001", "1.5", ""]) {
    await value("input[type=number]", invalid, dialog);
    expect(button("Submit", dialog).disabled).toBe(true);
    await click("Submit", dialog);
  }
  expect(vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "commit_session")).toBe(false);
  await value("input[type=number]", String(keep), dialog);
  expect(button("Submit", dialog).disabled).toBe(false);
  await click("Submit", dialog);
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => row[2] === "commit_session");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[3]).toEqual({ path: { session_id: "session-one" }, body: { keep_recent_count: keep } });
});
it.each([file, "viking://resources/project/doc.md", "viking://agent/skills/tool.md"])("resubmits reindex for %s without requiring session retention", async resource => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === "get_task"
    ? Response.json({ result: { task_id: "task-one", task_type: "admin_reindex", status: "cancelled", resource_id: resource } }) : base(...args));
  await render(`/memory/openviking/tasks?project=project&userid=one&task=task-one&resource=${encodeURIComponent(resource)}`, memory);
  await settle(() => vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "list_tasks"));
  await settle(() => !button("Submit again").disabled);
  await click("Submit again");
  const dialog = shadow.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog.querySelector("input[type=number]")).toBeNull();
  expect(button("Submit", dialog).disabled).toBe(false);
  await click("Submit", dialog);
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "reindex")?.[3]).toEqual({ body: { uri: resource, wait: false } });
});

it.each(["find", "search", "grep", "glob"])("opens resource and skill results from %s with the project and user intact", async method => {
  const memory = bridge(), base = memory.invoke;
  const resource = "viking://resources/project/doc.md", skill = "viking://agent/skills/tool.md";
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => args[2] === method
    ? Response.json({ result: ["find", "search"].includes(method)
      ? { memories: [], resources: [{ uri: resource }], skills: [{ uri: skill }] }
      : { matches: [{ uri: resource }, { uri: skill }] } }) : base(...args));
  await render(`/memory/openviking/retrieval?project=project&userid=one&method=${method}&q=project`, memory);
  await settle(() => Boolean([...shadow.querySelectorAll("table button")].find(item => item.textContent === skill)));
  await click(resource);
  await settle(() => address.startsWith("/memory/openviking/content?"));
  const params = new URLSearchParams(address.split("?")[1]);
  expect(params.get("project")).toBe("project"); expect(params.get("userid")).toBe("one");
  expect(params.get("domain")).toBe("all"); expect(params.get("uri")).toBe(resource);
  await settle(() => vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "stat" && (row[3] as { query: { uri: string } }).query.uri === resource));
});
it("renders native tool result metadata and Unicode-offset reads", async () => {
  const memory = await render("/memory/openviking/sessions?project=project&userid=one&session=session-one&tab=tools&tool=tr_one&toolOffset=20000");
  await settle(() => shadow.textContent?.includes("Tool output tail") === true);
  expect(shadow.textContent).toContain("read_file");
  expect(vi.mocked(memory.invoke).mock.calls.find(row => row[2] === "read_tool_result")?.[3]).toMatchObject({ query: { offset: 20000 } });
});
it("polls cancellation to its native terminal state and stops polling when leaving the page", async () => {
  const memory = bridge(), base = memory.invoke;
  let status = "running";
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => {
    if (args[2] === "cancel_task") status = "cancelling";
    if (["cancel_task", "get_task"].includes(args[2])) return Response.json({ result: { task_id: "task-one", task_type: "session_commit", status, resource_id: "session-one" } });
    return base(...args);
  });
  await render("/memory/openviking/tasks?project=project&userid=one&task=task-one", memory);
  await settle(() => shadow.textContent?.includes("Running") === true);
  vi.useFakeTimers();
  await click("Request cancellation");
  await click("Submit", shadow.querySelector("dialog[open]")!);
  expect(shadow.querySelector(".ov-workspace .ifd-badge")?.textContent).toBe("Cancelling");
  expect(button("Request cancellation").disabled).toBe(true);
  status = "cancelled";
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(shadow.querySelector(".ov-workspace .ifd-badge")?.textContent).toBe("Cancelled");
  const count = vi.mocked(memory.invoke).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(vi.mocked(memory.invoke).mock.calls).toHaveLength(count);
  status = "running";
  await click("Refresh", shadow.querySelector(".ov-workspace > .ov-panel:last-child")!);
  await act(async () => navigate("/memory/openviking/retrieval?project=project&userid=one"));
  const afterLeaving = vi.mocked(memory.invoke).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(vi.mocked(memory.invoke).mock.calls).toHaveLength(afterLeaving);
});
it("rejects Peer experience deep links and translates the experience page", async () => {
  await developerI18n.changeLanguage("zh");
  const memory = await render(`/memory/openviking/experience?project=project&userid=one&experience=${encodeURIComponent("viking://user/subject/peers/reviewer/memories/experiences/review.md")}`);
  await settle(() => Boolean(shadow.querySelector('[role="alert"]')));
  expect(shadow.textContent).toContain("Self");
  expect(vi.mocked(memory.invoke).mock.calls.some(row => row[2] === "list_experience_trajectories" || row[2] === "get_experience_outcome_distribution")).toBe(false);
  expect(shadow.textContent).not.toMatch(/\bov\.\w+/);
});
it("does not show the experience pagination probe on both pages when directories are present", async () => {
  const memory = bridge(), base = memory.invoke;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => {
    if (args[2] !== "ls") return base(...args);
    return Response.json({ result: [
      { uri: memoryRoot + "/experiences/sub", name: "sub", isDir: true },
      ...Array.from({ length: 50 }, (_, index) => ({ uri: `${memoryRoot}/experiences/file-${index}.md`, name: `file-${index}.md`, isDir: false })),
    ] });
  });
  await render("/memory/openviking/experience?project=project&userid=one", memory);
  await settle(() => shadow.querySelectorAll(".ov-workspace table tbody tr").length === 49);
  expect(shadow.querySelector(".ov-workspace table")?.textContent).not.toContain("file-49.md");
  expect(button("Next").disabled).toBe(false);
});
it.each(["", "review"])("refreshes unchanged experience searches '%s' and sends changed queries once", async query => {
  const memory = bridge(), base = memory.invoke;
  let revision = 0;
  memory.invoke = vi.fn<MemoryBridge["invoke"]>(async (...args) => {
    if (!["ls", "find"].includes(args[2])) return base(...args);
    const rows = [{ uri: memoryRoot + "/experiences/review.md", name: `Result ${++revision}`, isDir: false }];
    return Response.json({ result: args[2] === "find" ? { memories: rows } : rows });
  });
  await render(`/memory/openviking/experience?project=project&userid=one&q=${query}`, memory);
  await settle(() => shadow.querySelector(".ov-workspace table")?.textContent?.includes("Result 1") === true);
  await click("Search");
  await settle(() => shadow.querySelector(".ov-workspace table")?.textContent?.includes("Result 2") === true);
  const unchangedAddress = address;
  await click("Search");
  await settle(() => shadow.querySelector(".ov-workspace table")?.textContent?.includes("Result 3") === true);
  expect(address).toBe(unchangedAddress);
  await value("input[name=q]", "updated query");
  await click("Search");
  await settle(() => shadow.querySelector(".ov-workspace table")?.textContent?.includes("Result 4") === true);
  const calls = vi.mocked(memory.invoke).mock.calls.filter(row => ["ls", "find"].includes(row[2]));
  expect(calls).toHaveLength(4);
  expect(calls[3]?.[3]).toEqual({ body: { query: "updated query", limit: 50, level: 2, target_uri: memoryRoot + "/experiences" } });
});

it("switches between rendered preview and source without losing the selected file", async () => {
  await render(`/memory/openviking/content?project=project&userid=one&uri=${encodeURIComponent(file)}`);
  await settle(() => shadow.textContent?.includes("Use small patches.") === true);
  await click("Source");
  expect(address).toContain("format=source");
  expect(shadow.querySelector(".ov-source-view")?.textContent).toContain("Use small patches.");
  await click("Preview");
  expect(shadow.querySelector(".ov-source-view")).toBeNull();
  expect(address).toContain(encodeURIComponent(file));
});
