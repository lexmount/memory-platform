import type { MemoryNativeInput, MemoryWorkspaceContext } from "../contracts";

// UI coverage, not a replacement for the server's 42-operation allowlist.
export const ovOperations = [
  "ls", "tree", "stat", "attrs", "read", "abstract", "overview", "download", "write", "reindex",
  "create_session", "list_sessions", "get_session", "delete_session", "add_message",
  "get_session_context", "get_session_archive", "commit_session",
  "list_tool_results", "read_tool_result", "search_tool_result",
  "find", "search", "grep", "glob", "list_tasks", "get_task", "cancel_task",
  "list_experience_trajectories", "get_experience_outcome_distribution",
] as const;
export type OVOperation = typeof ovOperations[number];
export type NativeObject = Record<string, unknown>;
export type MemoryEntry = NativeObject & { uri: string; name?: string; isDir?: boolean; size?: number; modTime?: string };
export type Session = NativeObject & { session_id: string; commit_count?: number; message_count?: number };
export type Task = NativeObject & { task_id: string; status: string; task_type?: string; resource_id?: string };
export type TaskPage = { items: Task[]; has_more: boolean; next_cursor: string | null };
export type Receipt = NativeObject & { task_id?: string | null; session_id?: string; status?: string; reason?: string };
export type MessageInput = { role: string } & (
  { content: string; parts?: never } | { parts: NativeObject[]; content?: never }
);
export type RetrievalOptions = {
  uri: string; query: string; limit: number; mode?: "list" | "context";
  session?: string; score?: number; filter?: NativeObject; ignoreCase?: boolean;
  maxTokens?: number; searchType?: string; level?: number; provenance?: boolean; tags?: string[];
};

export function object(value: unknown): NativeObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as NativeObject : {};
}
export function text(value: unknown): string { return typeof value === "string" ? value : ""; }
export function display(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}
export function activeTask(task: Task | undefined): boolean {
  return !!task && ["pending", "running", "cancelling"].includes(task.status);
}
export function validKeepRecentCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000;
}
export class OVError extends Error {
  constructor(
    readonly kind: "native" | "transport" | "invalidResponse" | "permission" | "unsupported",
    message: string,
    readonly status = 0,
    readonly dispatched = false,
    readonly details?: unknown,
  ) { super(message); this.name = "OVError"; }
}
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// Navigation validation only. Native OpenViking evaluates data access using the user key.
export function memoryURI(root: string, uri: string): boolean {
  if (!root || !uri.startsWith("viking://") || /[?#\\]/.test(uri)) return false;
  if (uri === "viking://") return root === "viking://";
  const path = uri.replace(/\/+$/, "");
  if (path.slice("viking://".length).split("/").some(segment => !segment || segment === "." || segment === "..")) return false;
  if (/%2f|%5c|%2e/i.test(path)) return false;
  if (root === "viking://" || path === root || path.startsWith(root + "/")) return true;
  const userRoot = root.replace(/\/memories$/, "");
  if (!path.startsWith(userRoot + "/peers/")) return false;
  const peerPath = path.slice((userRoot + "/peers/").length).split("/");
  return Boolean(peerPath[0]) && peerPath[1] === "memories";
}
export function parentMemoryURI(root: string, uri: string): string {
  if (root === "viking://" && memoryURI(root, uri) && !uri.slice(root.length).replace(/\/+$/, "").includes("/")) return root;
  const parent = uri.replace(/\/+$/, "").slice(0, uri.replace(/\/+$/, "").lastIndexOf("/"));
  return memoryURI(root, parent) ? parent : uri;
}

function arrayResult<T>(value: unknown, valid: (row: NativeObject) => boolean): T[] {
  if (!Array.isArray(value) || value.some(row => !valid(object(row)))) {
    throw new OVError("invalidResponse", "Expected a native result array");
  }
  return value as T[];
}
function nativeObject(value: unknown): NativeObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OVError("invalidResponse", "Expected a native result object");
  return value as NativeObject;
}
function nativeText(value: unknown): string {
  if (typeof value === "string") return value;
  const content = object(value).content;
  if (typeof content === "string") return content;
  throw new OVError("invalidResponse", "Expected native text content");
}
function hasSessionID(row: NativeObject): boolean {
  return typeof row.session_id === "string" && row.session_id.trim().length > 0;
}
function nativeSession(value: unknown): Session {
  const row = nativeObject(value);
  if (!hasSessionID(row)) throw new OVError("invalidResponse", "Missing native session ID");
  return row as Session;
}
function nativeTask(value: unknown): Task {
  const row = nativeObject(value);
  if (typeof row.task_id !== "string" || typeof row.status !== "string") throw new OVError("invalidResponse", "Missing native task identity or status");
  return row as Task;
}
async function decode(response: Response, write: boolean): Promise<unknown> {
  const raw = await response.text();
  let envelope: NativeObject;
  try { envelope = nativeObject(JSON.parse(raw)); }
  catch {
    throw new OVError(response.ok ? "invalidResponse" : "native", raw || response.statusText, response.status, write, raw);
  }
  if (!response.ok || envelope.status === "error" || envelope.error) {
    const error = object(envelope.error);
    throw new OVError("native", text(error.message) || text(envelope.message) || response.statusText,
      response.status, typeof error.dispatched === "boolean" ? error.dispatched
        : write && (response.status >= 500 || response.ok), envelope);
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, "result")) throw new OVError("invalidResponse", "Missing native result", response.status, write, envelope);
  return envelope.result;
}

export function createOVClient(context: MemoryWorkspaceContext) {
  const operations = new Map(context.provider.operations.map(op => [op.id, op]));
  const can = (id: OVOperation) => {
    const op = operations.get(id);
    return Boolean(op);
  };
  const invoke = async (id: OVOperation, input: MemoryNativeInput, signal?: AbortSignal) => {
    const op = operations.get(id);
    if (!op) throw new OVError("unsupported", id);
    try { return await context.invoke(id, input, signal); }
    catch (error) {
      if (isAbort(error) || error instanceof OVError) throw error;
      throw new OVError("transport", error instanceof Error ? error.message : "", 0, op.permission !== "memory.read");
    }
  };
  const call = async <T = unknown>(id: OVOperation, input: MemoryNativeInput, signal?: AbortSignal, parse: (value: unknown) => T = value => value as T): Promise<T> => {
    const write = operations.get(id)?.permission !== "memory.read";
    let response: Response | undefined;
    try {
      response = await invoke(id, input, signal);
      return parse(await decode(response, write));
    }
    catch (error) {
      // Result validation belongs to the same request boundary as decoding.
      // A malformed success receipt cannot establish that a write did not run.
      if (response?.ok && error instanceof OVError && error.kind === "invalidResponse") {
        throw new OVError(error.kind, error.message, response.status, write, error.details);
      }
      if (isAbort(error) || error instanceof OVError) throw error;
      throw new OVError("transport", error instanceof Error ? error.message : "", 0, write);
    }
  };
  const sessionPath = (session_id: string) => ({ session_id });
  return {
    can,
    list: (uri: string, offset: number, tree: boolean, signal?: AbortSignal) =>
      call(tree ? "tree" : "ls", { query: {
        uri, output: "original", node_limit: 51, offset,
        ...(tree ? { level_limit: 2 } : { sort_by: "name", sort_order: "asc" }),
      } }, signal, value => arrayResult<MemoryEntry>(value, row => typeof row.uri === "string")),
    stat: (uri: string, signal?: AbortSignal) => call("stat", { query: { uri } }, signal, value => {
      const result = nativeObject(value);
      if (typeof result.isDir !== "boolean") throw new OVError("invalidResponse", "Missing native file type");
      return result;
    }),
    attrs: (uri: string, signal?: AbortSignal) => call("attrs", { query: { uri } }, signal),
    read: (uri: string, layer: "read" | "abstract" | "overview", signal?: AbortSignal) => call(layer, { query: { uri } }, signal, nativeText),
    write: (uri: string, content: string, signal?: AbortSignal) => call<Receipt>("write", { body: { uri, content, mode: "replace", wait: false } }, signal, nativeObject),
    reindex: (uri: string, signal?: AbortSignal) => call<Receipt>("reindex", { body: { uri, wait: false } }, signal, nativeObject),
    download: async (uri: string, signal?: AbortSignal) => {
      const response = await invoke("download", { query: { uri } }, signal);
      if (!response.ok) await decode(response, false);
      const blob = await response.blob();
      context.signal.throwIfAborted(); signal?.throwIfAborted();
      return blob;
    },
    sessions: (signal?: AbortSignal) => call("list_sessions", {}, signal, value => arrayResult<Session>(value, hasSessionID)),
    session: (id: string, signal?: AbortSignal) => call("get_session", { path: sessionPath(id), query: { auto_create: false } }, signal, nativeSession),
    createSession: (id: string, signal?: AbortSignal) => call("create_session", id ? { body: { session_id: id } } : {}, signal, nativeSession),
    deleteSession: (id: string, signal?: AbortSignal) => call("delete_session", { path: sessionPath(id) }, signal),
    context: (id: string, signal?: AbortSignal) => call("get_session_context", { path: sessionPath(id) }, signal),
    archive: (id: string, archive: string, signal?: AbortSignal) => call("get_session_archive", { path: { session_id: id, archive_id: archive } }, signal),
    addMessage: (id: string, message: MessageInput, signal?: AbortSignal) =>
      call("add_message", { path: sessionPath(id), body: message }, signal),
    commit: (id: string, keepRecent: number, signal?: AbortSignal) =>
      call<Receipt>("commit_session", { path: sessionPath(id), body: { keep_recent_count: keepRecent } }, signal, nativeObject),
    toolResults: (id: string, name: string, signal?: AbortSignal) =>
      call("list_tool_results", { path: sessionPath(id), query: { limit: 50, ...(name ? { tool_name: name } : {}) } }, signal),
    toolResult: (id: string, result: string, offset: number, signal?: AbortSignal) =>
      call("read_tool_result", { path: { session_id: id, tool_result_id: result }, query: { offset, limit: 20000, include_metadata: true } }, signal),
    searchToolResult: (id: string, result: string, q: string, signal?: AbortSignal) =>
      call("search_tool_result", { path: { session_id: id, tool_result_id: result }, query: { q, limit: 20 } }, signal),
    retrieve: (method: "find" | "search" | "grep" | "glob", options: RetrievalOptions, signal?: AbortSignal) => {
      if (method === "grep") return call(method, { body: { uri: options.uri, pattern: options.query, case_insensitive: options.ignoreCase ?? false, node_limit: options.limit } }, signal);
      if (method === "glob") return call(method, { body: { uri: options.uri, pattern: options.query, node_limit: options.limit } }, signal);
      const body: NativeObject = {
        query: options.query, limit: options.limit,
        ...(options.score !== undefined ? { score_threshold: options.score } : {}),
        ...(options.filter !== undefined ? { filter: options.filter } : {}),
        ...(options.level !== undefined && !(method === "search" && options.mode === "context") ? { level: options.level } : {}),
        ...(options.provenance ? { include_provenance: true } : {}),
        ...(options.tags?.length ? { tags: options.tags } : {}),
      };
      if (method === "search") {
        body.mode = options.mode ?? "list";
        body.search_type = options.searchType ?? "semantic";
        if (options.session) body.session_id = options.session;
        if (body.mode === "context") {
          body.max_tokens = options.maxTokens ?? 1600;
          // The context API has no target_uri; preserve a specific memory
          // selection using its native filter, ANDed with the caller's filter.
          const pathFilter = { op: "must", field: "uri", conds: [options.uri], para: "-d=-1" };
          body.filter = options.filter ? { op: "and", conds: [options.filter, pathFilter] } : pathFilter;
        } else body.target_uri = options.uri;
      } else body.target_uri = options.uri;
      const peerPrefix = (context.user.mapping.memory_uri ?? "").replace(/\/memories$/, "") + "/peers/";
      const peer = options.uri.startsWith(peerPrefix) ? options.uri.slice(peerPrefix.length).split("/")[0] : "";
      // Context mode has no target_uri. Let the adapter project the explicitly
      // selected Peer into its guard before ANDing our narrower URI filter.
      return call(method, { body, ...(method === "search" && body.mode === "context" && peer
        ? { headers: { "X-OpenViking-Actor-Peer": peer } } : {}) }, signal);
    },
    tasks: (type: string, status: string, resource: string, cursor: string, signal?: AbortSignal): Promise<TaskPage> =>
      call("list_tasks", { query: {
        ...(type ? { task_type: type } : {}), pagination: "cursor", limit: 20,
        ...(status ? { status } : {}), ...(resource ? { resource_id: resource } : {}), ...(cursor ? { cursor } : {}),
      } }, signal, value => {
        const result = nativeObject(value);
        const items = arrayResult<Task>(result.items, row => typeof row.task_id === "string" && typeof row.status === "string");
        if (typeof result.has_more !== "boolean" || (result.has_more && (typeof result.next_cursor !== "string" || !result.next_cursor || result.next_cursor === cursor))) {
          throw new OVError("invalidResponse", "Invalid native task cursor");
        }
        return { items, has_more: result.has_more, next_cursor: text(result.next_cursor) || null };
      }),
    task: (id: string, signal?: AbortSignal) => call("get_task", { path: { task_id: id }, query: { include_events: true } }, signal, nativeTask),
    cancelTask: (id: string, signal?: AbortSignal) => call("cancel_task", { path: { task_id: id } }, signal, nativeTask),
    trajectories: (uri: string, offset: number, start: string, end: string, signal?: AbortSignal) =>
      call("list_experience_trajectories", { query: { experience_uri: uri, offset, limit: 20, ...(start ? { start_date: start } : {}), ...(end ? { end_date: end } : {}) } }, signal),
    outcomes: (uri: string, start: string, end: string, signal?: AbortSignal) =>
      call("get_experience_outcome_distribution", { query: { experience_uri: uri, ...(start ? { start_date: start } : {}), ...(end ? { end_date: end } : {}) } }, signal),
  };
}
export type OVClient = ReturnType<typeof createOVClient>;
