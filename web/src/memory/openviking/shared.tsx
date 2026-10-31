import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge, Button, EmptyState, Field, Input, Select, Switch } from "../../ui/index";
import { display, object, OVError, text, type Receipt } from "./client";
import type { ReadState } from "./hooks";

export function FormSelect({ name, label, defaultValue, options }: {
  name: string; label: string; defaultValue: string; options: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(defaultValue);
  return <><input type="hidden" name={name} value={value} /><Select label={label} value={value} onChange={setValue} options={options} /></>;
}
export function FormSwitch({ name, label, defaultChecked = false }: { name: string; label: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return <div className="ov-toggle"><input type="hidden" name={name} value={checked ? "true" : ""} />
    <Switch checked={checked} onChange={setChecked} label={label} /><span>{label}</span>
  </div>;
}
export function KeepRecentField({ value, onChange, disabled }: {
  value: number | ""; onChange(value: number | ""): void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <Field label={t("ov.keepRecent")} hint={t("ov.keepRecentHint")}>
    <Input type="number" min={0} max={10000} step={1} required disabled={disabled} value={value}
      onChange={event => onChange(event.target.value === "" ? "" : event.target.valueAsNumber)} />
  </Field>;
}
export function ErrorNotice({ error }: { error?: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const native = error instanceof OVError ? error : undefined;
  return <div className="ov-error" role="alert">
    <strong>{t(`ov.${native && ["permission", "unsupported", "invalidResponse"].includes(native.kind) ? native.kind : "error"}`)}</strong>
    {native?.status ? <span>HTTP {native.status}</span> : null}
    {native?.kind === "native" && <p>{native.message}</p>}
    {native?.dispatched && <p>{t("ov.uncertain")}</p>}
  </div>;
}
export function LoadState<T>({ state, children, empty = false }: { state: ReadState<T>; children: (data: T) => ReactNode; empty?: boolean }) {
  const { t } = useTranslation();
  if (state.error) return <><ErrorNotice error={state.error} /><Button onClick={state.reload}>{t("ov.retry")}</Button></>;
  if (state.loading) return <p className="ov-muted" role="status">{t("ov.loading")}</p>;
  if (empty) return <EmptyState title={t("ov.empty")} description={t("ov.emptyDescription")} />;
  return state.data === undefined ? null : <>{children(state.data)}</>;
}
export function NativeDetails({ value, label }: { value: unknown; label?: string }) {
  const { t } = useTranslation();
  return <details className="ov-native"><summary>{label ?? t("ov.raw")}</summary><pre>{display(value)}</pre></details>;
}
export function ContentText({ value }: { value: unknown }) {
  const content = typeof value === "string" ? value : text(object(value).content) || display(value);
  return <div className="ov-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    table: ({ children }) => <div className="ov-table-scroll"><table>{children}</table></div>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    // Remote images can exfiltrate page visits; render memory text without
    // loading embedded third-party resources.
    img: ({ alt }) => <span>{alt}</span>,
  }}>{content}</ReactMarkdown></div>;
}
export function Pagination({ offset, size = 50, more, onChange }: { offset: number; size?: number; more: boolean; onChange: (offset: number) => void }) {
  const { t } = useTranslation();
  return <div className="ov-pagination">
    <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>{t("ov.previous")}</Button>
    <span>{Math.floor(offset / size) + 1}</span>
    <Button disabled={!more} onClick={() => onChange(offset + size)}>{t("ov.next")}</Button>
  </div>;
}
export function ReceiptNotice({ receipt, onTask }: { receipt?: Receipt; onTask: (id: string) => void }) {
  const { t } = useTranslation();
  if (!receipt) return null;
  const taskID = text(receipt.task_id);
  let message = t("ov.submitted");
  if (receipt.reason === "no_messages") message = t("ov.noMessages");
  else if (receipt.status === "skipped") message = t("ov.skipped");
  return <div className="ov-receipt" role="status">
    <p>{message}</p>
    {taskID && <Button onClick={() => onTask(taskID)}>{t("ov.viewTask")}</Button>}
    <NativeDetails value={receipt} />
  </div>;
}
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  let tone: "green" | "red" | "blue" | "neutral" = "neutral";
  switch (status) {
    case "completed": tone = "green"; break;
    case "failed": tone = "red"; break;
    case "running": case "pending": case "cancelling": tone = "blue"; break;
  }
  return <Badge tone={tone}>
    {t(`ov.${status}`, { defaultValue: status })}
  </Badge>;
}
