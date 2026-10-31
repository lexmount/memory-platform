import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge, Button, Card, Field, Input, Modal, Select, Table, Textarea } from "../../ui/index";
import type { MemoryNativeInput } from "../contracts";
import { downloadKey, HindsightError, parseNativeJSON, taskIDs, type HindsightClient } from "./client";
import type { HindsightOperation } from "./operations";
import { actionFields, actionSeed, formBaseline, formInput, formValue, type FormField } from "./forms";
import { useHindsightMutation, useHindsightTasks } from "./hooks";
import { record, records, text, type NativeRecord } from "./types";

export function Raw({ value, label }: { value: unknown; label?: string }) {
  const { t } = useTranslation();
  return <details className="hs-raw"><summary>{label ?? t("hindsight.raw")}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
export function ErrorNotice({ error, retry, write = false }: { error: unknown; retry?: () => void; write?: boolean }) {
  const { t } = useTranslation();
  if (!error || (error instanceof Error && error.name === "AbortError")) return null;
  const known = error instanceof HindsightError;
  const title = known && error.status ? t(error.native ? "hindsight.nativeError" : "hindsight.platformError", { status: error.status }) : t("hindsight.error");
  const message = known && t(`hindsight.${error.code}`, { defaultValue: "" }) || (error instanceof Error ? error.message : text(error));
  return <div className="hs-error" role="alert"><strong>{title}</strong><p>{message}</p>
    {write && (!known || error.dispatched) && <p>{t("hindsight.uncertain")}</p>}
    {retry && <Button onClick={retry}>{t("hindsight.retryRead")}</Button>}
  </div>;
}
export function Loading({ loading }: { loading?: boolean }) {
  const { t } = useTranslation();
  return loading ? <span role="status" className="hs-loading">{t("hindsight.loading")}</span> : null;
}
export function StateBadge({ status }: { status: unknown }) {
  const { t } = useTranslation();
  const value = text(status);
  let tone: "red" | "green" | "neutral" = "neutral";
  switch (value) {
    case "failed": tone = "red"; break;
    case "completed": tone = "green"; break;
  }
  return <Badge tone={tone}>
    {["pending", "processing", "completed", "failed", "cancelled", "not_found"].includes(value) ? t(`hindsight.${value}`) : t("hindsight.unknownStatus", { status: value })}
  </Badge>;
}
export function Markdown({ children }: { children: string }) {
  return <div className="hs-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    // All provider attachments go through the authenticated client below.
    img: ({ alt }) => <span>{alt}</span>,
    a: ({ href, children: label }) => {
      // Native attachment/API links need the scoped bridge. Their matching
      // attachment controls appear alongside the content, never at a raw URL.
      try {
        const url = new URL(href ?? "", "https://hindsight.invalid");
        if (url.pathname.startsWith("/v1/default/")) return <span>{label}</span>;
      } catch { return <span>{label}</span>; }
      return <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
    },
    table: ({ children: cells }) => <div className="hs-table-scroll"><table>{cells}</table></div>,
  }}>{children}</ReactMarkdown></div>;
}
export function NativeDetails({ value }: { value: unknown }) {
  const body = record(value);
  const content = body.text ?? body.content ?? body.original_text ?? body.markdown ?? body.body ?? body.preview_content;
  const scalar = Object.entries(body).filter(([key, item]) => !["text", "content", "original_text", "markdown", "body", "preview_content"].includes(key) && item !== null && ["string", "number", "boolean"].includes(typeof item));
  return <div className="hs-detail">
    {typeof content === "string" && <Markdown>{content}</Markdown>}
    {scalar.length > 0 && <dl className="hs-fields">{scalar.map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{text(item)}</dd></div>)}</dl>}
    {Array.isArray(value) && <RecordTable rows={records(value)} />}
    <Raw value={value} />
  </div>;
}
export function ActionResult({ operation, value }: { operation: HindsightOperation; value: unknown }) {
  const { t } = useTranslation(), data = record(value);
  switch (operation) {
    case "dry_run_extract_memories":
      return <><Section title={t("hindsight.memories")}><RecordTable rows={records(data.facts)} /></Section>
        <Section title={t("hindsight.chunks")}>{records(data.chunks).map((chunk, index) => <details key={index}><summary>{index + 1} · {text(chunk.fact_count)}</summary><Markdown>{text(chunk.text)}</Markdown></details>)}</Section><Raw value={value} /></>;
    case "preview_prompt":
      return <>{data.skipped_reason ? <p>{text(data.skipped_reason)}</p> : null}
        {records(data.messages).map((message, index) => <Section key={index} title={text(message.role)}>
          {records(message.blocks).map((block, i) => <details key={i} open={block.active !== false}>
            <summary>{text(block.field || block.section || block.heading || block.source)}{block.active === false ? ` · ${t("hindsight.active")}: false` : ""}</summary>
            <Markdown>{text(block.text)}</Markdown><Raw value={block} />
          </details>)}</Section>)}<Raw value={value} /></>;
    case "dry_run_refresh_mental_model":
      return <><div className="hs-comparison"><div><h3>{t("hindsight.before")}</h3><Markdown>{text(data.current_content)}</Markdown></div>
        <div><h3>{t("hindsight.after")}</h3><Markdown>{text(data.preview_content)}</Markdown></div></div>
        <Section title={t("hindsight.evidence")}><RecordTable rows={Object.values(record(data.based_on)).flatMap(records)} /></Section><Raw value={value} /></>;
    case "preview_consolidation_strategies":
      return <><RecordTable rows={records(data.strategies).map((strategy, index) => ({ ...strategy, name: `${t("hindsight.strategy")} ${index + 1}`, count: strategy.claimed_count }))} />
        <NativeDetails value={data.default} /><Raw value={value} /></>;
    default: return <NativeDetails value={value} />;
  }
}
export function RecordTable({ rows, onOpen }: { rows: NativeRecord[]; onOpen?: (row: NativeRecord) => void }) {
  const { t } = useTranslation();
  return <Table columns={[t("hindsight.content"), t("hindsight.type"), t("hindsight.actions")]} rows={rows.map(row => [
    <div className="hs-cell" key="content"><strong>{text(row.name ?? row.canonical_name ?? row.text ?? row.filename ?? row.action ?? row.operation ?? row.operation_type ?? row.task_type ?? row.id ?? row.document_id ?? row.tags)}</strong>
      <small>{text(row.id ?? row.operation_id ?? row.scope ?? row.count)}</small></div>,
    row.status ? <StateBadge key="status" status={row.status} /> : text(row.fact_type ?? row.kind ?? row.type),
    onOpen ? <Button key="open" size="sm" onClick={() => onOpen(row)}>{t("hindsight.details")}</Button> : <Raw key="raw" value={row} />,
  ])} />;
}
export function Pagination({ offset, limit, total, count, onChange }: { offset: number; limit: number; total?: number; count: number; onChange: (offset: number) => void }) {
  const { t } = useTranslation();
  return <div className="hs-pagination"><span>{total !== undefined ? t("hindsight.total", { count: total }) : `${offset + 1}–${offset + count}`}</span>
    <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>{t("hindsight.previous")}</Button>
    <Button size="sm" disabled={total !== undefined ? offset + limit >= total : count < limit} onClick={() => onChange(offset + limit)}>{t("hindsight.next")}</Button>
  </div>;
}
export function TaskMonitor({ client, accepted, onSettled }: { client: HindsightClient; accepted: ReadonlyMap<string, number>; onSettled?: () => void }) {
  const { t } = useTranslation();
  const ids = [...accepted.keys()];
  const { tasks, error, refresh } = useHindsightTasks(client, accepted);
  const notified = useRef({ client, ids: new Map<string, number>() });
  useEffect(() => {
    if (notified.current.client !== client) notified.current = { client, ids: new Map() };
    const completed = tasks.filter(task => ["completed", "failed", "cancelled"].includes(task.status)
      && notified.current.ids.get(task.operation_id) !== accepted.get(task.operation_id));
    completed.forEach(task => notified.current.ids.set(task.operation_id, accepted.get(task.operation_id)!));
    // A missing/unknown task must not prevent other completed jobs from
    // refreshing their resources. A later submission resets only the IDs it
    // actually accepted again, not unrelated jobs already notified.
    if (completed.length && !client.context.signal.aborted) onSettled?.();
  }, [client, tasks, accepted, onSettled]);
  if (!ids.length) return null;
  return <Card className="hs-task-monitor"><div className="hs-toolbar"><strong>{t("hindsight.tracking", { count: ids.length })}</strong><Button size="sm" onClick={refresh}>{t("hindsight.refresh")}</Button></div>
    <ErrorNotice error={error} retry={refresh} />
    {ids.map(id => {
      const task = tasks.find(item => item.operation_id === id);
      return <div key={id} className="hs-task"><code>{id}</code>{task ? <><StateBadge status={task.status} />
        {task.status === "not_found" && <p>{t("hindsight.notFoundHint")}</p>}
        {task.error_message && <p role="alert">{task.error_message}</p>}
        <TaskResultDownload client={client} task={task} /><Raw value={task} /></> : <Loading loading />}</div>;
    })}
  </Card>;
}
export function FileAction({ client, operation, input, label, image = false }: { client: HindsightClient; operation: "download_file" | "get_bank_attachment"; input: MemoryNativeInput; label?: string; image?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ url?: string; filename?: string; type?: string; error?: unknown; busy?: boolean }>({});
  const lifetime = useRef<AbortController | null>(null);
  const objectURL = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const revoke = () => {
      controller.abort();
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
      objectURL.current = undefined;
    };
    const abort = () => { revoke(); setState({}); };
    client.context.signal.addEventListener("abort", abort, { once: true });
    return () => { revoke(); client.context.signal.removeEventListener("abort", abort); };
  }, [client]);
  const load = async () => {
    const signal = lifetime.current!.signal;
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    objectURL.current = undefined;
    setState({ busy: true });
    try {
      const result = await client.file(operation, input, signal);
      signal.throwIfAborted();
      client.context.signal.throwIfAborted();
      objectURL.current = URL.createObjectURL(result.blob);
      setState({ url: objectURL.current, filename: result.filename, type: result.blob.type });
    } catch (error) { if (!signal.aborted && !client.context.signal.aborted) setState({ error }); }
  };
  return <div className="hs-file"><Button disabled={!client.can(operation) || state.busy} onClick={() => { void load(); }}>{label ?? t("hindsight.download")}</Button>
    <ErrorNotice error={state.error} />
    {state.url && <><a className="ifd-button" href={state.url} download={state.filename}>{t("hindsight.download")}: {state.filename}</a>
      {image && /^(image\/(png|jpeg|gif|webp))$/.test(state.type ?? "") && <img src={state.url} alt={label ?? t("hindsight.attachment")} />}</>}
  </div>;
}
export function TaskResultDownload({ client, task }: { client: HindsightClient; task: unknown }) {
  const data = record(task), key = data.status === "completed" ? downloadKey(data.result_metadata) : "";
  return key ? <FileAction key={key} client={client} operation="download_file" input={{ path: { key } }} /> : null;
}
export function ActionDialog({ client, operation, selected, seed: provided, onClose, onSuccess }: {
  client: HindsightClient; operation: HindsightOperation; selected?: NativeRecord; seed?: Exclude<MemoryNativeInput, string>; onClose: () => void; onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const fields = (actionFields[operation] ?? []).filter(field => operation !== "update_knowledge_node" || selected?.kind !== "folder" || ["body.name", "body.parent_id"].includes(field.path));
  const [formState, setForm] = useState(() => {
    const seed = provided ?? actionSeed(operation, selected);
    return { seed, values: Object.fromEntries(fields.map(field => [field.path, formValue(field, seed)])), edits: new Map<string, number>() };
  });
  const { seed, values } = formState;
  const touched = new Set(formState.edits.keys());
  const [advanced, setAdvanced] = useState(false), [raw, setRaw] = useState(JSON.stringify(seed, null, 2));
  const [schema, setSchema] = useState<unknown>(), [formError, setFormError] = useState<unknown>(), [files, setFiles] = useState<File[]>([]);
  const [uploadOptions, setUploadOptions] = useState("{}");
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useHindsightMutation(client);
  // Accepted native jobs outlive an individual submission attempt, including a
  // later failed request. Their lifetime remains bounded by this action dialog.
  const [acceptedTasks, setAcceptedTasks] = useState(() => new Map<string, number>());
  const write = ["memory.update", "memory.delete"].includes(client.context.provider.operations.find(item => item.id === operation)?.permission ?? "");
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const needsConfirmation = ["delete_document", "delete_mental_model", "clear_mental_model", "delete_knowledge_node", "delete_directive", "clear_observations", "reset_bank_config", "import_bank_transfer", "cancel_operation", "delete_operation"].includes(operation);
  const upload = operation === "file_retain" || operation === "import_bank_transfer";
  const update = (path: string, value: string | boolean) => setForm(previous => {
    const edits = new Map(previous.edits);
    edits.set(path, (edits.get(path) ?? 0) + 1);
    return { ...previous, values: { ...previous.values, [path]: value }, edits };
  });
  const submit = async () => {
    setFormError(undefined);
    try {
      const input = advanced ? parseNativeJSON(raw) : formInput(operation, seed, fields, values, touched);
      let form: FormData | undefined;
      if (upload) {
        if (!files.length || operation === "import_bank_transfer" && files.length !== 1) throw new HindsightError("required");
        form = new FormData();
        for (const file of files) form.append(operation === "file_retain" ? "files" : "file", file);
        if (operation === "file_retain") { parseNativeJSON(uploadOptions); form.append("request", uploadOptions); }
      }
      const result = await mutation.run(operation, input, form);
      if (result !== undefined) {
        if (typeof input !== "string") {
          const baseline = formBaseline(operation, seed, input);
          // Acknowledge the submitted snapshot only. Edits made while the
          // request was pending remain visible and dirty for the next save.
          setForm(current => ({ ...current, seed: baseline, edits: new Map([...current.edits].filter(([path, revision]) =>
            formState.edits.get(path) !== revision)) }));
        }
        const ids = operation === "delete_operation" ? [] : taskIDs(result.data);
        if (ids.length) setAcceptedTasks(previous => {
          const next = new Map(previous);
          for (const id of new Set(ids)) next.set(id, (next.get(id) ?? 0) + 1);
          return next;
        });
        onSuccess?.();
      }
    } catch (error) { setFormError(error); }
  };
  const switchAdvanced = () => {
    setFormError(undefined);
    setRaw(JSON.stringify(formInput(operation, seed, fields, values, touched, { draft: true }), null, 2));
    setAdvanced(true);
  };
  const renderFieldInput = (field: FormField) => {
    const value = values[field.path];
    if (field.kind === "boolean") {
      return <input type="checkbox" checked={value === true} onChange={e => update(field.path, e.target.checked)} />;
    }
    if (field.options) {
      return <Select label={t(`hindsight.${field.label}`)} value={String(value ?? "")} options={field.options} onChange={next => update(field.path, next)} />;
    }
    if (["long", "json", "array"].includes(field.kind ?? "")) {
      return <Textarea rows={field.kind === "long" ? 6 : 4} value={String(value ?? "")} onChange={e => update(field.path, e.target.value)} />;
    }
    return <Input type={field.kind === "number" ? "number" : "text"} value={String(value ?? "")} onChange={e => update(field.path, e.target.value)} />;
  };
  return <Modal open onClose={onClose} title={t(`hindsight.operations.${operation}`)} className="hs-modal"
    footer={<><Button onClick={onClose}>{t(mutation.busy ? "hindsight.stopWaiting" : "hindsight.cancel")}</Button><Button variant={needsConfirmation ? "danger" : "primary"}
      disabled={mutation.busy || !client.can(operation) || needsConfirmation && !confirmed} onClick={() => { void submit(); }}>{t(mutation.busy ? "hindsight.working" : "hindsight.submit")}</Button></>}>
    {operation === "retain_memories" && <p>{t("hindsight.retainHint")}</p>}
    {operation === "file_retain" && <p>{t("hindsight.uploadHint")}</p>}
    {operation === "cancel_operation" && <p>{t("hindsight.cancelTaskHint")}</p>}
    {operation === "import_bank_template" && <p>{t("hindsight.dryRunHint")}</p>}
    {operation === "import_bank_transfer" && <p>{t("hindsight.merge")}</p>}
    {!advanced && <div className="hs-form">{fields.map(field => <Field key={field.path} label={t(`hindsight.${field.label}`)} required={field.required}>
      {renderFieldInput(field)}
    </Field>)}</div>}
    {upload && <><Field label={t("hindsight.files")} hint={t("hindsight.fileLimit")}><Input type="file" multiple={operation === "file_retain"} accept={operation === "import_bank_transfer" ? ".zip,application/zip" : undefined} onChange={e => setFiles([...e.target.files ?? []])} /></Field>
      {operation === "file_retain" && <Field label={t("hindsight.advanced")}><Textarea rows={5} value={uploadOptions} onChange={e => setUploadOptions(e.target.value)} /></Field>}</>}
    {advanced ? <Field label={t("hindsight.advanced")} hint={t("hindsight.advancedHint")}><Textarea className="hs-code" rows={12} value={raw} onChange={e => setRaw(e.target.value)} /></Field> :
      <Button variant="text" onClick={switchAdvanced}>{t("hindsight.advanced")}</Button>}
    <Button variant="text" onClick={() => {
      const signal = lifetime.current!.signal;
      void client.context.schema(operation, signal).then(
        value => { if (!signal.aborted && !client.context.signal.aborted) setSchema(value); },
        error => { if (!signal.aborted && !client.context.signal.aborted) setFormError(error); },
      );
    }}>{t("hindsight.schema")}</Button>
    {schema !== undefined && <Raw value={schema} label={t("hindsight.schema")} />}
    {needsConfirmation && <Field label={t("hindsight.confirmed")} hint={t("hindsight.confirmHint")}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /></Field>}
    {mutation.busy && write && <p className="hs-hint">{t("hindsight.waitingHint")}</p>}
    <ErrorNotice error={formError ?? mutation.error} write={write} />
    {mutation.completed && <><p role="status">{t(operation !== "delete_operation" && taskIDs(mutation.result).length ? "hindsight.accepted" : "hindsight.success")}</p>
      {mutation.result !== undefined && <ActionResult operation={operation} value={mutation.result} />}</>}
    <TaskMonitor client={client} accepted={acceptedTasks} onSettled={onSuccess} />
  </Modal>;
}
export function Actions({ client, operations, selected, onSuccess }: { client: HindsightClient; operations: readonly HindsightOperation[]; selected?: NativeRecord; onSuccess?: (operation: HindsightOperation) => void }) {
  const { t } = useTranslation();
  const [action, setAction] = useState<HindsightOperation>();
  const primary = operations.filter(op => !op.startsWith("dry_run") && op !== "preview_prompt");
  const advanced = operations.filter(op => !primary.includes(op));
  const buttons = (items: readonly HindsightOperation[]) => items.map(operation => <Button key={operation} size="sm" disabled={!client.can(operation)} onClick={() => setAction(operation)}>{t(`hindsight.operations.${operation}`)}</Button>);
  return <><div className="hs-actions">{buttons(primary)}{advanced.length > 0 && <details className="hs-advanced-actions"><summary>{t("nativeUI.moreActions")}</summary><div>{buttons(advanced)}</div></details>}</div>
    {action && <ActionDialog key={`${action}:${text(selected?.id ?? selected?.operation_id)}`} client={client} operation={action} selected={selected} onClose={() => setAction(undefined)} onSuccess={() => onSuccess?.(action)} />}</>;
}
export function Section({ title, children, tools }: { title: string; children: ReactNode; tools?: ReactNode }) {
  return <section className="hs-section"><header className="hs-toolbar"><h2>{title}</h2>{tools}</header>{children}</section>;
}
