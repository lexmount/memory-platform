import { memoryRequest, type MemoryNativeInput, type MemoryWorkspaceContext } from "../contracts";
import type { HindsightOperation } from "./operations";
import { record } from "./types";

const jsonLimit = 4 * 1024 * 1024;
const uploadLimit = 32 * 1024 * 1024;
const queryLimit = 32 * 1024;
const responseLimit = 64 * 1024 * 1024;
export class HindsightError extends Error {
  constructor(
    readonly code: string, message = code, readonly status = 0,
    readonly native = false, readonly dispatched = false, readonly detail?: unknown,
  ) { super(message); this.name = "HindsightError"; }
}
export function taskIDs(value: unknown): string[] {
  const body = record(value);
  return [...new Set([body.operation_id, ...(Array.isArray(body.operation_ids) ? body.operation_ids : [])]
    .filter((id): id is string => typeof id === "string" && id.length > 0))];
}
export function downloadKey(metadata: unknown): string {
  const value = record(metadata);
  // Decode only a native file route; never navigate to a provider-supplied URL.
  if (typeof value.download_url !== "string") return "";
  try {
    const url = new URL(value.download_url, "https://hindsight.invalid");
    const prefix = "/v1/default/files/download/";
    return url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : "";
  } catch { return ""; }
}
export function taskActionAvailable(operation: HindsightOperation, status: string): boolean {
  switch (operation) {
    case "cancel_operation": return status === "pending" || status === "processing";
    case "retry_operation": return status === "failed" || status === "cancelled";
    case "delete_operation": return ["failed", "cancelled", "completed"].includes(status);
    default: return true;
  }
}
export function parseNativeJSON(value: string): MemoryNativeInput {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new HindsightError("invalidJSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HindsightError("invalidJSON");
  // Return the original bytes: parsing is validation, never a numeric conversion.
  return value;
}
function filename(header: string | null): string {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let name = header?.match(/filename="?([^";]+)"?/i)?.[1] ?? "hindsight-download";
  if (encoded) {
    try { name = decodeURIComponent(encoded); } catch { /* Keep the plain filename. */ }
  }
  // eslint-disable-next-line no-control-regex -- Strip filesystem control characters from an untrusted download filename.
  return name.split("\\").join("/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "") || "hindsight-download";
}
async function bodyBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const length = Number(response.headers.get("Content-Length"));
  if (length > responseLimit) {
    void response.body?.cancel().catch(() => undefined);
    throw new HindsightError("responseTooLarge");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > responseLimit) throw new HindsightError("responseTooLarge");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
/** Shared by native operations and bank initialization, including proxy bodies. */
export async function readHindsightResponse(response: Response, signal: AbortSignal) {
  const native = response.headers.has("X-Memory-Native-Status");
  let bytes: Uint8Array;
  try { bytes = await bodyBytes(response, signal); }
  catch (error) {
    signal.throwIfAborted();
    throw new HindsightError(
      error instanceof HindsightError ? error.code : "http",
      error instanceof Error ? error.message : String(error), response.status, native, true,
      error instanceof HindsightError ? error.detail : undefined,
    );
  }
  signal.throwIfAborted();
  if (!response.ok) {
    const raw = new TextDecoder().decode(bytes);
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* Native/proxy errors may be empty or non-JSON. */ }
    const body = record(payload), error = record(body.error);
    const message = error.message ?? body.detail ?? body.error ?? (raw || response.statusText || `HTTP ${response.status}`);
    // The native header proves dispatch. Platform errors carry an explicit
    // dispatch flag; an unclassified proxy 5xx cannot rule out native effects.
    const dispatched = native || (typeof error.dispatched === "boolean" ? error.dispatched : response.status >= 500);
    throw new HindsightError(
      typeof error.code === "string" ? error.code : "http",
      typeof message === "string" ? message : JSON.stringify(message),
      response.status, native, dispatched, payload,
    );
  }
  return { response, bytes };
}
export function createHindsightClient(context: MemoryWorkspaceContext) {
  const can = (operation: HindsightOperation) => {
    const entry = context.provider.operations.find(item => item.id === operation);
    return Boolean(entry);
  };
  const run = async (operation: HindsightOperation, input: MemoryNativeInput = {}, signal?: AbortSignal, upload?: FormData) => {
    context.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (!can(operation)) throw new HindsightError("unavailable");
    const native = typeof input === "string" ? parseNativeJSON(input) : input;
    const envelope = typeof native === "string" ? native : JSON.stringify(native);
    if (new TextEncoder().encode(envelope).length > (upload ? queryLimit : jsonLimit)) throw new HindsightError("tooLarge");
    if (upload) {
      // Reject oversized files before serializing the multipart body into memory.
      let contentSize = 0;
      for (const value of upload.values()) {
        contentSize += typeof value === "string" ? new TextEncoder().encode(value).length : value.size;
        if (contentSize > uploadLimit) throw new HindsightError("tooLarge");
      }
      if ((await new Response(upload).blob()).size > uploadLimit) throw new HindsightError("tooLarge");
    }
    return memoryRequest(context.signal, signal, async linked => {
      linked.throwIfAborted();
      const response = await context.invoke(operation, native, linked, upload);
      return readHindsightResponse(response, linked);
    });
  };
  return {
    context, can,
    async json<T = unknown>(operation: HindsightOperation, input: MemoryNativeInput = {}, signal?: AbortSignal, upload?: FormData): Promise<T> {
      const { response, bytes } = await run(operation, input, signal, upload);
      context.signal.throwIfAborted(); signal?.throwIfAborted();
      if (!bytes.length && response.status === 204) return undefined as T;
      try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
      catch { throw new HindsightError("invalidResponse", "invalidResponse", response.status, response.headers.has("X-Memory-Native-Status"), true); }
    },
    async file(operation: HindsightOperation, input: MemoryNativeInput, signal?: AbortSignal) {
      const { response, bytes } = await run(operation, input, signal);
      context.signal.throwIfAborted(); signal?.throwIfAborted();
      return {
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: response.headers.get("Content-Type") ?? "application/octet-stream" }),
        filename: filename(response.headers.get("Content-Disposition")),
      };
    },
  };
}
export type HindsightClient = ReturnType<typeof createHindsightClient>;
