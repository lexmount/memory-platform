import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Tabs } from "../../ui/index";
import { taskActionAvailable, type HindsightClient } from "./client";
import { ActionDialog, Actions, ErrorNotice, FileAction, Loading, NativeDetails, Pagination, Raw, RecordTable, Section, StateBadge, TaskResultDownload } from "./components";
import { Collection, FilterBar, readFilters, ResultRead } from "./collections";
import { useHindsightRead } from "./hooks";
import { pageOffset, useHindsightLocation } from "./navigation";
import type { HindsightOperation } from "./operations";
import { record, records, text } from "./types";
import type { MemoryBridge } from "../contracts";

function renderManagementPage(view: string, client: HindsightClient) {
  switch (view) {
    case "directives": return <Collection client={client} kind="directives" />;
    case "consolidation": return <Consolidation client={client} />;
    case "tasks": return <Tasks client={client} />;
    case "config": return <Configuration client={client} />;
    case "diagnostics": return <Diagnostics client={client} />;
    case "transfer": return <Transfer client={client} />;
    default: return null;
  }
}
export function Management({ client }: { client: HindsightClient }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const sections = ["directives", "consolidation", "tasks", "config", "diagnostics", "transfer"];
  const view = sections.includes(location.get("view")) ? location.get("view") : "directives";
  return <>
    <Tabs label={t("hindsight.management")} value={view} items={sections.map(value => ({ value, label: t(`hindsight.${value}`) }))}
      onChange={value => location.set({ view: value, resource: undefined, filters: undefined, offset: undefined })} />
    <div key={view}>{renderManagementPage(view, client)}</div>
  </>;
}
function Consolidation({ client }: { client: HindsightClient }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const offset = pageOffset(location.get("offset")), limit = 25;
  const scopes = useHindsightRead(client, "list_observation_scopes", { query: { limit, offset } });
  const data = record(scopes.data), rows = records(data.scopes);
  return <Section title={t("hindsight.consolidation")} tools={<Actions client={client} operations={["preview_consolidation_strategies", "trigger_consolidation", "recover_consolidation", "clear_observations"]} onSuccess={scopes.refresh} />}>
    <p className="hs-hint">{t("hindsight.consolidationHint")}</p>
    <Card className="hs-panel"><Loading loading={scopes.loading} /><ErrorNotice error={scopes.error} retry={scopes.refresh} />
      {scopes.data !== undefined && <><RecordTable rows={rows} /><Pagination offset={offset} limit={limit} count={rows.length} total={typeof data.total === "number" ? data.total : undefined} onChange={value => location.set({ offset: value })} /><Raw value={scopes.data} /></>}
    </Card>
  </Section>;
}
function Configuration({ client }: { client: HindsightClient }) {
  const { t } = useTranslation();
  const result = useHindsightRead(client, "get_bank_config");
  const [edit, setEdit] = useState(false);
  const data = record(result.data), overrides = record(data.overrides);
  return <Section title={t("hindsight.config")} tools={<Button size="sm" onClick={result.refresh}>{t("hindsight.refresh")}</Button>}>
    <p className="hs-hint">{t("hindsight.configHint")}</p>
    <Loading loading={result.loading} /><ErrorNotice error={result.error} retry={result.refresh} />
    {result.data !== undefined && <Card className="hs-panel">
      <div className="hs-toolbar"><Button onClick={() => setEdit(true)} disabled={!client.can("update_bank_config")}>{t("hindsight.operations.update_bank_config")}</Button>
        <Actions client={client} operations={["reset_bank_config"]} onSuccess={result.refresh} /></div>
      <Table columns={[t("hindsight.name"), t("hindsight.currentConfig"), t("hindsight.overrides")]} rows={Object.entries(record(data.config)).map(([key, value]) => [
        key, <code key="value">{JSON.stringify(value)}</code>, Object.prototype.hasOwnProperty.call(overrides, key) ? <code key="override">{JSON.stringify(overrides[key])}</code> : "—",
      ])} />
    </Card>}
    {edit && <ActionDialog client={client} operation="update_bank_config" seed={{ body: { updates: overrides } }} onClose={() => setEdit(false)} onSuccess={result.refresh} />}
  </Section>;
}

function Tasks({ client }: { client: HindsightClient }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const filters = readFilters(location.get("filters")), offset = pageOffset(location.get("offset")), limit = 25;
  const list = useHindsightRead(client, "list_operations", { query: { ...filters, limit, offset } }, {
    enabled: !location.resource,
    poll: value => records(record(value).operations).some(task => ["pending", "processing"].includes(text(task.status))),
  });
  const data = record(list.data), rows = records(data.operations);
  const [id, setID] = useState("");
  if (location.resource) return <TaskDetail key={location.resource} client={client} id={location.resource} />;
  return <Section title={t("hindsight.tasks")} tools={<Button onClick={list.refresh}>{t("hindsight.refresh")}</Button>}>
    <Card className="hs-panel">
      <form className="hs-filter-fields" onSubmit={e => { e.preventDefault(); if (id.trim()) location.open(id.trim()); }}>
        <Field label={t("hindsight.id")}><Input value={id} onChange={e => setID(e.target.value)} /></Field><Button type="submit" disabled={!id.trim()}>{t("hindsight.open")}</Button>
        <Field label={t("hindsight.status")}><Select label={t("hindsight.status")} value={text(filters.status)} onChange={status => {
          const next = { ...filters };
          if (status) next.status = status;
          else delete next.status;
          location.set({ filters: JSON.stringify(next), offset: undefined });
        }}
          options={[{ value: "", label: t("hindsight.all") }, ...["pending", "processing", "completed", "failed", "cancelled"].map(value => ({ value, label: t(`hindsight.${value}`) }))]} /></Field>
      </form>
      <FilterBar tags={false} value={filters} onApply={value => location.set({ filters: JSON.stringify(value), offset: undefined })} />
      <Loading loading={list.loading} /><ErrorNotice error={list.error} retry={list.refresh} />
      {list.data !== undefined && <><RecordTable rows={rows} onOpen={row => location.open(text(row.id ?? row.operation_id))} />
        <Pagination offset={offset} limit={limit} count={rows.length} total={typeof data.total === "number" ? data.total : undefined} onChange={value => location.set({ offset: value })} /></>}
    </Card>
  </Section>;
}
function TaskDetail({ client, id }: { client: HindsightClient; id: string }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const result = useHindsightRead(client, "get_operation_status", { path: { operation_id: id } }, { poll: value => ["pending", "processing"].includes(text(record(value).status)) });
  const data = record(result.data), status = text(data.status), batch = (data.operation_type ?? data.task_type) === "batch_retain";
  const operations: HindsightOperation[] = (["cancel_operation", "retry_operation", "delete_operation"] as const).filter(operation =>
    taskActionAvailable(operation, status) || operation === "retry_operation" && batch && status !== "not_found" && Boolean(status));
  return <Section title={t("hindsight.tasks")} tools={<Button onClick={() => location.open("")}>{t("hindsight.back")}</Button>}>
    <Card className="hs-panel"><div className="hs-toolbar"><code>{id}</code><Button onClick={result.refresh}>{t("hindsight.refresh")}</Button></div>
      <Loading loading={result.loading} /><ErrorNotice error={result.error} retry={result.refresh} />
      {result.data !== undefined && <>
        <StateBadge status={status} />{status === "not_found" && <p>{t("hindsight.notFoundHint")}</p>}
        <NativeDetails value={data} />
        {data.progress ? <Section title={t("hindsight.status")}><NativeDetails value={data.progress} /></Section> : null}
        {data.details ? <Section title={t("hindsight.result")}><NativeDetails value={data.details} /></Section> : null}
        {batch && <p className="hs-hint">{t("hindsight.batchRetryHint")}</p>}
        <Actions client={client} operations={operations} selected={{ ...data, id }} onSuccess={operation => operation === "delete_operation" ? location.open("") : result.refresh()} />
        <TaskResultDownload client={client} task={data} />
        {records(data.child_operations).length > 0 && <Section title={t("hindsight.children")}><RecordTable rows={records(data.child_operations)} onOpen={row => location.open(text(row.operation_id ?? row.id))} /></Section>}
      </>}
    </Card>
  </Section>;
}
function Diagnostics({ client }: { client: HindsightClient }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState("audit"), [period, setPeriod] = useState("7d");
  return <Section title={t("hindsight.diagnostics")}>
    <div className="hs-toolbar"><Tabs label={t("hindsight.diagnostics")} value={kind} onChange={setKind} items={["audit", "llm"].map(value => ({ value, label: t(`hindsight.${value}`) }))} />
      <Field label={t("hindsight.period")}><Select label={t("hindsight.period")} value={period} onChange={setPeriod} options={["1d", "7d", "30d"]} /></Field></div>
    <Card className="hs-panel"><ResultRead key={`${kind}:${period}`} client={client} operation={kind === "audit" ? "audit_log_stats" : "llm_request_stats"} input={{ query: { period } }} /></Card>
    <LogList key={kind} client={client} operation={kind === "audit" ? "list_audit_logs" : "list_llm_requests"} />
  </Section>;
}
function LogList({ client, operation }: { client: HindsightClient; operation: "list_audit_logs" | "list_llm_requests" }) {
  const [filters, setFilters] = useState({}), [offset, setOffset] = useState(0), [selected, setSelected] = useState<unknown>();
  const result = useHindsightRead(client, operation, { query: { ...filters, offset, limit: 25 } });
  const body = record(result.data), rows = records(body.items);
  return <Card className="hs-panel"><FilterBar tags={false} value={filters} onApply={value => { setFilters(value); setOffset(0); setSelected(undefined); }} />
    <Loading loading={result.loading} /><ErrorNotice error={result.error} retry={result.refresh} />
    {result.data !== undefined && <><RecordTable rows={rows} onOpen={setSelected} /><Pagination offset={offset} limit={25} total={typeof body.total === "number" ? body.total : undefined} count={rows.length} onChange={value => { setOffset(value); setSelected(undefined); }} /></>}
    {selected !== undefined && <NativeDetails value={selected} />}
  </Card>;
}
function TemplateExport({ client }: { client: HindsightClient }) {
  const { t } = useTranslation();
  return <ResultRead client={client} operation="export_bank_template">{value => <><NativeDetails value={value} /><JSONDownload value={value} filename="hindsight-template.json" label={t("hindsight.downloadTemplate")} /></>}</ResultRead>;
}
// Kept separate from provider file downloads: this is the JSON already read
// through the authenticated API, encoded in a data URI without object URLs.
export function JSONDownload({ value, filename, label }: { value: unknown; filename: string; label: string }) {
  return <a className="ifd-button" download={filename} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`}>{label}</a>;
}
function Transfer({ client }: { client: HindsightClient }) {
  const { t } = useTranslation();
  const [showExport, setShowExport] = useState(false), [key, setKey] = useState("");
  return <Section title={t("hindsight.transfer")}>
    <Card className="hs-panel"><h3>{t("hindsight.manifest")}</h3><p>{t("hindsight.templateHint")}</p>
      <div className="hs-toolbar"><Actions client={client} operations={["import_bank_template"]} />
        <Button disabled={!client.can("export_bank_template")} onClick={() => setShowExport(value => !value)}>{t("hindsight.operations.export_bank_template")}</Button></div>
      {showExport && <TemplateExport client={client} />}
    </Card>
    <Card className="hs-panel"><h3>{t("hindsight.transfer")}</h3><p>{t("hindsight.exportHint")}</p><p className="hs-hint">{t("hindsight.merge")}</p>
      <Actions client={client} operations={["export_bank_transfer", "import_bank_transfer"]} />
      <Field label={t("hindsight.downloadKey")}><Input value={key} onChange={e => setKey(e.target.value)} /></Field>
      {key.trim() && <FileAction key={key.trim()} client={client} operation="download_file" input={{ path: { key: key.trim() } }} />}
    </Card>
  </Section>;
}

export function Overview({ client, formatTimeBucket }: { client: HindsightClient; formatTimeBucket?: MemoryBridge["formatTimeBucket"] }) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState("7d"), [timeField, setTimeField] = useState("created_at");
  const stats = useHindsightRead(client, "get_agent_stats");
  const series = useHindsightRead(client, "get_memories_timeseries", { query: { period, time_field: timeField } });
  const data = record(stats.data), buckets = records(record(series.data).buckets);
  const granularity = record(series.data).trunc === "day" ? "day" : "hour";
  const bucketTime = (value: unknown) => {
    const bucket = text(value);
    if (formatTimeBucket) return formatTimeBucket(bucket, granularity, i18n.language);
    const date = new Date(bucket);
    return Number.isNaN(date.getTime()) ? bucket : new Intl.DateTimeFormat(i18n.language, {
      month: "short", day: "numeric", ...(granularity === "hour" ? { hour: "2-digit", minute: "2-digit", hour12: false } as const : {}),
    }).format(date);
  };
  const maximum = Math.max(1, ...buckets.map(bucket => Number(bucket.world ?? 0) + Number(bucket.experience ?? 0) + Number(bucket.observation ?? 0)));
  return <Section title={t("hindsight.overview")} tools={<Button onClick={() => { stats.refresh(); series.refresh(); }}>{t("hindsight.refresh")}</Button>}>
    <Loading loading={stats.loading} /><ErrorNotice error={stats.error} retry={stats.refresh} />
    {stats.data !== undefined && <>
      <div className="hs-stats">{[["total_nodes", "memories"], ["total_documents", "documents"], ["total_links", "relations"], ["pending_operations", "pending"], ["failed_operations", "failed"]].map(([key, label]) =>
        <Card key={key} className="hs-stat"><span>{t(`hindsight.${label}`)}</span><strong>{text(data[key!])}</strong></Card>)}</div>
      <div className="hs-tags">{Object.entries(record(data.nodes_by_fact_type)).map(([type, count]) => <Badge key={type}>{type}: {text(count)}</Badge>)}</div>
      <Raw value={stats.data} />
    </>}
    <Card className="hs-panel"><div className="hs-toolbar">
      <Field label={t("hindsight.period")}><Select label={t("hindsight.period")} value={period} onChange={setPeriod} options={["1h", "12h", "1d", "7d", "30d", "90d"]} /></Field>
      <Field label={t("hindsight.timeField")}><Select label={t("hindsight.timeField")} value={timeField} onChange={setTimeField} options={["created_at", "mentioned_at", "occurred_start"]} /></Field>
    </div><Loading loading={series.loading} /><ErrorNotice error={series.error} retry={series.refresh} />
      {series.data !== undefined && <>{buckets.length ? <div className="hs-bars" role="img" aria-label={t("hindsight.buckets")}>{buckets.map((bucket, index) => {
        const count = Number(bucket.world ?? 0) + Number(bucket.experience ?? 0) + Number(bucket.observation ?? 0);
        return <div key={index} className="hs-bar" style={{ height: `${Math.max(1, count / maximum * 100)}%` }} title={`${bucketTime(bucket.time)} · ${count}`} />;
      })}</div> : <EmptyState title={t("hindsight.empty")} />}
        <details><summary>{t("hindsight.buckets")}</summary><Table columns={[t("hindsight.time"), "world", "experience", "observation"]} rows={buckets.map(bucket => [bucketTime(bucket.time), text(bucket.world), text(bucket.experience), text(bucket.observation)])} /></details></>}
    </Card>
  </Section>;
}
