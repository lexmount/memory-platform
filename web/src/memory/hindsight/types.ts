// UI projections of the pinned native responses, not a common Memory domain.
// Additional native fields remain on the original record and in the detail view.
export type NativeRecord = Record<string, unknown>;
export type MemoryUnit = NativeRecord & {
  id: string; text: string; fact_type?: string; type?: string; context?: string;
  document_id?: string; chunk_id?: string; entities?: NativeRecord[];
};
export type NativePage<T = NativeRecord> = { items: T[]; total: number; limit: number; offset: number };
export type NativeTask = NativeRecord & {
  operation_id?: string; id?: string; status: string; operation_type?: string; task_type?: string;
  error_message?: string | null; result_metadata?: NativeRecord | null;
};
export type RetainResult = NativeRecord & {
  success: boolean; async: boolean; operation_id?: string | null; operation_ids?: string[] | null;
};
export type MentalModel = NativeRecord & {
  id: string; name: string; source_query: string; content?: string | null; tags?: string[]; is_stale?: boolean;
};
export type KnowledgeNode = NativeRecord & {
  id: string; name: string; kind?: string; parent_id?: string | null; mental_model_id?: string;
  children?: KnowledgeNode[];
};
export type RecallResult = NativeRecord & { results: MemoryUnit[] };
export type ReflectResult = NativeRecord & { text: string; based_on?: NativeRecord | null };
export type DocumentDetail = NativeRecord & {
  id: string; original_text?: string; tags?: string[]; attachments?: NativeRecord[];
};
export function record(value: unknown): NativeRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as NativeRecord : {};
}
export function records(value: unknown): NativeRecord[] {
  return Array.isArray(value) ? value.filter(x => x !== null && typeof x === "object" && !Array.isArray(x)) as NativeRecord[] : [];
}
export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
