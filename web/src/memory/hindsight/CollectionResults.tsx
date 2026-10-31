import { useTranslation } from "react-i18next";
import { FileText, Brain } from "lucide-react";
import { Badge, Button, EmptyState, Table } from "../../ui/index";
import { record, text, type NativeRecord } from "./types";
import type { CollectionKind } from "./collections";
import { RecordTable } from "./components";

function date(value: unknown) {
  const raw = text(value); if (!raw) return "—";
  const parsed = new Date(raw); return Number.isNaN(parsed.valueOf()) ? raw : parsed.toLocaleString();
}
function Facets({ value }: { value: unknown }) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(", ") : [];
  return <span className="hs-facets">{entries.length ? entries.map((item, i) => <Badge key={i}>{typeof item === "object" ? text(record(item).name ?? record(item).text ?? record(item).id) : text(item)}</Badge>) : "—"}</span>;
}
export function CollectionResults({ kind, rows, onOpen }: { kind: CollectionKind; rows: NativeRecord[]; onOpen(row: NativeRecord): void }) {
  const { t } = useTranslation();
  const open = (row: NativeRecord, label: string) => <Button variant="link" className="hs-record-open" onClick={() => onOpen(row)}>{label}</Button>;
  if (!rows.length) return <EmptyState title={t("hindsight.empty")} description={t("nativeUI.emptyHint")} />;
  if (kind === "documents") return <Table columns={[t("hindsight.documents"), t("hindsight.tags"), t("nativeUI.size"), t("nativeUI.memoryUnits"), t("hindsight.actions")]} rows={rows.map(row => [
    <div className="hs-document-name" key="name"><FileText size={18} /><div>{open(row, text(row.id ?? row.document_id))}<small>{date(row.updated_at ?? row.created_at)}</small></div></div>,
    <Facets key="tags" value={row.tags} />,
    typeof row.text_length === "number" ? `${row.text_length.toLocaleString()} B` : "—",
    typeof row.memory_unit_count === "number" ? row.memory_unit_count.toLocaleString() : "—",
    <Button key="detail" size="sm" variant="text" onClick={() => onOpen(row)}>{t("hindsight.details")}</Button>,
  ])} />;
  if (kind === "memories") return <Table columns={[t("hindsight.memories"), t("hindsight.entities"), t("hindsight.tags"), t("nativeUI.occurred"), t("nativeUI.mentioned"), t("hindsight.actions")]} rows={rows.map(row => [
    <div className="hs-memory-text" key="text">{open(row, text(row.text ?? row.id))}<div><Badge>{t(`nativeUI.${text(row.fact_type ?? row.type)}`, { defaultValue: text(row.fact_type ?? row.type) })}</Badge>{row.context ? <small>{text(row.context)}</small> : null}</div></div>,
    <Facets key="entities" value={row.entities} />, <Facets key="tags" value={row.tags} />,
    date(row.occurred_start), date(row.mentioned_at),
    <Button key="detail" size="sm" variant="text" onClick={() => onOpen(row)}>{t("hindsight.details")}</Button>,
  ])} />;
  if (kind === "models") return <div className="hs-model-grid">{rows.map((row,i) => <article key={text(row.id) || i}><Brain size={20} /><h3>{open(row,text(row.name ?? row.id))}</h3><p>{text(row.source_query)}</p><div className="hs-model-excerpt">{text(row.content)}</div><Facets value={row.tags} /><Button onClick={() => onOpen(row)}>{t("hindsight.details")}</Button></article>)}</div>;
  return <RecordTable rows={rows} onOpen={onOpen} />;
}
