import { CollectionResults } from "./CollectionResults";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea, Tabs, Modal } from "../../ui/index";
import { HindsightError, type HindsightClient } from "./client";
import { Actions, ErrorNotice, FileAction, Loading, NativeDetails, Pagination, Raw, RecordTable, Section } from "./components";
import { useHindsightRead } from "./hooks";
import { pageOffset, useHindsightLocation } from "./navigation";
import type { HindsightOperation } from "./operations";
import { record, records, text, type NativeRecord } from "./types";
import type { MemoryNativeInput } from "../contracts";

export type CollectionKind = "memories" | "documents" | "entities" | "models" | "directives";
const definitions: Record<CollectionKind, {
  list: HindsightOperation; detail: HindsightOperation; id: string; q?: boolean; types?: string[];
  tagModes?: string[]; tagDefault?: string;
  create: HindsightOperation[]; update: HindsightOperation[];
}> = {
  memories: { list: "list_memories", detail: "get_memory", id: "memory_id", q: true, types: ["world", "experience", "observation"], create: ["retain_memories", "file_retain", "dry_run_extract_memories", "preview_prompt"], update: ["update_memory"] },
  documents: { list: "list_documents", detail: "get_document", id: "document_id", q: true, tagModes: ["any", "all", "any_strict", "all_strict"], tagDefault: "any_strict", create: ["file_retain", "retain_memories"], update: ["update_document", "reprocess_document", "delete_document"] },
  entities: { list: "list_entities", detail: "get_entity", id: "entity_id", create: [], update: [] },
  models: { list: "list_mental_models", detail: "get_mental_model", id: "mental_model_id", tagModes: ["any", "all", "exact"], create: ["create_mental_model"], update: ["update_mental_model", "refresh_mental_model", "dry_run_refresh_mental_model", "clear_mental_model", "delete_mental_model"] },
  directives: { list: "list_directives", detail: "get_directive", id: "directive_id", tagModes: ["any", "all", "exact"], create: ["create_directive"], update: ["update_directive", "delete_directive"] },
};

type FilterBarProps = {
  query?: boolean; tags?: boolean; tagModes?: string[]; tagDefault?: string; types?: string[]; value: NativeRecord;
  onApply: (value: NativeRecord) => void; children?: ReactNode;
};
export function FilterBar(props: FilterBarProps) {
  // URL state owns the applied filters. Reset only the editable draft when
  // external navigation or another filter control changes that value.
  return <FilterBarDraft key={JSON.stringify(props.value)} {...props} />;
}
function FilterBarDraft({ query, tags = true, tagModes = ["any", "all", "any_strict", "all_strict", "exact"], tagDefault = "any", types, value, onApply, children }: FilterBarProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState(text(value.q)), [tag, setTag] = useState(Array.isArray(value.tags) ? value.tags.join(", ") : "");
  const [type, setType] = useState(text(value.type)), [match, setMatch] = useState(text(value.tags_match) || tagDefault);
  const [advanced, setAdvanced] = useState(() => {
    const extras = { ...value };
    // A field belongs to a dedicated control only when that control is shown.
    // Otherwise it must round-trip through the native JSON editor.
    if (query) delete extras.q;
    if (tags) { delete extras.tags; delete extras.tags_match; }
    if (types) delete extras.type;
    return JSON.stringify(extras, null, 2);
  });
  const [error, setError] = useState<unknown>();
  return <form className="hs-filters" onSubmit={event => {
    event.preventDefault(); setError(undefined);
    try {
      const extras: unknown = JSON.parse(advanced);
      if (!extras || typeof extras !== "object" || Array.isArray(extras)) throw new HindsightError("invalidJSON");
      onApply({ ...extras, ...(query && q ? { q } : {}), ...(tags && tag ? { tags: tag.split(",").map(x => x.trim()).filter(Boolean), tags_match: match } : {}), ...(types && type ? { type } : {}) });
    } catch (err) { setError(err instanceof HindsightError ? err : new HindsightError("invalidJSON")); }
  }}>
    <div className="hs-filter-fields">
      {query && <Field label={t("hindsight.search")}><Input value={q} onChange={e => setQ(e.target.value)} /></Field>}
      {tags && <><Field label={t("hindsight.tags")}><Input value={tag} onChange={e => setTag(e.target.value)} /></Field>
        <Field label={t("hindsight.tagMatch")}><Select label={t("hindsight.tagMatch")} value={match} options={tagModes} onChange={setMatch} /></Field></>}
      {types && <Field label={t("hindsight.type")}><Select label={t("hindsight.type")} value={type} options={[{ value: "", label: t("hindsight.all") }, ...types]} onChange={setType} /></Field>}
      <Button type="submit">{t("hindsight.apply")}</Button>
      <Button onClick={() => { setQ(""); setTag(""); setType(""); setMatch(tagDefault); setAdvanced("{}"); onApply({}); }}>{t("hindsight.clearFilters")}</Button>
    </div>
    <details><summary>{t("hindsight.filterOptions")}</summary>
      <Field label={t("hindsight.nativeFilters")} hint={t("hindsight.filterHint")}><Textarea rows={3} className="hs-code" value={advanced} onChange={e => setAdvanced(e.target.value)} /></Field>
      {children}
    </details><ErrorNotice error={error} />
  </form>;
}

export function readFilters(value: string): NativeRecord {
  try { return record(JSON.parse(value || "{}")); } catch { return {}; }
}
export function ResultRead({ client, operation, input = {}, onRefresh, children }: {
  client: HindsightClient; operation: HindsightOperation; input?: MemoryNativeInput; onRefresh?: () => void; children?: (data: unknown) => ReactNode;
}) {
  const result = useHindsightRead(client, operation, input);
  const { t } = useTranslation();
  const refresh = onRefresh ?? result.refresh;
  return <div className="hs-read">
    <div className="hs-toolbar"><Loading loading={result.loading} /><Button size="sm" onClick={refresh}>{t("hindsight.refresh")}</Button></div>
    <ErrorNotice error={result.error} retry={refresh} />
    {result.data !== undefined && (children ? children(result.data) : <NativeDetails value={result.data} />)}
  </div>;
}
export function Tags({ client }: { client: HindsightClient }) {
  return <ResultRead client={client} operation="list_tags" input={{ query: { limit: 100 } }}>{data =>
    <div className="hs-tags">{records(record(data).items).map(item => <Badge key={text(item.tag)}>{text(item.tag)} · {text(item.count)}</Badge>)}<Raw value={data} /></div>
  }</ResultRead>;
}

export function Collection({ client, kind }: { client: HindsightClient; kind: CollectionKind }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const definition = definitions[kind];
  const filters = readFilters(location.get("filters")), offset = pageOffset(location.get("offset")), limit = 25;
  const list = useHindsightRead(client, definition.list, { query: { ...filters, limit, offset } });
  const body = record(list.data), rows = records(body.items);

  return <Section title={t(`hindsight.${kind}`)} tools={<Actions client={client} operations={definition.create} onSuccess={list.refresh} />}>
    {kind === "memories" && <Tabs label={t("hindsight.type")} value={text(filters.type)} items={["", "world", "experience", "observation"].map(value => ({value, label:t(value ? `nativeUI.${value}` : "hindsight.all")}))} onChange={value => location.set({ filters: JSON.stringify({...filters, type:value || undefined}), offset:undefined })} />}
    <p className="hs-collection-intro">{t(`nativeUI.${kind}Hint`, { defaultValue: "" })}</p>
    <Card className="hs-panel hs-collection-panel">
      <FilterBar query={definition.q} types={undefined} tagModes={definition.tagModes} tagDefault={definition.tagDefault} value={filters} onApply={value => location.set({ filters: Object.keys(value).length ? JSON.stringify(value) : undefined, offset: undefined })}>
        <Tags client={client} />
      </FilterBar>
      <div className="hs-toolbar"><Loading loading={list.loading} /><Button size="sm" onClick={list.refresh}>{t("hindsight.refresh")}</Button></div>
      <ErrorNotice error={list.error} retry={list.refresh} />
      {list.data !== undefined && <><CollectionResults kind={kind} rows={rows} onOpen={row => location.open(text(row.id ?? row.document_id))} />
        <Pagination offset={offset} limit={limit} total={typeof body.total === "number" ? body.total : undefined} count={rows.length} onChange={value => location.set({ offset: value })} /></>}
    </Card>
    {location.resource && <Modal open className="hs-resource-modal" title={t(`hindsight.${kind}`)} onClose={() => location.open("")}><ResourceDetail key={`${kind}:${location.resource}`} client={client} kind={kind} id={location.resource} onBack={() => location.open("")} /></Modal>}
  </Section>;
}

export function Attachments({ client, value }: { client: HindsightClient; value: unknown }) {
  return <div className="hs-attachments">{records(value).filter(item => item.id).map(item =>
    <FileAction key={text(item.id)} client={client} operation="get_bank_attachment" input={{ path: { attachment_id: text(item.id) } }}
      label={text(item.filename ?? item.id)} image={text(item.content_type).startsWith("image/")} />
  )}</div>;
}
function ResourceDetail({ client, kind, id, onBack }: { client: HindsightClient; kind: CollectionKind; id: string; onBack: () => void }) {
  const { t } = useTranslation(), definition = definitions[kind];
  const detail = useHindsightRead(client, definition.detail, { path: { [definition.id]: id } });
  const [revision, setRevision] = useState(0);
  const refresh = () => { detail.refresh(); setRevision(value => value + 1); };
  const data = record(detail.data);
  const selected: NativeRecord = { ...data, id };
  // Native list rows expose fact_type; get_memory details expose type.
  const actions = kind === "memories" && !["world", "experience"].includes(text(data.type)) ? [] : definition.update;
  return <Section title={text(selected.name ?? selected.canonical_name) || t(`hindsight.${kind}`)} tools={<Button onClick={onBack}>{t("hindsight.back")}</Button>}>
    <Card className="hs-panel">
      <div className="hs-toolbar"><code>{id}</code><Button size="sm" onClick={refresh}>{t("hindsight.refresh")}</Button></div>
      <Loading loading={detail.loading} /><ErrorNotice error={detail.error} retry={refresh} />
      {detail.data !== undefined && <>
        <NativeDetails value={detail.data} />
        {kind === "memories" && <><Attachments client={client} value={data.attachments} />{actions.length > 0 && <p className="hs-hint">{t("hindsight.editHint")}</p>}</>}
        <Actions client={client} operations={actions} selected={selected} onSuccess={operation => operation.startsWith("delete_") ? onBack() : refresh()} />
        {kind === "memories" && data.type === "observation" && <Section title={t("hindsight.history")}><History key={revision} client={client} operation="get_observation_history" input={{ path: { memory_id: id } }} current={!detail.loading && !detail.error ? text(data.text) : undefined} onRefresh={refresh} /></Section>}
        {kind === "documents" && <><Attachments client={client} value={data.attachments} /><Chunks key={revision} client={client} id={id} /></>}
        {kind === "entities" && <Section title={t("hindsight.memories")}><RecordTable rows={records(data.observations)} /></Section>}
        {kind === "models" && <Section title={t("hindsight.history")}><History key={revision} client={client} operation="get_mental_model_history" input={{ path: { mental_model_id: id } }} current={!detail.loading && !detail.error ? text(data.content) : undefined} onRefresh={refresh} /></Section>}
      </>}
    </Card>
  </Section>;
}
export function History({ client, operation, input, current, onRefresh }: { client: HindsightClient; operation: "get_mental_model_history" | "get_observation_history"; input: MemoryNativeInput; current?: string; onRefresh: () => void }) {
  const { t } = useTranslation();
  return <ResultRead client={client} operation={operation} input={input} onRefresh={onRefresh}>{value => {
    const body = record(value);
    const entries = records(Array.isArray(value) ? value : body.history ?? body.items);
    const field = operation === "get_observation_history" ? "previous_text" : "previous_content";
    return entries.length ? <div className="hs-history">{entries.map((entry, index) => {
      // Observations arrive oldest first; mental-model versions newest first.
      // Refresh failures are events, not versions, and do not supply an "after".
      const adjacent = operation === "get_observation_history"
        ? entries.slice(index + 1).find(item => typeof item[field] === "string")
        : entries.slice(0, index).reverse().find(item => typeof item[field] === "string");
      // Do not pair new history with stale current content while detail is
      // refreshing or has failed. Adjacent historical versions are still valid.
      const after = adjacent?.[field] ?? current;
      return <details key={text(entry.id) || index}><summary>{text(entry.changed_at ?? entry.timestamp ?? index + 1)} · {text(entry.kind ?? entry.action ?? entry.status)}</summary>
        {typeof entry[field] === "string" && <div className="hs-comparison">
          <div><h4>{t("hindsight.before")}</h4><NativeDetails value={{ content: entry[field] }} /></div>
          <div><h4>{t("hindsight.after")}</h4>{typeof after === "string" ? <NativeDetails value={{ content: after }} /> : <span>—</span>}</div>
        </div>}
        {records(entry.source_facts).length > 0 && <RecordTable rows={records(entry.source_facts)} />}
        <NativeDetails value={entry} />
      </details>;
    })}</div> : <><EmptyState title={t("hindsight.empty")} /><Raw value={value} /></>;
  }}</ResultRead>;
}
function Chunks({ client, id }: { client: HindsightClient; id: string }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const offset = pageOffset(location.get("chunks-offset")), limit = 25;
  const result = useHindsightRead(client, "list_document_chunks", { path: { document_id: id }, query: { offset, limit } });
  const body = record(result.data), chunks = records(body.items);
  return <Section title={t("hindsight.chunks")}>
    <Loading loading={result.loading} /><ErrorNotice error={result.error} retry={result.refresh} />
    {result.data !== undefined && <><RecordTable rows={chunks.map(row => ({ ...row, text: row.chunk_text, id: row.chunk_id }))} onOpen={row => location.set({ chunk: text(row.chunk_id) })} />
      <Pagination offset={offset} limit={limit} total={typeof body.total === "number" ? body.total : undefined} count={chunks.length} onChange={value => location.set({ "chunks-offset": value, chunk: undefined })} /></>}
    {location.get("chunk") && <ResultRead key={location.get("chunk")} client={client} operation="get_chunk" input={{ path: { chunk_id: location.get("chunk") } }}>{value => <>
      <NativeDetails value={{ ...record(value), content: record(value).chunk_text }} /><Attachments client={client} value={record(value).attachments} />
    </>}</ResultRead>}
  </Section>;
}
