import { useTranslation } from "react-i18next";
import { Button, Card, EmptyState, Field, Input, SectionHeader, Table } from "../../ui/index";
import type { MemoryWorkspaceContext } from "../contracts";
import { memoryURI, object, OVError, text, type OVClient } from "./client";
import { offsetParam, useOVLocation, useOVRead } from "./hooks";
import { ContentText, LoadState, NativeDetails, Pagination } from "./shared";
import { RetrievalResults } from "./Retrieval";

type Props = { context: MemoryWorkspaceContext; client: OVClient };
export function ExperiencePage({ context, client }: Props) {
  const { t } = useTranslation();
  const { params, set, navigationKey } = useOVLocation();
  const root = (context.user.mapping.memory_uri ?? "");
  const base = root + "/experiences";
  const selected = params.get("experience") ?? "";
  const keyword = params.get("q") ?? "";
  const offset = offsetParam(params);
  const list = useOVRead(context, JSON.stringify([navigationKey, base, offset, keyword]), async signal => {
    try {
      return keyword ? await client.retrieve("find", { uri: base, query: keyword, limit: 50, level: 2 }, signal)
        : await client.list(base, offset, false, signal);
    } catch (error) {
      // A new subject has no experiences directory until its first extraction.
      if (!keyword && error instanceof OVError && error.status === 404) return [];
      throw error;
    }
  });
  const valid = !selected || (selected.startsWith(base + "/") && memoryURI(root, selected));
  return <>
    <SectionHeader title={t("ov.experience")} description={t("ov.experienceDescription")} actions={<Button onClick={list.reload}>{t("ov.refresh")}</Button>} />
    <p className="ov-muted">{t("ov.selfOnly")} {t("ov.lineageHint")}</p>
    <Card className="ov-panel">
      <form key={keyword} className="ov-toolbar" onSubmit={event => {
        event.preventDefault(); set({ q: new FormData(event.currentTarget).get("q")!.toString().trim(), offset: null });
      }}>
        <Field label={t("ov.query")}><Input name="q" defaultValue={keyword} /></Field><Button type="submit">{t("ov.search")}</Button>
      </form>
      <LoadState state={list}>{value => {
        const data = object(value);
        let entries: unknown[] = [];
        if (Array.isArray(value)) entries = value;
        else if (Array.isArray(data.memories)) entries = data.memories;
        const files = entries.slice(0, 50).filter(raw => {
          const row = object(raw);
          return row.isDir !== true && text(row.uri).startsWith(base + "/") && memoryURI(root, text(row.uri)) && text(row.uri).endsWith(".md");
        });
        return <>
          {!files.length && <EmptyState title={t("ov.empty")} description={t("ov.emptyDescription")} />}
          <Table columns={[t("ov.name"), t("ov.modified"), ""]} rows={files.map(raw => {
            const row = object(raw), uri = text(row.uri);
            return [text(row.name) || uri.split("/").pop(), text(row.modTime), <Button onClick={() => set({ experience: uri, trajectoryOffset: null })}>{t("ov.open")}</Button>];
          })} />
          {!keyword && <Pagination offset={offset} more={entries.length > 50} onChange={value => set({ offset: value })} />}
        </>;
      }}</LoadState>
    </Card>
    {!valid && <p className="ov-error" role="alert">{t("ov.selfOnly")}</p>}
    {selected && valid && <ExperienceDetail key={selected} context={context} client={client} uri={selected} />}
  </>;
}
function ExperienceDetail({ context, client, uri }: Props & { uri: string }) {
  const { t } = useTranslation();
  const { params, set, go } = useOVLocation();
  const start = params.get("start") ?? "", end = params.get("end") ?? "";
  const offset = offsetParam(params, "trajectoryOffset");
  const content = useOVRead(context, uri, signal => client.read(uri, "read", signal));
  const attrs = useOVRead(context, uri, signal => client.attrs(uri, signal));
  const trajectories = useOVRead(context, JSON.stringify([uri, start, end, offset]), signal => client.trajectories(uri, offset, start, end, signal));
  const outcomes = useOVRead(context, JSON.stringify([uri, start, end]), signal => client.outcomes(uri, start, end, signal));
  return <Card className="ov-panel">
    <div className="ov-title-row"><h2>{uri.split("/").pop()}</h2><div className="ov-actions">
      <Button onClick={() => go("content", { uri, directory: uri.slice(0, uri.lastIndexOf("/")) })}>{t("ov.content")}</Button>
      <Button onClick={() => set({ experience: null })}>{t("ov.close")}</Button>
    </div></div>
    <LoadState state={content}>{value => <ContentText value={value} />}</LoadState>
    <LoadState state={attrs}>{value => <NativeDetails value={value} label={t("ov.source")} />}</LoadState>
    <form key={`${start}:${end}`} className="ov-toolbar" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      set({ start: form.get("start")!.toString(), end: form.get("end")!.toString(), trajectoryOffset: null });
    }}>
      <Field label={t("ov.startDate")}><Input type="date" name="start" defaultValue={start} /></Field>
      <Field label={t("ov.endDate")}><Input type="date" name="end" defaultValue={end} /></Field>
      <Button type="submit">{t("ov.apply")}</Button>
    </form>
    <h3>{t("ov.outcomes")}</h3>
    <LoadState state={outcomes}>{value => {
      const rows = object(value).outcome_distribution;
      return <>{Array.isArray(rows) ? <Table columns={[t("ov.status"), t("ov.count")]} rows={rows.map(raw => {
        const row = object(raw), outcome = text(row.outcome);
        return [t(`ov.${outcome}`, { defaultValue: outcome }), typeof row.count === "number" ? row.count : "—"];
      })} /> : <NativeDetails value={value} />}</>;
    }}</LoadState>
    <h3>{t("ov.trajectories")}</h3>
    <LoadState state={trajectories}>{value => {
      const data = object(value);
      return <><RetrievalResults value={value} root={(context.user.mapping.memory_uri ?? "")} />
        <Pagination offset={offset} size={20} more={data.has_more === true || offset + (Array.isArray(data.items) ? data.items.length : 0) < Number(data.total || 0)}
          onChange={value => set({ trajectoryOffset: value })} />
      </>;
    }}</LoadState>
  </Card>;
}
