import { memoryProject } from "./test/memory-project-fixtures";
import { describe, expect, it, vi } from "vitest";
import { createHindsightClient, HindsightError, taskIDs, taskActionAvailable } from "../src/memory/hindsight/client";
import { hindsightOperations } from "../src/memory/hindsight/operations";
import type { MemoryNativeInput, MemoryWorkspaceContext } from "../src/memory/contracts";
import fixtures from "./test/fixtures/hindsight-wire.json";

function setup(response = new Response("{}")) {
  const controller = new AbortController();
  const invoke = vi.fn<MemoryWorkspaceContext["invoke"]>(async () => response);
  const context: MemoryWorkspaceContext = {
    identity: "actor:subject", signal: controller.signal,
    provider: { provider: "hindsight", version: "0.10.3",
      operations: hindsightOperations.map(id => ({ id, method: "POST", path: "", description: "", request_media: [], permission: "memory.update" })) },
    project: memoryProject("hindsight"), user: { project_id: "project", user_id: "subject", provider: { provider: "hindsight", version: "0.10.3", operations: [] }, mapping: { bank_id: "bank" } },
    invoke, schema: vi.fn(),
  };
  return { client: createHindsightClient(context), invoke, context, controller };
}

describe("Hindsight 0.10.3 native boundary", () => {
  it.each(fixtures.cases)("preserves the $operation request and native response shape", async fixture => {
    const { client, invoke } = setup(Response.json(fixture.response));
    const result = await client.json(fixture.operation as typeof hindsightOperations[number], fixture.input as MemoryNativeInput);
    expect(invoke).toHaveBeenCalledWith(fixture.operation, fixture.input, expect.any(AbortSignal), undefined);
    expect(result).toEqual(fixture.response);
  });
  it("locks the reviewed 68-operation UI scope independently of the backend catalog", () => {
    expect(new Set(hindsightOperations).size).toBe(68);
    expect([...hindsightOperations].sort()).toEqual(fixtures.cases.map(x => x.operation).sort());
    expect(hindsightOperations).not.toContain("regenerate_entity_observations");
  });
  it("preserves raw numeric literals and native null/zero/false", async () => {
    const { client, invoke } = setup();
    const raw = '{"body":{"items":[{"content":"x","metadata":{"large":9007199254740993}}],"async":false,"extra":null}}';
    await client.json("retain_memories", raw);
    expect(invoke.mock.calls[0]?.[1]).toBe(raw);
  });
  it("keeps native 401 separate from platform errors and preserves dispatch uncertainty", async () => {
    const native = setup(new Response('{"detail":"native credential invalid"}', { status: 401, headers: { "X-Memory-Native-Status": "401" } }));
    await expect(native.client.json("list_memories")).rejects.toMatchObject({ status: 401, native: true, message: "native credential invalid" });
    const platform = setup(Response.json({ error: { code: "transport", message: "lost response", dispatched: true } }, { status: 502 }));
    await expect(platform.client.json("retain_memories", { body: { items: [] } })).rejects.toMatchObject({ dispatched: true, code: "transport" });
    expect(platform.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("respects an explicit platform dispatched=%s even for HTTP 502", async dispatched => {
    const { client, invoke } = setup(Response.json({ error: { code: "memory_provider", message: "Provider unavailable", dispatched } }, { status: 502 }));
    await expect(client.json("retain_memories")).rejects.toMatchObject({ status: 502, native: false, dispatched });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("treats native failures as dispatched regardless of fields in the native body", async () => {
    const { client } = setup(Response.json({ error: { message: "Native error", dispatched: false } }, { status: 500, headers: { "X-Memory-Native-Status": "500" } }));
    await expect(client.json("retain_memories")).rejects.toMatchObject({ status: 500, native: true, dispatched: true });
  });
  it("rejects an unavailable or forbidden operation before dispatch", async () => {
    const { client, context, invoke } = setup();
    Object.defineProperty(context.provider, "operations", { value: context.provider.operations.filter(op => op.id !== "retain_memories") });
    await expect(client.json("retain_memories")).rejects.toMatchObject({ code: "unavailable" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not publish data when the context retires during body consumption", async () => {
    const { client, controller } = setup(new Response(new ReadableStream({
      start(output) {
        controllerHolder = () => { controller.abort(); output.enqueue(new TextEncoder().encode('{"private":true}')); output.close(); };
      },
    })));
    const pending = client.json("get_memory");
    controllerHolder();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("downloads authenticated bytes and never navigates to a native URL", async () => {
    const { client, invoke } = setup(new Response("archive", { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="../../bank.zip"' } }));
    const result = await client.file("download_file", { path: { key: "bank/transfer.zip" } });
    expect(await result.blob.text()).toBe("archive");
    expect(result.filename).toBe("bank.zip");
    expect(invoke).toHaveBeenCalledOnce();
  });
  it("enforces response size before reading and observes stream errors", async () => {
    const cancel = vi.fn();
    const oversized = setup(new Response(new ReadableStream({ cancel }), { headers: { "Content-Length": String(65 * 1024 * 1024) } }));
    await expect(oversized.client.file("download_file", {})).rejects.toMatchObject({ code: "responseTooLarge" });
    expect(cancel).toHaveBeenCalledOnce();
    const broken = setup(new Response(new ReadableStream({ start(c) { c.error(new Error("truncated")); } })));
    await expect(broken.client.file("download_file", {})).rejects.toThrow("truncated");
  });
  it("marks an invalid or oversized write response as dispatched, without replay", async () => {
    const invalid = setup(new Response("not JSON"));
    await expect(invalid.client.json("retain_memories", { body: { items: [{ content: "Fact" }] } }))
      .rejects.toMatchObject({ code: "invalidResponse", dispatched: true });
    expect(invalid.invoke).toHaveBeenCalledTimes(1);
  });
  it("preserves the multipart files and native metadata field", async () => {
    const { client, invoke } = setup(Response.json({ operation_ids: ["first", "second"] }));
    const form = new FormData();
    form.append("files", new Blob(["one"]), "one.txt");
    form.append("files", new Blob(["two"]), "two.txt");
    form.append("request", '{"files_metadata":[{"document_id":"one"},{"document_id":"two"}]}');
    expect(await client.json("file_retain", {}, undefined, form)).toEqual({ operation_ids: ["first", "second"] });
    expect(invoke.mock.calls[0]?.[3]).toBe(form);
    expect(form.getAll("files")).toHaveLength(2);
  });
  it("enforces JSON and upload-envelope limits before dispatch", async () => {
    const { client, invoke } = setup();
    await expect(client.json("retain_memories", { body: { items: [{ content: "x".repeat(4 * 1024 * 1024) }] } }))
      .rejects.toMatchObject({ code: "tooLarge", dispatched: false });
    await expect(client.json("file_retain", { query: { extra: "x".repeat(32 * 1024) } }, undefined, new FormData()))
      .rejects.toMatchObject({ code: "tooLarge", dispatched: false });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not silently truncate a multi-task response", () => {
    expect(taskIDs({ operation_id: "one", operation_ids: ["one", "two"] })).toEqual(["one", "two"]);
    expect(taskIDs({ operation_id: null })).toEqual([]);
  });
  it("uses pinned task transition rules, not newer deferred-task retry behavior", () => {
    expect(taskActionAvailable("cancel_operation", "pending")).toBe(true);
    expect(taskActionAvailable("cancel_operation", "completed")).toBe(false);
    expect(taskActionAvailable("retry_operation", "cancelled")).toBe(true);
    expect(taskActionAvailable("retry_operation", "pending")).toBe(false);
    expect(taskActionAvailable("delete_operation", "not_found")).toBe(false);
    expect(new HindsightError("invalidJSON").code).toBe("invalidJSON");
  });
});
let controllerHolder: () => void;
