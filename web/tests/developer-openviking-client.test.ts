import { memoryProject } from "./test/memory-project-fixtures";
import { describe, expect, it, vi } from "vitest";
import { fixtures, manifest } from "./test/openviking-fixtures";
import { createOVClient, memoryURI, ovOperations, parentMemoryURI, type OVClient } from "../src/memory/openviking/client";
import { memoryRequest, type MemoryWorkspaceContext } from "../src/memory/contracts";

const root = "viking://user/subject/memories", uri = `${root}/preferences/editor.md`, experience = `${root}/experiences/review.md`;
const provider = {
  provider: "openviking", version: manifest.version,
  operations: manifest.operations.map(operation => ({
    ...operation, permission: operation.method === "GET" || ["find", "search", "grep", "glob", "export_ovpack"].includes(operation.id)
      ? "memory.read" : operation.method === "DELETE" || operation.id === "mv" ? "memory.delete" : "memory.update",
  })),
};
function context(invoke: MemoryWorkspaceContext["invoke"]): MemoryWorkspaceContext {
  return {
    identity: "test", provider, signal: new AbortController().signal,
    project: memoryProject("openviking"), user: { project_id: "project", user_id: "one", provider, mapping: { memory_uri: root } },
    invoke, schema: async () => ({}),
  };
}
const actions: Record<string, (client: OVClient, signal: AbortSignal) => Promise<unknown>> = {
  ls: (c, s) => c.list(root, 0, false, s), tree: (c, s) => c.list(root, 0, true, s),
  stat: (c, s) => c.stat(uri, s), attrs: (c, s) => c.attrs(uri, s),
  read: (c, s) => c.read(uri, "read", s), abstract: (c, s) => c.read(uri, "abstract", s), overview: (c, s) => c.read(uri, "overview", s),
  download: (c, s) => c.download(uri, s), write: (c, s) => c.write(uri, "Use small patches.", s), reindex: (c, s) => c.reindex(uri, s),
  list_sessions: (c, s) => c.sessions(s), get_session: (c, s) => c.session("session-one", s),
  create_session: (c, s) => c.createSession("session-one", s), delete_session: (c, s) => c.deleteSession("session-one", s),
  get_session_context: (c, s) => c.context("session-one", s), get_session_archive: (c, s) => c.archive("session-one", "archive_001", s),
  add_message: (c, s) => c.addMessage("session-one", { role: "user", content: "Remember this." }, s),
  add_message_parts: (c, s) => c.addMessage("session-one", { role: "assistant", parts: [{ type: "text", text: "Understood." }] }, s),
  commit_session: (c, s) => c.commit("session-one", 1, s),
  list_tool_results: (c, s) => c.toolResults("session-one", "read_file", s),
  read_tool_result: (c, s) => c.toolResult("session-one", "tr_one", 20000, s),
  search_tool_result: (c, s) => c.searchToolResult("session-one", "tr_one", "needle", s),
  find: (c, s) => c.retrieve("find", { uri: root, query: "editor", limit: 10 }, s),
  search: (c, s) => c.retrieve("search", { uri: root, query: "editor", limit: 10 }, s),
  search_context: (c, s) => c.retrieve("search", { uri: root, query: "editor", limit: 10, mode: "context" }, s),
  search_peer_context: (c, s) => c.retrieve("search", { uri: "viking://user/subject/peers/reviewer/memories", query: "editor", limit: 10, mode: "context" }, s),
  grep: (c, s) => c.retrieve("grep", { uri: root, query: "editor", limit: 10 }, s),
  glob: (c, s) => c.retrieve("glob", { uri: root, query: "*.md", limit: 10 }, s),
  list_tasks: (c, s) => c.tasks("session_commit", "", "", "", s),
  get_task: (c, s) => c.task("task-one", s), cancel_task: (c, s) => c.cancelTask("task-one", s),
  list_experience_trajectories: (c, s) => c.trajectories(experience, 0, "2026-10-01", "2026-10-21", s),
  get_experience_outcome_distribution: (c, s) => c.outcomes(experience, "2026-10-01", "2026-10-21", s),
};

it("covers exactly the approved 30 operations without shrinking the native catalog", () => {
  expect(new Set(fixtures.map(row => row.operation))).toEqual(new Set(ovOperations));
  expect(ovOperations).toHaveLength(30); expect(manifest.operations).toHaveLength(76);
  expect(Object.keys(actions).sort()).toEqual(fixtures.map(row => row.case).sort());
});
describe("native request/response characterization", () => {
  it.each(fixtures)("$case", async fixture => {
    const invoke = vi.fn(async () => fixture.operation === "download"
      ? new Response(fixture.result as string, { headers: { "Content-Type": "application/octet-stream" } })
      : Response.json({ status: "ok", result: fixture.result }));
    const signal = new AbortController().signal;
    const result = await actions[fixture.case]!(createOVClient(context(invoke)), signal);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(fixture.operation, fixture.input, signal);
    expect(fixture.operation === "download" ? await (result as Blob).text() : result).toEqual(fixture.result);
  });
});
it.each([401, 403, 404, 409, 422, 429, 500])("preserves native %i failures and never retries a write", async status => {
  const invoke = vi.fn(async () => Response.json({ status: "error", error: { code: "NATIVE", message: "native failure", details: { reason: "retained" } } }, { status }));
  await expect(createOVClient(context(invoke)).commit("one", 0)).rejects.toMatchObject({
    kind: "native", status, message: "native failure", details: { error: { details: { reason: "retained" } } },
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("retains dispatched uncertainty, including body transport failures", async () => {
  const invoke = vi.fn(async () => Response.json({ error: { code: "transport", message: "interrupted", dispatched: true } }, { status: 502 }));
  await expect(createOVClient(context(invoke)).write(uri, "text")).rejects.toMatchObject({ dispatched: true });
  const broken = context(async () => new Response(new ReadableStream({ start(output) { output.error(new Error("disconnected")); } })));
  await expect(createOVClient(broken).commit("one", 0)).rejects.toMatchObject({ kind: "transport", dispatched: true });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("treats native write failures as possibly dispatched while honoring platform preflight rejection", async () => {
  const native = createOVClient(context(async () => Response.json({ status: "error", error: { code: "INTERNAL", message: "index failed after save" } }, { status: 500 })));
  await expect(native.write(uri, "text")).rejects.toMatchObject({ dispatched: true, status: 500 });
  const preflight = createOVClient(context(async () => Response.json({ error: { code: "configuration", message: "not sent", dispatched: false } }, { status: 503 })));
  await expect(preflight.write(uri, "text")).rejects.toMatchObject({ dispatched: false, status: 503 });
});
it.each(["write", "reindex", "create_session", "commit_session", "cancel_task"])("preserves dispatched uncertainty for malformed successful %s receipts", async id => {
  const invoke = vi.fn(async () => Response.json({ status: "ok", result: null }));
  await expect(actions[id]!(createOVClient(context(invoke)), new AbortController().signal)).rejects.toMatchObject({
    kind: "invalidResponse", status: 200, dispatched: true,
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("retains dispatch status when cancellation receipt fields are missing", async () => {
  const client = createOVClient(context(async () => Response.json({ status: "ok", result: { status: "cancelling" } })));
  await expect(client.cancelTask("one")).rejects.toMatchObject({ kind: "invalidResponse", status: 200, dispatched: true });
});
it.each([{}, { session_id: 123 }, { session_id: null }, { session_id: "" }, { session_id: "   " }])("rejects unusable session creation identities %j without retrying", async result => {
  const invoke = vi.fn(async () => Response.json({ status: "ok", result }));
  await expect(createOVClient(context(invoke)).createSession("requested-id")).rejects.toMatchObject({
    kind: "invalidResponse", status: 200, dispatched: true,
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it.each([null, {}, { content: null }, { content: 42 }, []])("rejects invalid read content %j without treating it as an empty file", async result => {
  const client = createOVClient(context(async () => Response.json({ status: "ok", result })));
  await expect(client.read(uri, "read")).rejects.toMatchObject({ kind: "invalidResponse", status: 200, dispatched: false });
});
it.each(["", { content: "" }, "Body", { content: "Body" }])("accepts validated text including empty content %j", async result => {
  const client = createOVClient(context(async () => Response.json({ status: "ok", result })));
  await expect(client.read(uri, "read")).resolves.toBe(typeof result === "string" ? result : result.content);
});
it("keeps skipped commits and cooperative cancellation in their actual native states", async () => {
  const client = createOVClient(context(async id => Response.json({ status: "ok", result: id === "commit_session"
    ? { status: "skipped", reason: "no_messages", task_id: null }
    : { task_id: "one", status: "cancelling" } })));
  expect(await client.commit("one", 0)).toEqual({ status: "skipped", reason: "no_messages", task_id: null });
  expect(await client.cancelTask("one")).toEqual({ task_id: "one", status: "cancelling" });
});
it.each([
  ["get_task", {}], ["get_session", {}], ["stat", { uri }],
  ["list_tasks", { items: [], has_more: true, next_cursor: "same" }],
  ["list_tasks", { items: [], has_more: true, next_cursor: "" }],
  ["ls", [{ name: "missing URI" }]],
])("rejects malformed %s shapes", async (id, result) => {
  const client = createOVClient(context(async () => Response.json({ status: "ok", result })));
  const call = id === "list_tasks" ? client.tasks("session_commit", "", "", "same") : actions[id as string]!(client, new AbortController().signal);
  await expect(call).rejects.toMatchObject({ kind: "invalidResponse" });
});
it("checks catalog and subject permission before dispatch", async () => {
  const invoke = vi.fn();
  const base = context(invoke);
  const readOnly = createOVClient({ ...base, provider: { ...provider, operations: provider.operations.filter(op => op.id !== "write") } });
  expect(readOnly.can("find")).toBe(true); expect(readOnly.can("write")).toBe(false);
  await expect(readOnly.write(uri, "text")).rejects.toMatchObject({ kind: "unsupported" });
  await expect(createOVClient({ ...base, provider: { ...provider, operations: [] } }).read(uri, "read")).rejects.toMatchObject({ kind: "unsupported" });
  expect(invoke).not.toHaveBeenCalled();
});
it("cancels a streamed download when the subject context retires", async () => {
  const lifetime = new AbortController();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const base = context((_, __, signal) => memoryRequest(lifetime.signal, signal, async () =>
    new Response(new ReadableStream({ start(output) { stream = output; } }))));
  const pending = createOVClient({ ...base, signal: lifetime.signal }).download(uri);
  await vi.waitFor(() => expect(stream).toBeDefined());
  lifetime.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("keeps specific context filters ANDed with the URI selection", async () => {
  const invoke = vi.fn(async () => Response.json({ result: { entries: [], rendered: "" } }));
  const filter = { op: "must", field: "category", conds: ["preferences"] };
  await createOVClient(context(invoke)).retrieve("search", { uri: root, query: "editor", limit: 10, mode: "context", filter });
  expect(invoke.mock.calls[0]).toEqual(["search", { body: expect.objectContaining({
    filter: { op: "and", conds: [filter, { op: "must", field: "uri", conds: [root], para: "-d=-1" }] },
  }) }, undefined]);
});
it("accepts only Self and explicit Peer memory paths in UI navigation", () => {
  for (const path of [root, uri, "viking://user/subject/peers/reviewer/memories/doc.md"]) expect(memoryURI(root, path)).toBe(true);
  for (const path of ["viking://resources", "viking://user/other/memories", "viking://user/subject/sessions/s", root + "/../sessions", root + "/%2e%2e/a", root + "/a?path=b", "viking://user/subject/peers"]) expect(memoryURI(root, path)).toBe(false);
  expect(parentMemoryURI(root, root)).toBe(root);
});

it("navigates from top-level Viking directories back to the all-domain root", () => {
  for (const uri of ["viking://resources", "viking://resources/", "viking://user", "viking://agent"])
    expect(parentMemoryURI("viking://", uri)).toBe("viking://");
  expect(parentMemoryURI("viking://", "viking://")).toBe("viking://");
  expect(parentMemoryURI("viking://", "viking://agent/skills")).toBe("viking://agent");
});
