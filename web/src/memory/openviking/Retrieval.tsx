import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, EmptyState, Field, Input, SectionHeader, Table, Tabs, Textarea } from "../../ui/index";
import type { MemoryWorkspaceContext } from "../contracts";
import { memoryURI, object, parentMemoryURI, text, type NativeObject, type OVClient, type RetrievalOptions } from "./client";
import { useOVLocation, useOVRead } from "./hooks";
import { ContentText, FormSelect, FormSwitch, LoadState, NativeDetails } from "./shared";

export function RetrievalPage({ context, client }: { context: MemoryWorkspaceContext; client: OVClient }) {
  const { t } = useTranslation();
  const { params, set, navigationKey } = useOVLocation();
  const method = (["find", "search", "grep", "glob"].includes(params.get("method") ?? "") ? params.get("method") : "find") as "find" | "search" | "grep" | "glob";
  const [formError, setFormError] = useState("");
  const root = "viking://";
  const query = params.get("q") ?? "";
  const uri = params.get("target") || root;
  let filter: NativeObject | undefined;
  let validFilter = true;
  if (params.get("filter")) {
    try {
      const parsed: unknown = JSON.parse(params.get("filter")!);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) validFilter = false;
      else filter = parsed as NativeObject;
    } catch { validFilter = false; }
  }
  const options: RetrievalOptions = {
    query, uri, limit: Number(params.get("limit") || 10),
    mode: params.get("mode") === "context" ? "context" : "list",
    ...(params.get("score") ? { score: Number(params.get("score")) } : {}),
    ...(params.get("level") ? { level: Number(params.get("level")) } : {}),
    filter, ignoreCase: params.get("ignoreCase") === "true", maxTokens: Number(params.get("maxTokens") || 1600),
    session: params.get("session") || undefined, searchType: params.get("searchType") || "semantic",
    provenance: params.get("provenance") === "true", tags: params.get("tags")?.split(",").map(value => value.trim()).filter(Boolean),
  };
  const valid = memoryURI(root, uri) && validFilter && Number.isInteger(options.limit) && options.limit >= 1 && options.limit <= 200
    && Number.isInteger(options.maxTokens) && options.maxTokens! >= 64 && options.maxTokens! <= 32000
    && (options.score === undefined || Number.isFinite(options.score))
    && (options.level === undefined || [0, 1, 2].includes(options.level));
  let validationError = "";
  if (!validFilter) validationError = t("ov.invalidFilter");
  else if (!memoryURI(root, uri)) validationError = t("ov.invalidURI");
  else if (!valid) validationError = t("ov.invalidOptions");
  // Every submitted navigation fetches once, including unchanged options.
  // Using the committed location avoids fetching old options during navigation.
  const results = useOVRead(context, JSON.stringify([navigationKey, method, options]), signal => client.retrieve(method, options, signal), Boolean(query.trim()) && valid);
  return <>
    <SectionHeader title={t("ov.retrieval")} description={t("ov.retrievalDescription")} />
    <Card className="ov-panel">
      <Tabs label={t("ov.mode")} value={method} items={["find", "search", "grep", "glob"].map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))}
        onChange={value => set({ method: value })} />
      <form key={params.toString()} className="ov-form" onSubmit={event => {
        event.preventDefault(); setFormError("");
        const values = new FormData(event.currentTarget);
        const json = values.get("filter")?.toString().trim() ?? "";
        if (json) {
          try { const value: unknown = JSON.parse(json); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); }
          catch { setFormError(t("ov.invalidFilter")); return; }
        }
        const patch: Record<string, string | null> = { method, q: values.get("q")!.toString().trim() };
        for (const key of ["target", "limit", "mode", "score", "maxTokens", "session", "filter", "searchType", "level", "tags", "ignoreCase", "provenance"]) patch[key] = values.get(key)?.toString() || null;
        set(patch);
      }}>
        <Field label={t(method === "grep" || method === "glob" ? "ov.pattern" : "ov.query")}><Input name="q" defaultValue={query} required /></Field>
        <div className="ov-form-grid">
          <Field label={t("ov.uri")}><Input name="target" defaultValue={uri} required /></Field>
          <Field label={t("ov.limit")}><Input name="limit" type="number" min={1} max={200} defaultValue={options.limit} required /></Field>
          {method === "search" && <Field label={t("ov.resultMode")}><FormSelect name="mode" label={t("ov.resultMode")} defaultValue={options.mode!}
            options={["list", "context"].map(value => ({ value, label: t(`ov.${value}Mode`) }))} /></Field>}
        </div>
        {method === "grep" && <FormSwitch name="ignoreCase" label={t("ov.ignoreCase")} defaultChecked={options.ignoreCase} />}
        {(method === "find" || method === "search") && <details><summary>{t("ov.advanced")}</summary><div className="ov-form-grid">
          <Field label={t("ov.threshold")}><Input type="number" step="any" name="score" defaultValue={params.get("score") ?? ""} /></Field>
          <Field label={t("ov.level")}><FormSelect name="level" label={t("ov.level")} defaultValue={params.get("level") ?? ""}
            options={[{ value: "", label: t("ov.allLevels") }, ...[0, 1, 2].map(value => ({ value: String(value), label: `L${value}` }))]} /></Field>
          {method === "search" && <p className="ov-muted">{t("ov.contextLevelHint")}</p>}
          <Field label={t("ov.tags")}><Input name="tags" defaultValue={params.get("tags") ?? ""} /></Field>
          <FormSwitch name="provenance" label={t("ov.provenance")} defaultChecked={options.provenance} />
          {method === "search" && <>
            <Field label={t("ov.sessionID")}><Input name="session" defaultValue={options.session} /></Field>
            <Field label={t("ov.maxTokens")}><Input name="maxTokens" type="number" min={64} max={32000} defaultValue={options.maxTokens} /></Field>
            <Field label={t("ov.searchType")}><FormSelect name="searchType" label={t("ov.searchType")} defaultValue={options.searchType!}
              options={["semantic", "keywords"].map(value => ({ value, label: t(`ov.${value}`) }))} /></Field>
          </>}
        </div><Field label={t("ov.filter")}><Textarea name="filter" defaultValue={params.get("filter") ?? ""} rows={3} /></Field></details>}
        {formError && <p role="alert">{formError}</p>}
        <Button type="submit" variant="primary" disabled={!client.can(method)}>{t("ov.search")}</Button>
      </form>
    </Card>
    {validationError && <p className="ov-error" role="alert">{validationError}</p>}
    {!query ? <EmptyState title={t("ov.searchPrompt")} /> : <Card className="ov-panel"><LoadState state={results}>{value => <RetrievalResults value={value} root={root} />}</LoadState></Card>}
  </>;
}

export function RetrievalResults({ value, root }: { value: unknown; root: string }) {
  const { t } = useTranslation();
  const { go } = useOVLocation();
  const result = object(value);
  const rows: unknown[] = Array.isArray(value) ? value : ["memories", "resources", "skills", "matches", "results", "items", "entries"].flatMap(key => Array.isArray(result[key]) ? result[key] as unknown[] : []);
  const context = text(result.rendered) || text(result.context) || text(result.context_text) || text(result.text);
  return <>
    {context && <ContentText value={context} />}
    {rows.length ? <Table columns={[t("ov.uri"), t("ov.body")]} rows={rows.map(raw => {
      const row = object(raw);
      const uri = typeof raw === "string" ? raw : text(row.uri);
      return [
        memoryURI(root, uri) ? <Button variant="link" onClick={() => go("content", { domain: "all", uri, directory: parentMemoryURI("viking://", uri) })}>{uri}</Button> : <span>{uri}</span>,
        <><p>{text(row.abstract) || text(row.content) || text(row.text) || text(row.line) || text(row.description)}</p>
          {typeof row.score === "number" && <small>{t("ov.score")}: {row.score}</small>}
          <NativeDetails value={raw} /></>,
      ];
    })} /> : !context && <EmptyState title={t("ov.empty")} />}
    <NativeDetails value={value} />
  </>;
}
