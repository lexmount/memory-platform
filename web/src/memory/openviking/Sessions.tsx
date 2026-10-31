import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Modal, SectionHeader, Select, Table, Tabs, Textarea } from "../../ui/index";
import type { MemoryWorkspaceContext } from "../contracts";
import { display, object, text, validKeepRecentCount, type NativeObject, type OVClient, type Receipt } from "./client";
import { offsetParam, useOVLocation, useOVMutation, useOVRead } from "./hooks";
import { ContentText, ErrorNotice, KeepRecentField, LoadState, NativeDetails, Pagination, ReceiptNotice } from "./shared";

type Props = { context: MemoryWorkspaceContext; client: OVClient };
export function SessionsPage({ context, client }: Props) {
  const { t } = useTranslation();
  const { params, set } = useOVLocation();
  const id = params.get("session") ?? "";
  const offset = offsetParam(params);
  const [creating, setCreating] = useState(false);
  const [newID, setNewID] = useState("");
  const mutation = useOVMutation(context);
  const sessions = useOVRead(context, "sessions", signal => client.sessions(signal));
  return <>
    <SectionHeader title={t("ov.sessions")} description={t("ov.sessionsDescription")} actions={<div className="ov-actions">
      <Button onClick={sessions.reload}>{t("ov.refresh")}</Button>
      <Button variant="primary" icon={<Plus size={16} />} disabled={!client.can("create_session")} onClick={() => setCreating(true)}>{t("ov.newSession")}</Button>
    </div>} />
    {id ? <><Button onClick={() => set({ session: null, tab: null, archive: null, tool: null, toolQuery: null })}>{t("ov.back")}</Button>
      <SessionDetail key={id} context={context} client={client} id={id} onDelete={() => { set({ session: null, tab: null, archive: null, tool: null }); sessions.reload(); }} />
    </> : <Card className="ov-panel"><LoadState state={sessions} empty={sessions.data?.length === 0}>{rows => <>
      <Table columns={[t("ov.sessionID"), t("ov.modified"), ""]} rows={rows.slice(offset, offset + 20).map(row => [
        <code>{row.session_id}</code>, text(row.mod_time) || text(row.updated_at),
        <Button onClick={() => set({ session: row.session_id, tab: null })}>{t("ov.open")}</Button>,
      ])} />
      <Pagination offset={offset} size={20} more={offset + 20 < rows.length} onChange={value => set({ offset: value })} />
    </>}</LoadState></Card>}
    <Modal open={creating} onClose={() => { if (!mutation.pending) setCreating(false); }} title={t("ov.newSession")} footer={<Button variant="primary" disabled={mutation.pending} onClick={() =>
      void mutation.run(signal => client.createSession(newID.trim(), signal), result => {
        setCreating(false); setNewID(""); sessions.reload();
        set({ session: result.session_id, tab: null });
      })
    }>{t(mutation.pending ? "ov.working" : "ov.create")}</Button>}>
      <Field label={t("ov.optionalSessionID")}><Input disabled={mutation.pending} value={newID} onChange={event => setNewID(event.target.value)} /></Field>
      <ErrorNotice error={mutation.error} />
    </Modal>
  </>;
}

function SessionDetail({ context, client, id, onDelete }: Props & { id: string; onDelete(): void }) {
  const { t } = useTranslation();
  const { params, set, go } = useOVLocation();
  const tab = params.get("tab") ?? "context";
  const archive = params.get("archive") ?? "";
  const [confirm, setConfirm] = useState<"delete" | "commit" | null>(null);
  const [keep, setKeep] = useState<number | "">(0);
  const [role, setRole] = useState("user");
  const [message, setMessage] = useState("");
  const [parts, setParts] = useState("");
  const [partsError, setPartsError] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const mutation = useOVMutation(context);
  const confirmLabel = confirm === "delete" ? "ov.deleteSession" : "ov.commit";
  const session = useOVRead(context, id, signal => client.session(id, signal));
  const current = useOVRead(context, `${id}:${tab}:${archive}`, signal =>
    tab === "archive" ? client.archive(id, archive, signal) : client.context(id, signal),
  tab === "context" || (tab === "archive" && Boolean(archive)));
  const refresh = () => { session.reload(); current.reload(); };
  return <Card className="ov-panel">
    <div className="ov-title-row"><h2>{id}</h2><div className="ov-actions">
      <Button onClick={refresh}>{t("ov.refresh")}</Button>
      <Button disabled={!client.can("commit_session") || mutation.pending} onClick={() => setConfirm("commit")}>{t("ov.commit")}</Button>
      <Button variant="danger" disabled={!client.can("delete_session") || mutation.pending} onClick={() => setConfirm("delete")}>{t("ov.deleteSession")}</Button>
    </div></div>
    <LoadState state={session}>{value => <NativeDetails value={value} />}</LoadState>
    <ReceiptNotice receipt={receipt} onTask={task => go("tasks", { task })} />
    <ErrorNotice error={mutation.error} />
    <Tabs label={t("ov.sessions")} value={tab} items={["context", "archive", "tools"].map(value => ({ value, label: t(`ov.${value}`) }))} onChange={value => set({ tab: value })} />
    {tab === "archive" && <form key={archive} className="ov-toolbar" onSubmit={event => {
      event.preventDefault(); set({ archive: new FormData(event.currentTarget).get("archive")!.toString().trim() });
    }}>
      <Field label={t("ov.archiveID")} hint={t("ov.archiveHint")}><Input name="archive" defaultValue={archive} placeholder="archive_001" required /></Field>
      <Button type="submit">{t("ov.loadArchive")}</Button>
      {Number.isSafeInteger(session.data?.commit_count) && Number(session.data?.commit_count) > 0 && <Button onClick={() =>
        set({ archive: `archive_${String(session.data!.commit_count).padStart(3, "0")}` })
      }>{t("ov.latestArchive")}</Button>}
    </form>}
    {tab === "tools" ? <ToolResults key={id} context={context} client={client} id={id} /> : <LoadState state={current}>{value => <Messages value={value} />}</LoadState>}
    {tab === "context" && <form className="ov-form ov-composer" onSubmit={event => {
      event.preventDefault(); setPartsError("");
      if (message.trim() && parts.trim()) { setPartsError(t("ov.messageInputConflict")); return; }
      let parsed: NativeObject[] | undefined;
      if (parts.trim()) {
        try {
          const value: unknown = JSON.parse(parts);
          if (!Array.isArray(value) || !value.length || value.some(part => !part || typeof part !== "object" || Array.isArray(part))) throw new Error();
          parsed = value as NativeObject[];
        } catch { setPartsError(t("ov.invalidParts")); return; }
      }
      void mutation.run(signal => client.addMessage(id, parsed ? { role, parts: parsed } : { role, content: message }, signal), () => { setMessage(""); setParts(""); refresh(); });
    }}>
      <p className="ov-muted">{t("ov.messageHint")}</p>
      <Field label={t("ov.role")}><Select disabled={mutation.pending} value={role} onChange={setRole} label={t("ov.role")} options={[{ value: "user", label: t("ov.userRole") }, { value: "assistant", label: t("ov.assistantRole") }]} /></Field>
      <Field label={t("ov.message")}><Textarea disabled={mutation.pending} value={message} onChange={event => setMessage(event.target.value)} rows={4} /></Field>
      <details><summary>{t("ov.advanced")}</summary><Field label={t("ov.parts")}><Textarea disabled={mutation.pending} value={parts} onChange={event => setParts(event.target.value)} rows={5} /></Field></details>
      {partsError && <p role="alert">{partsError}</p>}
      <Button variant="primary" type="submit" disabled={!client.can("add_message") || mutation.pending || (!message.trim() && !parts.trim())}>{t(mutation.pending ? "ov.working" : "ov.addMessage")}</Button>
    </form>}
    <Modal open={confirm !== null} onClose={() => { if (!mutation.pending) setConfirm(null); }} title={t(confirm === "delete" ? "ov.deleteSession" : "ov.commit")} footer={<Button
      variant={confirm === "delete" ? "danger" : "primary"} disabled={mutation.pending || (confirm === "commit" && !validKeepRecentCount(keep))}
      onClick={() => {
        if (confirm === "commit" && !validKeepRecentCount(keep)) return;
        void mutation.run(
          signal => confirm === "delete" ? client.deleteSession(id, signal) : client.commit(id, Number(keep), signal),
          value => { if (confirm === "delete") onDelete(); else { setReceipt(object(value)); refresh(); } setConfirm(null); },
        );
      }}>{t(mutation.pending ? "ov.working" : confirmLabel)}</Button>}>
      <p>{t(confirm === "delete" ? "ov.deleteHint" : "ov.commitHint")}</p>
      {confirm === "commit" && <KeepRecentField value={keep} onChange={setKeep} disabled={mutation.pending} />}
      <ErrorNotice error={mutation.error} />
    </Modal>
  </Card>;
}

function Messages({ value }: { value: unknown }) {
  const { t } = useTranslation();
  const data = object(value);
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return <div className="ov-messages">
    {data.latest_archive_overview !== null && data.latest_archive_overview !== undefined && <ContentText value={data.latest_archive_overview} />}
    {data.abstract !== null && data.abstract !== undefined && <ContentText value={data.abstract} />}
    {data.overview !== null && data.overview !== undefined && <ContentText value={data.overview} />}
    {!messages.length && <EmptyState title={t("ov.empty")} />}
    {messages.map((item, index) => {
      const message = object(item);
      return <article className="ov-message" key={text(message.id) || index}>
        <strong>{text(message.role)}</strong><ContentText value={message.content ?? ""} />
        {Array.isArray(message.parts) && message.parts.map((part, index) => {
          const record = object(part);
          return record.type === "text" ? <ContentText key={index} value={record.text ?? record.content} /> : <NativeDetails key={index} value={part} />;
        })}
      </article>;
    })}
    <NativeDetails value={value} />
  </div>;
}

function ToolResults({ context, client, id }: Props & { id: string }) {
  const { t } = useTranslation();
  const { params, set } = useOVLocation();
  const name = params.get("toolName") ?? "";
  const selected = params.get("tool") ?? "";
  const query = params.get("toolQuery") ?? "";
  const offset = offsetParam(params, "toolOffset");
  const list = useOVRead(context, `${id}:${name}`, signal => client.toolResults(id, name, signal));
  const read = useOVRead(context, JSON.stringify([id, selected, offset, query]), signal => query
    ? client.searchToolResult(id, selected, query, signal) : client.toolResult(id, selected, offset, signal), Boolean(selected));
  return <>
    <p className="ov-muted">{t("ov.toolListHint")}</p>
    <form key={name} className="ov-toolbar" onSubmit={event => {
      event.preventDefault(); set({ toolName: new FormData(event.currentTarget).get("name")?.toString() ?? "" });
    }}><Field label={t("ov.toolName")}><Input name="name" defaultValue={name} /></Field><Button type="submit">{t("ov.apply")}</Button></form>
    <LoadState state={list}>{value => {
      const data = object(value);
      let rows: unknown[] = [];
      if (Array.isArray(value)) rows = value;
      else if (Array.isArray(data.tool_results)) rows = data.tool_results;
      else if (Array.isArray(data.items)) rows = data.items;
      return <><Table columns={[t("ov.toolResultID"), t("ov.toolName"), ""]} rows={rows.map(raw => {
        const row = object(raw); const resultID = text(row.tool_result_id) || text(row.id);
        return [resultID, text(row.tool_name), <Button disabled={!resultID} onClick={() => set({ tool: resultID, toolOffset: null, toolQuery: null })}>{t("ov.open")}</Button>];
      })} /><NativeDetails value={value} /></>;
    }}</LoadState>
    <form key={`${selected}:${query}:${offset}`} className="ov-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      set({ tool: form.get("tool")!.toString(), toolQuery: form.get("q")!.toString().trim(), toolOffset: form.get("offset")!.toString() });
    }}>
      <div className="ov-form-grid">
        <Field label={t("ov.toolResultID")}><Input name="tool" defaultValue={selected} required /></Field>
        <Field label={t("ov.findInTool")}><Input name="q" defaultValue={query} /></Field>
        <Field label={t("ov.offset")}><Input name="offset" type="number" min={0} defaultValue={offset} /></Field>
      </div><Button type="submit">{t("ov.load")}</Button>
    </form>
    <LoadState state={read}>{value => {
      const data = object(value);
      return <>{query && Array.isArray(data.matches) ? data.matches.map((raw, index) => {
        const match = object(raw);
        return <article className="ov-message" key={index}><small>{t("ov.offset")}: {Number(match.offset)}</small><ContentText value={match.snippet} /></article>;
      }) : <ContentText value={data.content ?? display(value)} />}
        {!query && <Pagination offset={offset} size={20000} more={data.has_more === true} onChange={value => set({ toolOffset: value })} />}
        <NativeDetails value={value} />
      </>;
    }}</LoadState>
  </>;
}
