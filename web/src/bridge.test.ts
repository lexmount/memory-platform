// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryBridge, useMemoryBridge } from "./bridge";
import { memoryRequest, type MemoryBridge } from "./memory/contracts";
import { memoryModuleRegistry } from "./memory/registry";

const user = "external-user";
const signal = () => new AbortController().signal;
function transport() { return createMemoryBridge("opaque-epoch", () => true); }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("uses direct user routes and pinned identity while preserving raw JSON, native 401 and response bytes", async () => {
  const { bridge } = transport();
  const fetch = vi.fn(async () => new Response(new Uint8Array([0, 255, 10]), {
    status: 401, headers: { "X-Memory-Native-Status": "401", "Content-Type": "application/octet-stream", "Retry-After": "4" },
  }));
  vi.stubGlobal("fetch", fetch);
  const result = await bridge.invoke("project", user, "read", '{"body":{"number":9223372036854775807,"optional":null}}', signal());
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url, window.location.origin).pathname).toBe("/v1/projects/project/requests/read");
  expect(new Headers(options.headers).has("Authorization")).toBe(false);
  expect(new Headers(options.headers).has("X-GoClaw-Tenant-Id")).toBe(false);
  expect(options.body).toContain("9223372036854775807");
  expect(JSON.parse(String(options.body))).not.toHaveProperty("scope");
  expect(new Headers(options.headers).get("X-User-Id")).toBe(user);
  expect(result.status).toBe(401); expect(result.headers.get("Retry-After")).toBe("4");
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([0, 255, 10]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['{},"scope":{"type":"user","id":"another-subject"}', "null", "[]"])(
  "rejects native input fragments before they can replace the host scope: %s", async input => {
    const { bridge } = transport();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(bridge.invoke("project", user, "write", input, signal())).rejects.toBeInstanceOf(Error);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("keeps the same account usable and retires callbacks on an account change", async () => {
 let identity = "first";
 const fetch = vi.fn(async () => Response.json({ providers: [] })); vi.stubGlobal("fetch", fetch);
 const root = createRoot(document.createElement("div")); let active!: MemoryBridge;
 function Probe() { active = useMemoryBridge(identity); return null; }
 try {
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  const first = active; await expect(first.providers(signal())).resolves.toEqual([]);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe)))); expect(active).toBe(first);
  identity = "second";
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  expect(active.identity).not.toBe(first.identity);
  await expect(first.providers(signal())).rejects.toMatchObject({ name: "AbortError" });
  await expect(active.providers(signal())).resolves.toEqual([]);
 } finally { await act(async () => root.unmount()); }
});

it("passes original multipart data with query envelope, and never retries lost writes", async () => {
  const { bridge } = transport();
  const fetch = vi.fn(async () => new Response("accepted", { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  const form = new FormData(); form.append("file", new Blob(["native"]), "memory.txt");
  const result = await bridge.invoke("project", user, "upload", {}, signal(), form);
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url, "https://workspace.example").searchParams.get("request")).toBe("{}");
  expect(options.body).toBe(form); expect(new Headers(options.headers).has("Content-Type")).toBe(false);
  expect(result.status).toBe(202); await result.text();
  fetch.mockRejectedValueOnce(new TypeError("network interrupted"));
  await expect(bridge.invoke("project", user, "retain_memories", {}, signal())).rejects.toThrow("network interrupted");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("aborts pending work, rejects retired callbacks and fences an ignored late response", async () => {
  const { bridge, dispose } = transport();
  let deliver!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const pending = bridge.invoke("project", user, "read", {}, signal()).catch(error => error);
  const options = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
  dispose(); expect(options.signal?.aborted).toBe(true);
  deliver(new Response("old private body"));
  expect(await pending).toMatchObject({ name: "AbortError" });
  await expect(bridge.providers(signal())).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["workspace", "caller"] as const)("stops waiting on %s cancellation when the transport never settles", async source => {
  const lifetime = new AbortController();
  const caller = new AbortController();
  let transportSignal!: AbortSignal;
  const rejected = vi.fn();
  const cleanup = vi.fn();
  void memoryRequest(lifetime.signal, caller.signal, linked => {
    transportSignal = linked;
    return new Promise<Response>(() => {});
  }).then(() => { throw new Error("Retired request resolved"); }, rejected).finally(cleanup);

  (source === "workspace" ? lifetime : caller).abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(transportSignal.aborted).toBe(true);
  expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
  expect(cleanup).toHaveBeenCalledOnce();
});

it("forwards cancellation to a cooperative transport", async () => {
  const lifetime = new AbortController();
  const stopped = vi.fn();
  const pending = memoryRequest(lifetime.signal, undefined, linked => new Promise<Response>((_, reject) => {
    linked.addEventListener("abort", () => { stopped(); reject(linked.reason); }, { once: true });
  }));
  lifetime.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(stopped).toHaveBeenCalledOnce();
});

it.each(["stalled", "failed"] as const)("discards late responses without waiting for %s body cleanup", async mode => {
  const lifetime = new AbortController();
  let deliver!: (response: Response) => void;
  const rejected = vi.fn();
  void memoryRequest(lifetime.signal, undefined, () => new Promise<Response>(resolve => { deliver = resolve; }))
    .then(() => { throw new Error("Retired request resolved"); }, rejected);
  lifetime.abort();
  const cancel = vi.fn(() => mode === "stalled" ? new Promise<void>(() => {}) : Promise.reject(new Error("cleanup failed")));
  deliver(new Response(new ReadableStream({ cancel })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cancel).toHaveBeenCalledOnce();
  expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
});

it("observes a late transport rejection after the caller has stopped waiting", async () => {
  const lifetime = new AbortController();
  let fail!: (reason: Error) => void;
  const rejected = vi.fn();
  void memoryRequest(lifetime.signal, undefined, () => new Promise<Response>((_, reject) => { fail = reject; }))
    .then(() => { throw new Error("Retired request resolved"); }, rejected);
  lifetime.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
  fail(new Error("late provider failure"));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(rejected).toHaveBeenCalledOnce();
});

it.each(["stalled", "failed"] as const)("rejects a stale bridge identity without waiting for %s response cleanup", async mode => {
  let current = true;
  const { bridge } = createMemoryBridge("identity-guard", () => current);
  let deliver!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })));
  const rejected = vi.fn();
  void bridge.invoke("project", user, "read", {}, signal())
    .then(() => { throw new Error("Stale identity resolved"); }, rejected);
  current = false;
  const cancel = vi.fn(() => mode === "stalled" ? new Promise<void>(() => {}) : Promise.reject(new Error("cleanup failed")));
  deliver(new Response(new ReadableStream({ cancel })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cancel).toHaveBeenCalledOnce();
  expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
});

it("keeps the lifetime fence active after headers while a native body is streaming", async () => {
  const lifetime = new AbortController();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const response = await memoryRequest(lifetime.signal, undefined, async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { source = controller; }, cancel,
  }), { status: 202 }));
  const reading = response.text().catch(error => error);
  source.enqueue(new TextEncoder().encode("private"));
  lifetime.abort();
  expect(await reading).toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("does not deliver prefetched native body bytes to a retired workspace", async () => {
  const lifetime = new AbortController();
  const cancel = vi.fn();
  const response = await memoryRequest(lifetime.signal, undefined, async () => new Response(new ReadableStream<Uint8Array>({
    start(output) { output.enqueue(new TextEncoder().encode("private-old")); },
    cancel,
  })));
  // Allow the source/transport's eager reads to queue data before retirement.
  await new Promise(resolve => setTimeout(resolve, 0));
  lifetime.abort();
  await expect(response.body!.getReader().read()).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("rejects duplicate module identities and invalid navigation at composition time", () => {
  expect(memoryModuleRegistry([]).size).toBe(0);
  const module = { id: "test", labelKey: "test", defaultPage: "missing", navigation: [], Workspace: () => null };
  expect(() => memoryModuleRegistry([module])).toThrow("navigation");
  expect(() => memoryModuleRegistry([{ ...module, id: "../test" }])).toThrow("Invalid");
});
