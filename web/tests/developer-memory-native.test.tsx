import { memoryProject } from "./test/memory-project-fixtures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../src/i18n/index";
import { NativeOperations, nativeGroup } from "../src/memory/NativeOperations";
import { NativeWritesProvider } from "../src/memory/NativeWrites";
import type { MemoryOperation, MemoryWorkspaceContext } from "../src/memory/contracts";
import manifest from "../../internal/profiles/openviking/manifest.json";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root, lifetime: AbortController;
const operation = (id: string, permission = "memory.read"): MemoryOperation => ({ id, permission, method: "POST", path: "/native", description: id, request_media: ["application/json"] });
function context(op = operation("search")): MemoryWorkspaceContext {
  return { identity: "subject-one", provider: { provider: "openviking", version: "0.5.0", operations: [op], }, project: memoryProject("openviking"), user: { project_id: "project", user_id: "one", provider: { provider: "openviking", version: "0.5.0", operations: [op] }, mapping: { user_uri: "viking://user/one" } }, signal: lifetime.signal,
    schema: vi.fn(async () => ({ type: "object" })), invoke: vi.fn(async () => new Response('{"large":9223372036854775807}', { headers: { "Content-Type": "application/json", "X-Memory-Native-Status": "200" } })) };
}
async function render(ctx: MemoryWorkspaceContext) { await act(async () => root.render(<I18nextProvider i18n={i18n}><NativeWritesProvider><NativeOperations key={ctx.identity} context={ctx} /></NativeWritesProvider></I18nextProvider>)); }
async function submit() { await act(async () => { node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
async function input(value: string) {
  await act(async () => {
    const field = node.querySelector<HTMLTextAreaElement>('textarea[aria-label="Native request JSON"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => { node = document.createElement("div"); document.body.append(node); root = createRoot(node); lifetime = new AbortController(); await i18n.changeLanguage("en"); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("discovers all admitted native operations and groups restored domains", () => {
  const ops = manifest.operations.map(op => ({ ...op, permission: "memory.read" })) as MemoryOperation[];
  expect(ops).toHaveLength(76);
  const ids = (group: string) => ops.filter(op => nativeGroup(op) === group).map(op => op.id);
  expect(ids("skills")).toEqual(expect.arrayContaining(["add_skill", "get_skill", "find_skills", "validate_skill"]));
  expect(ids("resources")).toEqual(expect.arrayContaining(["add_resource", "temp_upload", "resolve_assets", "preflight_asset"]));
  expect(ids("privacy")).toHaveLength(7); expect(ids("watches")).toHaveLength(8); expect(ids("settings")).toHaveLength(3);
});
it("preserves native numeric literals and provider errors without replaying writes", async () => {
  const ctx = { ...context(operation("upsert_privacy_config", "memory.update")), invoke: vi.fn(async () => new Response('{"native_error":9223372036854775807}', { status: 422, headers: { "Content-Type": "application/json", "X-Memory-Native-Status": "422" } })) };
  await render(ctx);
  const raw = '{"body":{"native_number":9223372036854775807,"optional":null,"enabled":false}}';
  await input(raw); await submit();
  expect(ctx.invoke).toHaveBeenCalledTimes(1); expect(vi.mocked<MemoryWorkspaceContext["invoke"]>(ctx.invoke).mock.calls[0]?.[1]).toBe(raw);
  expect(node.textContent).toContain('"native_error":9223372036854775807'); expect(node.textContent).toContain("HTTP 422");
});
it("uploads files using native multipart fields", async () => {
  const ctx = context({ ...operation("temp_upload", "memory.update"), request_media: ["multipart/form-data"] }); await render(ctx);
  const file = new File(["native bytes"], "sample.txt", { type: "text/plain" });
  await act(async () => { const field = node.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(field, "files", { value: [file] }); field.dispatchEvent(new Event("change", { bubbles: true })); });
  await submit(); const args = vi.mocked(ctx.invoke).mock.calls[0]!; expect(args[1]).toBe("{}"); expect(args[3]?.get("file")).toBe(file);
});
it("defers permission checks to the provider and discards late data after a user switch", async () => {
  const ctx = context(operation("rm", "memory.delete")); await render(ctx); await submit(); expect(ctx.invoke).toHaveBeenCalledOnce();
  let deliver!: (value: Response) => void;
  const readable = { ...context(), identity: "reader", invoke: vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })) }; await render(readable);
  await submit();
  await render({ ...context(), identity: "subject-two" });
  await act(async () => deliver(new Response("old private result")));
  expect(node.textContent).not.toContain("old private result");
});

it.each(["success", "failure"])("keeps a pending write alive across language changes: %s", async outcome => {
  let finish!: () => void, requestSignal: AbortSignal | undefined;
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>((_operation, _input, signal) => {
    requestSignal = signal;
    return new Promise<Response>((resolve, reject) => {
      finish = () => outcome === "success" ? resolve(Response.json({ saved: true }, { headers: { "X-Memory-Native-Status": "200" } })) : reject(new Error("connection lost"));
    });
  });
  const ctx = { ...context(operation("upsert_privacy_config", "memory.update")), invoke };
  await render(ctx);
  const raw = '{"body":{"value":"keep my draft"}}';
  await input(raw); await submit();
  expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => { await i18n.changeLanguage("zh"); });
  expect(requestSignal?.aborted).toBe(false);
  expect(ctx.schema).toHaveBeenCalledTimes(1);
  expect(node.querySelector("textarea")!.value).toBe(raw);
  await act(async () => finish());
  expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
  if (outcome === "success") expect(node.textContent).toContain('"saved":true');
  else expect(node.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("nativeMemory.uncertain"));
});

async function selectOperation(id: string) {
  await act(async () => {
    const field = node.querySelector<HTMLSelectElement>("select")!;
    field.value = id; field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it.each(["success", "failure"])("blocks operation switching until a pending write settles: %s", async outcome => {
  let finish!: () => void, requestSignal: AbortSignal | undefined;
  const first = operation("upsert_privacy_config", "memory.update"), second = operation("search");
  const base = context(first);
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>((_operation, _input, signal) => {
    requestSignal = signal;
    return new Promise<Response>((resolve, reject) => {
      finish = () => outcome === "success" ? resolve(Response.json({ saved: true }, { headers: { "X-Memory-Native-Status": "200" } })) : reject(new Error("connection lost"));
    });
  });
  await render({ ...base, provider: { ...base.provider, operations: [first, second] }, invoke });
  const raw = '{"body":{"value":"pending change"}}';
  await input(raw); await submit();
  expect(node.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
  // Also guard the change handler: synthetic events can bypass native disabled.
  await selectOperation(second.id);
  expect(node.querySelector<HTMLSelectElement>("select")!.value).toBe(first.id);
  expect(node.querySelector("textarea")!.value).toBe(raw);
  expect(requestSignal?.aborted).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(node.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false);
  expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  if (outcome === "success") expect(node.textContent).toContain('"saved":true');
  else expect(node.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("nativeMemory.uncertain"));
  await selectOperation(second.id);
  expect(node.querySelector<HTMLSelectElement>("select")!.value).toBe(second.id);
});
it("allows switching away from a read without letting its late result unlock a new write", async () => {
  const read = operation("search"), write = operation("upsert_privacy_config", "memory.update"), base = context(read);
  let finishRead!: (response: Response) => void, finishWrite!: (response: Response) => void, readSignal: AbortSignal | undefined;
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>((id, _input, signal) => new Promise<Response>(resolve => {
    if (id === read.id) { readSignal = signal; finishRead = resolve; }
    else finishWrite = resolve;
  }));
  await render({ ...base, provider: { ...base.provider, operations: [read, write] }, invoke });
  await submit();
  expect(node.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false);
  await selectOperation(write.id);
  expect(readSignal?.aborted).toBe(true);
  expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await submit();
  await act(async () => finishRead(new Response("retired read")));
  expect(node.textContent).not.toContain("retired read");
  expect(node.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
  await act(async () => finishWrite(Response.json({ saved: true }, { headers: { "X-Memory-Native-Status": "200" } })));
  expect(node.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it.each([
  { status: 200, media: "application/octet-stream" },
  { status: 422, media: "application/octet-stream" },
  { status: 502, media: "application/octet-stream" },
  { status: 200, media: "text/plain;charset=iso-8859-1" },
  { status: 422, media: "text/plain;charset=iso-8859-1" },
])("downloads original bytes and media type for HTTP $status $media", async ({ status, media }) => {
  // Same invalid UTF-8 byte sequence as the native HTTP wire-contract fixture.
  const original = new Uint8Array([0x00, 0xff, 0x0a]);
  let downloaded: Blob | undefined;
  const createURL = vi.fn((blob: Blob | MediaSource) => { downloaded = blob as Blob; return "blob:native-response"; });
  const revokeURL = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createURL; static revokeObjectURL = revokeURL; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const ctx = { ...context(), invoke: vi.fn(async () => new Response(original, {
    status, headers: { "Content-Type": media, "X-Memory-Native-Status": String(status) },
  })) };
  await render(ctx); await submit();
  const download = [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("nativeMemory.download"))!;
  await act(async () => download.click());
  expect(createURL).toHaveBeenCalledTimes(1);
  // The pre-fix text fallback is a jsdom Blob; fetch returns a native Blob.
  const bytes = typeof downloaded!.arrayBuffer === "function" ? await downloaded!.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(downloaded!);
    });
  expect(new Uint8Array(bytes)).toEqual(original);
  expect(downloaded!.type).toBe(media);
  expect(click).toHaveBeenCalledTimes(1);
  expect(revokeURL).toHaveBeenCalledWith("blob:native-response");
  expect(ctx.invoke).toHaveBeenCalledTimes(1);
});
