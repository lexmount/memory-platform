import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, EmptyState, Field, Input, Modal, SectionHeader, Select, Table } from "../../ui/index";
import type { MemoryWorkspaceContext } from "../contracts";
import { activeTask, memoryURI, object, text, validKeepRecentCount, type NativeObject, type OVClient, type Receipt } from "./client";
import { useOVLocation, useOVMutation, useOVRead } from "./hooks";
import { ErrorNotice, KeepRecentField, LoadState, NativeDetails, ReceiptNotice, StatusBadge } from "./shared";

type Props = { context: MemoryWorkspaceContext; client: OVClient };
function createdAt(task: NativeObject) {
  if (typeof task.created_at_iso === "string") return task.created_at_iso;
  if (typeof task.created_at === "number" && Number.isFinite(task.created_at)) {
    const date = new Date(task.created_at * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return "—";
}
export function TasksPage({ context, client }: Props) {
  const { t } = useTranslation();
  const { params, set } = useOVLocation();
  const type = params.get("taskType") ?? "";
  const status = params.get("status") ?? "";
  const resource = params.get("resource") ?? "";
  const cursor = params.get("cursor") ?? "";
  const task = params.get("task") ?? "";
  const root = "viking://";
  const valid = !resource.startsWith("viking:") || memoryURI(root, resource);
  const list = useOVRead(context, JSON.stringify([type, status, resource, cursor]), signal => client.tasks(type, status, resource, cursor, signal), valid,
    page => page.items.some(activeTask) ? 10000 : false);
  return <>
    <SectionHeader title={t("ov.tasks")} description={t("ov.tasksDescription")} actions={<Button onClick={list.reload}>{t("ov.refresh")}</Button>} />
    <Card className="ov-panel">
      <div className="ov-form-grid">
        <Field label={t("ov.taskType")}><Select label={t("ov.taskType")} value={type} options={["", "session_commit", "admin_reindex", "add_resource", "add_skill", "connector_import", "compile"].map(value => ({ value, label: value ? t(`ov.${value}`, { defaultValue: value }) : t("ov.all") }))}
          onChange={value => set({ taskType: value, resource: null, cursor: null })} /></Field>
        <Field label={t("ov.status")}><Select label={t("ov.status")} value={status} options={["", "pending", "running", "cancelling", "completed", "failed", "cancelled"].map(value => ({ value, label: t(`ov.${value || "all"}`) }))}
          onChange={value => set({ status: value, cursor: null })} /></Field>
      </div>
      <form key={resource} className="ov-toolbar" onSubmit={event => {
        event.preventDefault(); set({ resource: new FormData(event.currentTarget).get("resource")!.toString().trim(), cursor: null });
      }}>
        <Field label={t(type === "admin_reindex" ? "ov.uri" : "ov.resourceID")} hint={type === "admin_reindex" ? t("ov.reindexFilterHint") : undefined}><Input name="resource" defaultValue={resource} /></Field>
        <Button type="submit">{t("ov.apply")}</Button>
      </form>
      {!valid ? <EmptyState title={t("ov.reindexFilterHint")} /> : <LoadState state={list}>{page => <>
        <Table columns={[t("ov.name"), t("ov.status"), t("ov.resourceID"), t("ov.created"), ""]} rows={page.items.map(item => [
          <code>{item.task_id}</code>, <StatusBadge status={item.status} />, text(item.resource_id), createdAt(item),
          <Button onClick={() => set({ task: item.task_id })}>{t("ov.details")}</Button>,
        ])} />
        <div className="ov-pagination">
          <Button disabled={!cursor} onClick={() => set({ cursor: null })}>{t("ov.firstPage")}</Button>
          <Button disabled={!page.has_more} onClick={() => set({ cursor: page.next_cursor })}>{t("ov.next")}</Button>
        </div>
      </>}</LoadState>}
    </Card>
    {task && <TaskDetail key={task} context={context} client={client} id={task} />}
  </>;
}
function TaskDetail({ context, client, id }: Props & { id: string }) {
  const { t } = useTranslation();
  const { set } = useOVLocation();
  const [confirm, setConfirm] = useState<"cancel" | "resubmit" | null>(null);
  const [keep, setKeep] = useState<number | "">("");
  const [receipt, setReceipt] = useState<Receipt>();
  const mutation = useOVMutation(context);
  const detail = useOVRead(context, id, signal => client.task(id, signal), true, value => activeTask(value) ? 2000 : false);
  const task = detail.data;
  const history = object(task?.execution_events);
  const resource = text(task?.resource_id);
  const commit = task?.task_type === "session_commit";
  const submittingCommit = confirm === "resubmit" && commit;
  const resubmit = Boolean(task && ["failed", "cancelled"].includes(task.status) && resource &&
    (commit ? client.can("commit_session") : task.task_type === "admin_reindex" && client.can("reindex") && memoryURI("viking://", resource)));
  return <Card className="ov-panel">
    <div className="ov-title-row"><h2>{id}</h2><Button onClick={() => set({ task: null })}>{t("ov.close")}</Button></div>
    <LoadState state={detail}>{value => <>
      <div className="ov-title-row"><StatusBadge status={value.status} /><span>{t(`ov.${value.task_type}`, { defaultValue: value.task_type })}</span></div>
      <dl className="ov-facts">
        <div><dt>{t("ov.resourceID")}</dt><dd>{text(value.resource_id)}</dd></div>
        <div><dt>{t("ov.stage")}</dt><dd>{text(value.stage) || "—"}</dd></div>
        <div><dt>{t("ov.created")}</dt><dd>{createdAt(value)}</dd></div>
      </dl>
      <div className="ov-actions">
        <Button onClick={detail.reload}>{t("ov.refresh")}</Button>
        <Button disabled={!activeTask(value) || !["session_commit", "admin_reindex", "add_resource", "add_skill", "compile", "snapshot_restore_reindex"].includes(value.task_type ?? "") || value.status === "cancelling" || !client.can("cancel_task") || mutation.pending} onClick={() => setConfirm("cancel")}>{t("ov.cancelTask")}</Button>
        <Button disabled={!resubmit || mutation.pending} onClick={() => setConfirm("resubmit")}>{t("ov.resubmit")}</Button>
      </div>
      <ErrorNotice error={mutation.error} />
      <ReceiptNotice receipt={receipt} onTask={task => set({ task })} />
      {text(value.error) && <p className="ov-error">{text(value.error)}</p>}
      {history.started_mid_task === true || Number(history.dropped_count) > 0 ? <p className="ov-muted">{t("ov.eventHistoryPartial")}</p> : null}
      {Array.isArray(history.items) ? <Table columns={[t("ov.created"), t("ov.events")]} rows={history.items.map(event => {
        const row = object(event);
        return [text(row.recorded_at), <><p>{text(row.kind)} · {text(row.stage) || text(row.status)}</p>{text(row.error) && <p>{text(row.error)}</p>}<NativeDetails value={event} /></>];
      })} /> : <p className="ov-muted">{t("ov.eventHistoryUnavailable")}</p>}
      <NativeDetails value={value} />
    </>}</LoadState>
    <Modal open={confirm !== null} onClose={() => { if (!mutation.pending) setConfirm(null); }} title={t(confirm === "cancel" ? "ov.cancelTask" : "ov.resubmit")} footer={<Button
      variant={confirm === "cancel" ? "danger" : "primary"} disabled={mutation.pending || (submittingCommit && !validKeepRecentCount(keep))}
      onClick={() => {
        if (submittingCommit && !validKeepRecentCount(keep)) return;
        void mutation.run(
          signal => {
            if (confirm === "cancel") return client.cancelTask(id, signal);
            if (commit) return client.commit(resource, Number(keep), signal);
            return client.reindex(resource, signal);
          },
          result => {
            if (confirm === "resubmit") setReceipt(result);
            // Cancellation is cooperative; refreshing starts/continues polling
            // while the server still reports pending/running/cancelling.
            setConfirm(null); detail.reload();
          },
        );
      }}>{t(mutation.pending ? "ov.working" : "ov.submit")}</Button>}>
      <p>{t(confirm === "cancel" ? "ov.cancelTaskHint" : "ov.resubmitHint")}</p>
      {submittingCommit && <>
        <p>{t("ov.resubmitCommitHint")}</p>
        <KeepRecentField value={keep} onChange={setKeep} disabled={mutation.pending} />
      </>}
      <ErrorNotice error={mutation.error} />
    </Modal>
  </Card>;
}
