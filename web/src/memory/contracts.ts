import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type MemoryOperation = Readonly<{
  id: string; method: string; path: string; description: string;
  request_media: readonly string[] | null; permission: string;
}>;
export type MemoryProvider = Readonly<{
  provider: string; version: string; operations: readonly MemoryOperation[]; features?: Readonly<Record<string,boolean>>;
}>;
export type MemoryWorkspace = Readonly<{id:string;name:string;is_default:boolean;created_at:string}>;
export type MemoryProject = Readonly<{
  id: string; workspace_id?: string; name: string; provider: string; app_key: string;
  enabled: boolean; revoked: boolean; created_at: string; updated_at: string;
}>;
export type MemoryIdentity = Readonly<{
  project_id: string; user_id: string; provider: MemoryProvider;
  mapping: Readonly<Record<string, string>>;
}>;
export type MemoryUserPage = {
  items: { user_id: string; provisioned: boolean }[]; next_cursor: string;
};
// Browser-only transport material. Public MCP/HTTP use native provider contracts.
export type MemoryNativeInput = string | {
  path?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
};
export interface MemoryBridge {
  readonly identity: string;
  formatTimeBucket?(bucket: string, granularity: "hour" | "day", language: string): string;
  providers(signal: AbortSignal): Promise<readonly MemoryProvider[]>;
  workspaces?(signal:AbortSignal):Promise<readonly MemoryWorkspace[]>;
  createWorkspace?(name:string,signal:AbortSignal):Promise<MemoryWorkspace>;
  projects(signal: AbortSignal): Promise<readonly MemoryProject[]>;
  createProject(name: string, provider: string, signal: AbortSignal, workspace?:string): Promise<{ project: MemoryProject; app_secret: string }>;
  updateProject(project: string, patch: { name?: string; enabled?: boolean }, signal: AbortSignal): Promise<MemoryProject>;
  rotateCredential(project: string, signal: AbortSignal): Promise<{ app_key: string; app_secret: string }>;
  deleteProject?(project: string, signal: AbortSignal): Promise<void>;
  revokeCredential(project: string, signal: AbortSignal): Promise<void>;
  users(project: string, after: string, signal: AbortSignal): Promise<MemoryUserPage>;
  resolveUser(project: string, user: string, signal: AbortSignal): Promise<MemoryIdentity>;
  schema(project: string, user: string, operation: string, signal: AbortSignal): Promise<unknown>;
  invoke(project: string, user: string, operation: string, input: MemoryNativeInput, signal: AbortSignal, upload?: FormData): Promise<Response>;
}
export type MemoryWorkspaceContext = Readonly<{
  identity: string; project: MemoryProject; provider: MemoryProvider; user: MemoryIdentity;
  signal: AbortSignal;
  schema(operation: string, signal?: AbortSignal): Promise<unknown>;
  invoke(operation: string, input: MemoryNativeInput, signal?: AbortSignal, upload?: FormData): Promise<Response>;
}>;
export interface MemoryProviderModule {
  readonly id: string;
  readonly labelKey: string;
  readonly defaultPage: string;
  readonly navigation: readonly { id: string; labelKey: string; icon: LucideIcon }[];
  readonly Workspace: ComponentType<{ context: MemoryWorkspaceContext; page: string; formatTimeBucket?: MemoryBridge["formatTimeBucket"] }>;
}
const unavailable = async (): Promise<never> => { throw new Error("Memory provider unavailable"); };
export const emptyMemoryBridge: MemoryBridge = Object.freeze({
  identity: "memory-preview", providers: async () => [], projects: async () => [],
  createProject: unavailable, updateProject: unavailable, rotateCredential: unavailable, revokeCredential: unavailable,
  users: async () => ({ items: [], next_cursor: "" }), resolveUser: unavailable, schema: unavailable, invoke: unavailable,
});

/** Best-effort cleanup of a response the current workspace cannot consume. */
export function discardMemoryResponse(result: unknown, reason?: unknown): void {
  if (result instanceof Response) void result.body?.cancel(reason).catch(() => undefined);
}

/** Stop local waiting and fence late data even if a transport ignores abort.
 * The linked signal requests cancellation; native work may still finish. */
export async function memoryRequest<T>(
  lifetime: AbortSignal,
  signal: AbortSignal | undefined,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const sources = [lifetime, signal].filter((item): item is AbortSignal => Boolean(item));
  let bodyAbort: (() => void) | undefined;
  let rejectOnAbort: (() => void) | undefined;
  const release = () => {
    sources.forEach(source => source.removeEventListener("abort", abort));
    if (bodyAbort) controller.signal.removeEventListener("abort", bodyAbort);
  };
  let streaming = false;
  sources.forEach(source => source.addEventListener("abort", abort, { once: true }));
  if (sources.some(source => source.aborted)) controller.abort();
  try {
    controller.signal.throwIfAborted();
    const result = await new Promise<T>((resolve, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
      // Keep observing the transport after local cancellation so late errors
      // are handled and late bodies are discarded without blocking cleanup.
      void call(controller.signal).then(value => {
        if (controller.signal.aborted) discardMemoryResponse(value, controller.signal.reason);
        else resolve(value);
      }, reject);
    });
    if (controller.signal.aborted) {
      discardMemoryResponse(result, controller.signal.reason);
      controller.signal.throwIfAborted();
    }
    if (result instanceof Response && result.body) {
      // Fetch resolves at headers. Keep lifetime cancellation attached until
      // the native body is consumed/cancelled, including streaming downloads.
      const reader = result.body.getReader();
      streaming = true;
      const body = new ReadableStream<Uint8Array>({
        start(output) {
          bodyAbort = () => {
            // Error the consumer stream synchronously so queued private bytes
            // cannot be read after this workspace has retired.
            output.error(controller.signal.reason);
            void reader.cancel(controller.signal.reason).catch(() => undefined);
            release();
          };
          controller.signal.addEventListener("abort", bodyAbort, { once: true });
        },
        async pull(output) {
          try {
            controller.signal.throwIfAborted();
            const chunk = await reader.read();
            controller.signal.throwIfAborted();
            if (chunk.done) { release(); output.close(); }
            else output.enqueue(chunk.value);
          } catch (error) { release(); output.error(error); }
        },
        async cancel(reason) {
          release();
          await reader.cancel(reason);
        },
      }, { highWaterMark: 0 });
      return new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers }) as T;
    }
    return result;
  } finally {
    if (rejectOnAbort) controller.signal.removeEventListener("abort", rejectOnAbort);
    if (!streaming) release();
  }
}
