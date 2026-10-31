import { describe, expect, it } from "vitest";
import { actionFields, actionSeed, formInput, formValue } from "../src/memory/hindsight/forms";
import { downloadKey } from "../src/memory/hindsight/client";
import type { HindsightOperation } from "../src/memory/hindsight/operations";

function form(operation: HindsightOperation, values: Record<string, string | boolean>, selected = {}) {
  const seed = actionSeed(operation, selected), fields = actionFields[operation] ?? [];
  return formInput(operation, seed, fields, { ...Object.fromEntries(fields.map(field => [field.path, formValue(field, seed)])), ...values }, new Set(Object.keys(values)));
}
describe("native Hindsight forms", () => {
  it("builds a real retain item, preserving false and native metadata", () => {
    expect(form("retain_memories", {
      "body.items.0.content": "A fact", "body.items.0.document_id": "doc-a",
      "body.items.0.tags": "atlas, rollout", "body.items.0.metadata": '{"source":"meeting"}', "body.async": false,
    })).toEqual({ body: { items: [{ content: "A fact", document_id: "doc-a", tags: ["atlas", "rollout"], metadata: { source: "meeting" } }], async: false } });
  });
  it("does not coerce optional untouched fields into empty strings, false or zero", () => {
    expect(form("create_mental_model", { "body.name": "Atlas", "body.source_query": "Summarize Atlas" }))
      .toEqual({ body: { name: "Atlas", source_query: "Summarize Atlas" } });
    expect(form("create_directive", { "body.name": "Rule", "body.content": "Cite facts", "body.priority": "0", "body.is_active": false }))
      .toEqual({ body: { name: "Rule", content: "Cite facts", priority: 0, is_active: false } });
  });
  it("moves a page to root using null, and clears tags with an empty native array", () => {
    expect(form("update_knowledge_node", { "body.parent_id": "", "body.tags": "" }, { id: "page-a", name: "Atlas", parent_id: "folder-a" }))
      .toEqual({ path: { node_id: "page-a" }, body: { parent_id: null, tags: [] } });
  });
  it.each([
    ["update_mental_model", { id: "model-a", name: "Model", source_query: "Source", tags: ["atlas"] }, { "body.name": "New name" }, { name: "New name" }],
    ["update_directive", { id: "rule-a", name: "Rule", content: "Content", priority: 2 }, { "body.is_active": false }, { is_active: false }],
    ["update_document", { id: "doc-a", tags: ["atlas"] }, {}, {}],
  ] as const)("keeps untouched native PATCH fields out of %s", (operation, selected, values, body) => {
    expect(form(operation, values, selected).body).toEqual(body);
  });
  it("serializes incomplete drafts without weakening submit validation or losing input", () => {
    const operation = "create_mental_model", seed = actionSeed(operation), fields = actionFields[operation]!;
    const values = { "body.name": "Draft", "body.source_query": "", "body.trigger": '{"refresh"' };
    const touched = new Set(Object.keys(values));
    expect(formInput(operation, seed, fields, values, touched, { draft: true })).toEqual({
      body: { name: "Draft", source_query: "", trigger: '{"refresh"' },
    });
    expect(() => formInput(operation, seed, fields, values, touched)).toThrow("required");
    expect(() => formInput(operation, seed, fields, { ...values, "body.source_query": "Complete query" }, touched)).toThrow("invalidJSON");
  });
  it("omits untouched memory content in both native-editor drafts and submitted PATCHes", () => {
    const operation = "update_memory", seed = actionSeed(operation, { id: "mem-a", text: "Fact", context: "Meeting", type: "world", state: "invalidated" });
    const fields = actionFields[operation]!;
    const values = { ...Object.fromEntries(fields.map(field => [field.path, formValue(field, seed)])), "body.state": "valid" };
    for (const draft of [false, true]) expect(formInput(operation, seed, fields, values, new Set(["body.state"]), { draft }))
      .toEqual({ path: { memory_id: "mem-a" }, body: { state: "valid" } });
  });
  it("requires template version '1', defaults to dry run and pins bank import to merge", () => {
    expect(actionSeed("import_bank_template")).toEqual({ body: { version: "1" }, query: { dry_run: true } });
    expect(actionSeed("import_bank_transfer")).toEqual({ query: { mode: "merge", document_conflict: "skip" } });
    expect(form("import_bank_transfer", { "query.document_conflict": "replace" })).toEqual({ query: { mode: "merge", document_conflict: "replace" } });
  });
  it.each([
    ["retain_memories", {}, "required"],
    ["create_directive", { "body.name": "Rule", "body.content": "Cite facts", "body.priority": "NaN" }, "invalidNumber"],
    ["update_memory", { "body.entities": "{}" }, "invalidArray"],
    ["preview_consolidation_strategies", { "body.strategies": "not json" }, "invalidJSON"],
  ] as const)("rejects malformed %s input before calling the bridge", (operation, values, code) => {
    expect(() => form(operation, values)).toThrow(code);
  });
  it("extracts only the native download key, never a navigation URL", () => {
    expect(downloadKey({ download_url: "https://private-provider/v1/default/files/download/bank%2Farchive.zip?token=secret" })).toBe("bank/archive.zip");
    expect(downloadKey({ download_url: "https://other.invalid/archive.zip" })).toBe("");
    expect(downloadKey({ download_url: "javascript:alert(1)" })).toBe("");
    expect(downloadKey({ download_url: "/v1/default/files/download/%FF" })).toBe("");
  });
});
