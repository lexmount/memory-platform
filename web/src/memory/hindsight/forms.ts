import type { MemoryNativeInput } from "../contracts";
import { HindsightError } from "./client";
import type { HindsightOperation } from "./operations";
import { record, type NativeRecord } from "./types";

export type FormField = { path: string; label: string; kind?: "text" | "long" | "number" | "tags" | "json" | "array" | "boolean"; required?: boolean; options?: string[] };
const f = (path: string, label: string, kind?: FormField["kind"], required = false): FormField => ({ path, label, kind, required });
const name = f("body.name", "name", "text", true);
const source = f("body.source_query", "sourceQuery", "long", true);
const tags = f("body.tags", "tags", "tags");
const maxTokens = f("body.max_tokens", "maxTokens", "number");
const modelFields = [name, source, tags, maxTokens, f("body.trigger", "trigger", "json")];

export const actionFields: Partial<Record<HindsightOperation, FormField[]>> = {
  retain_memories: [f("body.items.0.content", "content", "long", true), f("body.items.0.document_id", "documentId"), f("body.items.0.context", "context"), f("body.items.0.timestamp", "timestamp"), f("body.items.0.tags", "tags", "tags"), f("body.items.0.metadata", "metadata", "json"), f("body.async", "async", "boolean")],
  dry_run_extract_memories: [f("body.content", "content", "long", true), f("body.context", "context"), f("body.strategy", "strategy")],
  preview_prompt: [{ path: "body.operation", label: "type", options: ["retain", "consolidation", "reflect"] }, f("body.strategy", "strategy")],
  update_memory: [f("body.text", "text", "long"), f("body.context", "context"), { path: "body.fact_type", label: "type", options: ["world", "experience"] }, f("body.entities", "entitiesField", "array"), { path: "body.state", label: "state", options: ["valid", "invalidated"] }, f("body.reason", "reason")],
  update_document: [tags],
  create_mental_model: modelFields,
  update_mental_model: modelFields.map(field => ({ ...field, required: false })),
  create_knowledge_folder: [name, f("body.parent_id", "parentId")],
  create_knowledge_page: [...modelFields, f("body.parent_id", "parentId")],
  update_knowledge_node: [f("body.name", "name"), f("body.source_query", "sourceQuery", "long"), f("body.parent_id", "parentId"), tags, maxTokens, f("body.trigger", "trigger", "json")],
  create_directive: [name, f("body.content", "content", "long", true), f("body.priority", "priority", "number"), f("body.is_active", "active", "boolean"), tags],
  update_directive: [f("body.name", "name"), f("body.content", "content", "long"), f("body.priority", "priority", "number"), f("body.is_active", "active", "boolean"), tags],
  recall_memories: [f("body.query", "query", "long", true), { path: "body.budget", label: "budget", options: ["low", "mid", "high"] }, maxTokens, tags],
  reflect: [f("body.query", "query", "long", true), f("body.context", "context", "long"), { path: "body.budget", label: "budget", options: ["low", "mid", "high"] }, maxTokens, tags],
  preview_consolidation_strategies: [f("body.strategies", "strategies", "json", true), f("body.sample_limit", "limit", "number")],
  update_bank_config: [f("body.updates", "updates", "json", true)],
  import_bank_template: [f("body", "manifest", "json", true), f("query.dry_run", "dryRun", "boolean")],
  export_bank_transfer: [f("query.include_data", "includeData", "boolean"), f("query.include_bank_config", "includeConfig", "boolean"), f("query.include_history", "includeHistory", "boolean"), f("query.document_id", "documentId", "tags")],
  import_bank_transfer: [{ path: "query.document_conflict", label: "conflict", options: ["skip", "replace", "new-id"] }],
};
export function actionSeed(operation: HindsightOperation, selected: NativeRecord = {}): Exclude<MemoryNativeInput, string> {
  const id = String(selected.id ?? selected.operation_id ?? "");
  const model = { name: selected.name, source_query: selected.source_query, tags: selected.tags, max_tokens: selected.max_tokens, trigger: selected.trigger };
  switch (operation) {
    case "retain_memories": return { body: { items: [{ content: "" }], async: true } };
    case "dry_run_extract_memories": return { body: { content: "" } };
    case "preview_prompt": return { body: { operation: "retain" } };
    case "update_memory": return { path: { memory_id: id }, body: { text: selected.text, context: selected.context, fact_type: selected.type, state: selected.state } };
    case "update_document": return { path: { document_id: id }, body: { tags: selected.tags ?? [] } };
    case "reprocess_document": case "delete_document": return { path: { document_id: id } };
    case "create_mental_model": return { body: { name: "", source_query: "" } };
    case "update_mental_model": return { path: { mental_model_id: id }, body: model };
    case "delete_mental_model": case "refresh_mental_model": case "dry_run_refresh_mental_model": case "clear_mental_model": return { path: { mental_model_id: id } };
    case "create_knowledge_folder": return { body: { name: "", ...(selected.kind === "folder" ? { parent_id: id } : {}) } };
    case "create_knowledge_page": return { body: { name: "", source_query: "", ...(selected.kind === "folder" ? { parent_id: id } : {}) } };
    case "update_knowledge_node": return { path: { node_id: id }, body: selected.kind === "folder" ? { name: selected.name, parent_id: selected.parent_id } : { ...model, parent_id: selected.parent_id } };
    case "delete_knowledge_node": return { path: { node_id: id } };
    case "create_directive": return { body: { name: "", content: "", priority: 0, is_active: true } };
    case "update_directive": return { path: { directive_id: id }, body: { name: selected.name, content: selected.content, priority: selected.priority, is_active: selected.is_active, tags: selected.tags } };
    case "delete_directive": return { path: { directive_id: id } };
    case "recall_memories": return { body: { query: "", budget: "mid", max_tokens: 4096 } };
    case "reflect": return { body: { query: "", budget: "mid", max_tokens: 4096, include: { facts: {} } } };
    case "preview_consolidation_strategies": return { body: { strategies: [], sample_limit: 20 } };
    case "update_bank_config": return { body: { updates: {} } };
    case "import_bank_template": return { body: { version: "1" }, query: { dry_run: true } };
    case "export_bank_transfer": return { query: { include_data: true, include_bank_config: true, include_history: false } };
    case "import_bank_transfer": return { query: { mode: "merge", document_conflict: "skip" } };
    case "cancel_operation": case "retry_operation": case "delete_operation": return { path: { operation_id: id } };
    default: return {};
  }
}
export function pathValue(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => Array.isArray(value) ? value[Number(part)] : record(value)[part], input);
}
function setPath(input: NativeRecord, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor: NativeRecord | unknown[] = input;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (Array.isArray(cursor)) {
      cursor[Number(key)] ??= /^\d+$/.test(keys[i + 1]!) ? [] : {};
      cursor = cursor[Number(key)] as NativeRecord;
    } else {
      cursor[key] ??= /^\d+$/.test(keys[i + 1]!) ? [] : {};
      cursor = cursor[key] as NativeRecord;
    }
  }
  if (Array.isArray(cursor)) cursor[Number(keys[keys.length - 1])] = value;
  else cursor[keys[keys.length - 1]!] = value;
}
export function formValue(field: FormField, input: unknown): string | boolean {
  const value = pathValue(input, field.path);
  if (field.kind === "boolean") return value === true;
  if (value === undefined || value === null) return "";
  if (field.kind === "tags" && Array.isArray(value)) return value.join(", ");
  if (field.kind === "json" || field.kind === "array") return JSON.stringify(value, null, 2);
  return String(value);
}
const partialUpdates = new Set<HindsightOperation>(["update_memory", "update_mental_model", "update_knowledge_node", "update_directive", "update_document"]);

export function formBaseline(operation: HindsightOperation, seed: Exclude<MemoryNativeInput, string>, submitted: Exclude<MemoryNativeInput, string>): Exclude<MemoryNativeInput, string> {
  if (!partialUpdates.has(operation)) return submitted;
  return { ...seed, ...submitted, body: { ...record(seed.body), ...record(submitted.body) } };
}

export function formInput(
  operation: HindsightOperation, seed: Exclude<MemoryNativeInput, string>, fields: readonly FormField[],
  values: Record<string, string | boolean>, touched: ReadonlySet<string>, options: { draft?: boolean } = {},
): Exclude<MemoryNativeInput, string> {
  const result: NativeRecord = JSON.parse(JSON.stringify(seed));
  // Native record PATCHes act on field presence: resending content or tags can
  // rebuild data even when unchanged and overwrite intervening edits.
  // Seeds are display defaults, not an instruction to apply every field.
  if (partialUpdates.has(operation)) result.body = {};
  for (const field of fields) {
    const value = values[field.path] ?? "";
    if (!options.draft && field.required && (typeof value !== "string" || !value.trim())) throw new HindsightError("required");
    if (!touched.has(field.path)) continue;
    let parsed: unknown = value;
    if (field.path === "body.parent_id" && value === "") parsed = null;
    try {
      switch (field.kind) {
        case "number":
          if (!String(value).trim() || !Number.isFinite(Number(value))) throw new HindsightError("invalidNumber");
          parsed = Number(value); break;
        case "tags": parsed = String(value).split(",").map(x => x.trim()).filter(Boolean); break;
        case "json": case "array":
          try { parsed = JSON.parse(String(value)); } catch { throw new HindsightError("invalidJSON"); }
          if (field.kind === "array" && !Array.isArray(parsed)) throw new HindsightError("invalidArray");
          if (field.kind === "json" && (parsed === null || typeof parsed !== "object")) throw new HindsightError("invalidJSON");
          break;
      }
    } catch (error) {
      if (!options.draft) throw error;
      // Mode switching is editing, not submission. Preserve incomplete typed
      // input as a JSON string so the user can repair it in the native editor.
      parsed = value;
    }
    setPath(result, field.path, parsed);
  }
  return result as Exclude<MemoryNativeInput, string>;
}
