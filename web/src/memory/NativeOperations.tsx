import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, EmptyState, Field, Input, SectionHeader, Select, Textarea } from "../ui/index";
import { memoryRequest, type MemoryOperation, type MemoryWorkspaceContext } from "./contracts";
import { useNativeWrites } from "./NativeWrites";

// Groups are presentation only. Discovery, schemas and permission requirements
// always come from the server's selected provider catalog.
export function nativeGroup(operation: MemoryOperation): string {
  if (operation.path.includes("/compile")) return "compile";
  if (operation.path.includes("/console/") || operation.path.includes("/system/consistency")) return "diagnostics";
  if (operation.path.includes("/privacy-configs")) return "privacy";
  if (operation.path.includes("/user-settings/")) return "settings";
  if (operation.path.includes("/watches")) return "watches";
  if (operation.path.includes("/skills")) return "skills";
  if ((operation.path.includes("/resources") || operation.path.includes("/openviking-assets"))) return "resources";
  return "native";
}

export function NativeOperations({ context, group = "native" }: { context: MemoryWorkspaceContext; group?: string }) {
  const { t } = useTranslation();
  const operations = context.provider.operations.filter(operation => group === "native" || nativeGroup(operation) === group);
  const [selected, setSelected] = useState(""), [pending, setPending] = useState(false);
  const operation = operations.find(item => item.id === selected) ?? operations[0];
  const writePending = pending && operation?.permission !== "memory.read";
  return <div className="memory-native-operations">
    <SectionHeader title={t(`nativeMemory.${group === "native" ? "title" : group}`)} description={t("nativeMemory.description")} />
    {!operation ? <EmptyState title={t("nativeMemory.unavailable")} /> : <>
      <Field label={t("nativeMemory.operation")}><Select label={t("nativeMemory.operation")} value={operation.id}
        disabled={writePending} onChange={value => { if (!writePending) setSelected(value); }}
        options={operations.map(item => ({ value: item.id, label: `${item.id} · ${item.method}` }))} /></Field>
      <NativeOperationForm key={`${context.identity}:${operation.id}`} context={context} operation={operation} pending={pending} onPendingChange={setPending} />
    </>}
  </div>;
}

function jsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
  return parsed as Record<string, unknown>;
}

function uncertainWriteResponse(response: Response, text: string | undefined): boolean {
  const native = response.headers.has("X-Memory-Native-Status");
  if (native && response.ok) return false;
  // The native marker separates provider-owned bodies from platform failures.
  // Only an explicit platform pre-dispatch rejection proves a write was not
  // sent. Status codes alone (including proxy 4xx) cannot establish certainty.
  if (!native && text !== undefined) {
    try {
      const error = jsonObject(text).error;
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string" &&
        error.code.startsWith("memory_") && "dispatched" in error && error.dispatched === false) {
        return false;
      }
    } catch { /* An empty or non-JSON proxy error cannot rule out side effects. */ }
  }
  return true;
}

function NativeOperationForm({ context, operation, pending, onPendingChange }: {
  context: MemoryWorkspaceContext; operation: MemoryOperation; pending: boolean; onPendingChange(value: boolean): void;
}) {
  const { t } = useTranslation();
  const { begin } = useNativeWrites();
  const [draft, setDraft] = useState("{}"), [fields, setFields] = useState("{}");
  const [files, setFiles] = useState<File[]>([]), [schema, setSchema] = useState<unknown>();
  const [schemaError, setSchemaError] = useState(false);
  const [result, setResult] = useState<{ status: number; text?: string; blob: Blob }>();
  const [error, setError] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const upload = operation.request_media?.includes("multipart/form-data");
  const write = operation.permission !== "memory.read";
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); onPendingChange(false); };
  }, [context.signal, operation.id, onPendingChange]);
  useEffect(() => {
    const controller = new AbortController();
    setSchemaError(false);
    void memoryRequest(context.signal, controller.signal, signal => context.schema(operation.id, signal)).then(value => {
      if (!controller.signal.aborted && !context.signal.aborted) setSchema(value);
    }).catch(() => {
      if (!controller.signal.aborted && !context.signal.aborted) setSchemaError(true);
    });
    return () => controller.abort();
  }, [context, operation.id]);

  const execute = async () => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || context.signal.aborted || inFlight.current) return;
    let data: FormData | undefined;
    try {
      jsonObject(draft); // Validate, but send the original bytes (including large numbers).
      if (upload) {
        if (!files.length) { setError("nativeMemory.requiredFile"); return; }
        data = new FormData();
        for (const file of files) data.append(operation.id === "file_retain" ? "files" : "file", file);
        for (const [key, value] of Object.entries(jsonObject(fields))) {
          for (const item of Array.isArray(value) ? value : [value]) {
            data.append(key, typeof item === "string" ? item : JSON.stringify(item));
          }
        }
      }
    } catch { setError("nativeMemory.invalid"); return; }
    inFlight.current = true; onPendingChange(true); setError(""); setResult(undefined);
    const receipt = write ? begin(context.identity, operation.id) : undefined;
    try {
      const value = await memoryRequest(context.signal, signal, async linked => {
        const response = await context.invoke(operation.id, draft, linked, data);
        const type = response.headers.get("content-type") ?? "";
        const binary = /attachment/i.test(response.headers.get("content-disposition") ?? "") ||
          (type !== "" && !/json|text\//i.test(type));
        // Preserve bytes and media type for every download, including errors
        // and non-UTF-8 text. Decoding is only for display/classification.
        const blob = await response.blob();
        const text = binary && response.ok ? undefined : await blob.text();
        linked.throwIfAborted();
        return { status: response.status, blob, text: binary ? undefined : text,
          uncertain: write && uncertainWriteResponse(response, text) };
      });
      if (!signal.aborted && !context.signal.aborted) {
        if (value.uncertain) receipt?.uncertain(); else receipt?.confirmed();
        setResult(value);
      } else receipt?.uncertain();
    } catch {
      // Navigation cancels local waiting, not a write already dispatched to the
      // provider. Preserve that uncertainty outside the retiring form.
      receipt?.uncertain();
      if (!signal.aborted && !context.signal.aborted) setError(write ? "nativeMemory.uncertain" : "nativeMemory.failed");
    } finally {
      inFlight.current = false;
      if (!signal.aborted && !context.signal.aborted) onPendingChange(false);
    }
  };
  return <Card className="memory-native-form">
    <p>{operation.description}</p><code>{operation.method} {operation.path}</code>
    <details><summary>{t("nativeMemory.schema")}</summary>
      {schemaError && <p role="alert">{t("nativeMemory.failed")}</p>}
      <pre>{schema === undefined ? "…" : JSON.stringify(schema, null, 2)}</pre>
    </details>
    <form onSubmit={event => { event.preventDefault(); void execute(); }}>
      <Field label={t("nativeMemory.input")} hint={t("nativeMemory.inputHint")}>
        <Textarea aria-label={t("nativeMemory.input")} value={draft} onChange={event => setDraft(event.target.value)} rows={12} spellCheck={false} disabled={pending} />
      </Field>
      {upload && <>
        <Field label={t("nativeMemory.file")}><Input aria-label={t("nativeMemory.file")} type="file" multiple={operation.id === "file_retain"}
          disabled={pending} onChange={event => setFiles(Array.from(event.target.files ?? []))} /></Field>
        <Field label={t("nativeMemory.fields")}><Textarea aria-label={t("nativeMemory.fields")} rows={4} value={fields} disabled={pending} onChange={event => setFields(event.target.value)} /></Field>
      </>}
      {error && <p role="alert">{t(error)}</p>}
      <Button type="submit" variant={operation.permission === "memory.delete" ? "danger" : "primary"} disabled={pending}>
        {t(pending ? "nativeMemory.working" : "nativeMemory.run")}
      </Button>
    </form>
    {result && <section aria-label={t("nativeMemory.response")}><h3>{t("nativeMemory.response")} · HTTP {result.status}</h3>
      {result.text !== undefined && <pre>{result.text}</pre>}
      <Button onClick={() => {
        if (context.signal.aborted || lifetime.current?.signal.aborted) return;
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a"); link.href = url; link.download = `${operation.id}.${result.text === undefined ? "bin" : "txt"}`;
        link.click(); URL.revokeObjectURL(url);
      }}>{t("nativeMemory.download")}</Button>
    </section>}
  </Card>;
}
