import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FileText } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Tabs, Textarea } from "../../ui/index";
import { HindsightError, parseNativeJSON, type HindsightClient } from "./client";
import { Actions, ErrorNotice, Loading, Markdown, NativeDetails, Raw, RecordTable, Section } from "./components";
import { Attachments, Collection, FilterBar, readFilters, ResultRead } from "./collections";
import { useHindsightMutation, useHindsightRead } from "./hooks";
import { useHindsightLocation } from "./navigation";
import { record, records, text, type NativeRecord } from "./types";

export function EntityExplorer({ client }: { client: HindsightClient }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const view = ["entityGraph", "memoryGraph"].includes(location.get("view")) ? location.get("view") : "collection";
  return <><Tabs label={t("hindsight.entities")} value={view} onChange={value => location.set({ view: value, resource: undefined, filters: undefined, offset: undefined })}
    items={["collection", "entityGraph", "memoryGraph"].map(value => ({ value, label: t(`hindsight.${value}`) }))} />
    {view === "collection" ? <Collection client={client} kind="entities" /> : <Graph key={view} client={client} entities={view === "entityGraph"} />}</>;
}
function Graph({ client, entities }: { client: HindsightClient; entities: boolean }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const filters = readFilters(location.get("filters"));
  const [limit, setLimit] = useState("60"), [zoom, setZoom] = useState(1), [selectedId, setSelected] = useState<string>();
  const result = useHindsightRead(client, entities ? "get_entity_graph" : "get_graph", { query: { ...filters, limit: Number(limit) } });
  const data = record(result.data);
  const nodes = useMemo(() => records(data.nodes).map(node => record(node.data)), [data.nodes]);
  // History navigation and refresh can replace the graph without going through
  // the filter controls. Only nodes in the current result can own a detail read.
  const selected = nodes.find(node => text(node.id) === selectedId);
  const edges = records(data.edges).map(edge => record(edge.data));
  const positions = new Map(nodes.map((node, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5)), radius = 28 * Math.sqrt(index);
    return [text(node.id), { x: 400 + Math.cos(angle) * radius, y: 300 + Math.sin(angle) * radius }];
  }));
  return <Section title={t(entities ? "hindsight.entityGraph" : "hindsight.memoryGraph")}>
    <Card className="hs-panel">
      <FilterBar query={!entities} tagDefault={entities ? "any" : "all_strict"} tagModes={entities ? undefined : ["any", "all", "any_strict", "all_strict"]} types={!entities ? ["world", "experience", "observation"] : undefined} value={filters} onApply={value => { setSelected(undefined); location.set({ filters: JSON.stringify(value) }); }} />
      <div className="hs-toolbar"><Field label={t("hindsight.graphLimit")}><Select label={t("hindsight.graphLimit")} options={["30", "60", "100"]} value={limit} onChange={value => { setLimit(value); setSelected(undefined); }} /></Field>
        <Field label={t("hindsight.graph")}><input aria-label={t("hindsight.graph")} type="range" min="0.5" max="2" step="0.1" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></Field>
        <Button size="sm" onClick={result.refresh}>{t("hindsight.refresh")}</Button></div>
      <p className="hs-hint">{t("hindsight.graphHint")}</p><Loading loading={result.loading} /><ErrorNotice error={result.error} retry={result.refresh} />
      {result.data !== undefined && <>
        <div className="hs-tags"><Badge>{t("hindsight.total", { count: Number(data.total_entities ?? data.total_units ?? 0) })}</Badge><Badge>{t("hindsight.relations")}: {text(data.total_edges ?? edges.length)}</Badge></div>
        {nodes.length ? <div className="hs-graph-scroll"><svg className="hs-graph" viewBox="0 0 800 600" style={{ width: `${zoom * 100}%` }} role="group" aria-label={t("hindsight.graph")}>
          {edges.map((edge, i) => { const from = positions.get(text(edge.source)), to = positions.get(text(edge.target)); return from && to && <line key={text(edge.id) || i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" opacity=".18"><title>{text(edge.linkType)} · {text(edge.weight)}</title></line>; })}
          {nodes.map(node => { const point = positions.get(text(node.id))!; return <g key={text(node.id)} transform={`translate(${point.x},${point.y})`}
            role="button" tabIndex={0} aria-label={text(node.label ?? node.id)} onClick={() => setSelected(text(node.id))} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(text(node.id)); } }}>
            <circle r={selected?.id === node.id ? 12 : 9} fill={selected?.id === node.id ? "#0f766e" : "#5264d6"} /><title>{text(node.label ?? node.text)}</title>
            <text x="13" y="4" fill="currentColor">{text(node.label ?? node.id).slice(0, 18)}</text></g>; })}
        </svg></div> : <EmptyState title={t("hindsight.graphEmpty")} />}
        {selected && <Card className="hs-panel"><ResultRead key={text(selected.id)} client={client} operation={entities ? "get_entity" : "get_memory"} input={{ path: { [entities ? "entity_id" : "memory_id"]: text(selected.id) } }} /></Card>}
        <details><summary>{t("hindsight.relations")}</summary><RecordTable rows={edges.map(edge => ({ ...edge, name: `${text(edge.source)} → ${text(edge.target)}`, type: edge.linkType }))} /></details>
        <Raw value={result.data} />
      </>}
    </Card>
  </Section>;
}

function flatten(nodes: NativeRecord[]): NativeRecord[] {
  return nodes.flatMap(node => [node, ...flatten(records(node.children))]);
}
function Tree({ nodes, selected, onSelect }: { nodes: NativeRecord[]; selected: string; onSelect: (id: string) => void }) {
  return <ul className="hs-tree">{nodes.map(node => <li key={text(node.id)}>
    <button className={selected === node.id ? "is-active" : ""} aria-pressed={selected === node.id} onClick={() => onSelect(text(node.id))}>
      {node.kind === "folder" ? <Folder size={16} /> : <FileText size={16} />}<span>{text(node.name)}</span>
    </button>{records(node.children).length > 0 && <Tree nodes={records(node.children)} selected={selected} onSelect={onSelect} />}
  </li>)}</ul>;
}
function KnowledgeSearch({ query, tags, onApply }: { query: string; tags: string; onApply: (query: string, tags: string) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(query), [tag, setTag] = useState(tags);
  return <form className="hs-filter-fields" onSubmit={event => { event.preventDefault(); onApply(search, tag); }}>
    <Field label={t("hindsight.search")}><Input value={search} onChange={e => setSearch(e.target.value)} /></Field>
    <Field label={t("hindsight.tags")}><Input value={tag} onChange={e => setTag(e.target.value)} /></Field>
    <Button type="submit">{t("hindsight.search")}</Button>
    <Button onClick={() => { setSearch(""); setTag(""); onApply("", ""); }}>{t("hindsight.clearFilters")}</Button>
  </form>;
}
export function Knowledge({ client }: { client: HindsightClient }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const [pageRevision, setPageRevision] = useState(0);
  const query = location.get("q"), tagFilter = location.get("tags");
  const tags = tagFilter.split(",").map(value => value.trim()).filter(Boolean);
  const tree = useHindsightRead(client, "get_knowledge_base_tree", { query: tags.length ? { tags } : {} });
  const results = useHindsightRead(client, "search_knowledge_base", { query: { q: query, ...(tags.length ? { tags } : {}), limit: 50 } }, { enabled: Boolean(query) });
  const roots = records(record(tree.data).roots), all = flatten(roots);
  const selected = all.find(node => node.id === location.resource);
  const refresh = () => { tree.refresh(); results.refresh(); setPageRevision(value => value + 1); };
  return <Section title={t("hindsight.knowledge")} tools={<Actions client={client} operations={["create_knowledge_folder", "create_knowledge_page"]} selected={selected} onSuccess={tree.refresh} />}>
    <p className="hs-hint">{t("hindsight.knowledgeHint")}</p>
    {/* Reset only search drafts on applied query changes; resource navigation
        and refresh keep both drafts and the rest of this page mounted. */}
    <KnowledgeSearch key={JSON.stringify([query, tagFilter])} query={query} tags={tagFilter}
      onApply={(q, tags) => location.set({ q, tags, resource: undefined })} />
    <div className="hs-toolbar"><Loading loading={tree.loading} /><Button size="sm" onClick={refresh}>{t("hindsight.refresh")}</Button></div>
    <ErrorNotice error={tree.error} retry={tree.refresh} />
    {query && <Card className="hs-panel"><Loading loading={results.loading} /><ErrorNotice error={results.error} retry={results.refresh} />
      {results.data !== undefined && <RecordTable rows={records(record(results.data).results)} onOpen={row => location.open(text(row.id))} />}</Card>}
    <div className="hs-knowledge">
      <Card className="hs-panel">{roots.length ? <Tree nodes={roots} selected={location.resource} onSelect={location.open} /> : !tree.loading && <EmptyState title={t("hindsight.empty")} />}</Card>
      <Card className="hs-panel">
        {location.resource ? <>
          {selected?.kind === "folder" ? <NativeDetails value={selected} /> :
            <ResultRead key={`${location.resource}:${pageRevision}`} client={client} operation="get_knowledge_page" input={{ path: { page_id: location.resource } }} />}
          {selected && <Actions key={text(selected.id)} client={client} operations={["update_knowledge_node", "delete_knowledge_node"]}
            selected={{ ...selected, source_query: selected.description }} onSuccess={operation => { if (operation === "delete_knowledge_node") location.open(""); refresh(); }} />}
          {selected?.mental_model_id ? <Actions key={`${text(selected.id)}:model`} client={client} operations={["refresh_mental_model", "dry_run_refresh_mental_model"]}
            selected={{ id: selected.mental_model_id }} onSuccess={refresh} /> : null}
        </> : <EmptyState title={t("hindsight.noSelection")} />}
      </Card>
    </div>
  </Section>;
}

export function Playground({ client }: { client: HindsightClient }) {
  const { t } = useTranslation(), location = useHindsightLocation();
  const operation = location.get("view") === "reflect" ? "reflect" : "recall_memories";
  return <Section title={t("hindsight.playground")}>
    <Tabs label={t("hindsight.playground")} value={operation} onChange={value => location.set({ view: value })}
      items={["recall_memories", "reflect"].map(value => ({ value, label: value === "reflect" ? "Reflect" : "Recall" }))} />
    <QueryForm key={operation} client={client} operation={operation} />
  </Section>;
}
function QueryForm({ client, operation }: { client: HindsightClient; operation: "recall_memories" | "reflect" }) {
  const { t } = useTranslation();
  const operationLabel = operation === "reflect" ? "Reflect" : "Recall";
  const [query, setQuery] = useState(""), [tags, setTags] = useState(""), [budget, setBudget] = useState("mid"), [tokens, setTokens] = useState("4096");
  const [advanced, setAdvanced] = useState(""), [error, setError] = useState<unknown>();
  const mutation = useHindsightMutation(client);
  const submit = async () => {
    setError(undefined);
    try {
      if (!advanced && !query.trim()) throw new HindsightError("required");
      if (!advanced && (!Number.isInteger(Number(tokens)) || Number(tokens) < 1)) throw new HindsightError("invalidNumber");
      await mutation.run(operation, advanced ? parseNativeJSON(advanced) : {
        body: { query, budget, max_tokens: Number(tokens), ...(tags.trim() ? { tags: tags.split(",").map(x => x.trim()).filter(Boolean) } : {}),
          include: operation === "reflect" ? { facts: {}, tool_calls: {} } : { entities: { max_tokens: 1000 }, chunks: { max_tokens: 2000 }, source_facts: { max_tokens: 2000 } } },
      });
    } catch (err) { setError(err); }
  };
  return <>
    <Card className="hs-panel"><form className="hs-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Field label={t("hindsight.query")} required><Textarea rows={5} value={query} onChange={e => setQuery(e.target.value)} /></Field>
      <div className="hs-filter-fields">
        <Field label={t("hindsight.budget")}><Select label={t("hindsight.budget")} value={budget} onChange={setBudget} options={["low", "mid", "high"]} /></Field>
        <Field label={t("hindsight.maxTokens")}><Input type="number" min={1} value={tokens} onChange={e => setTokens(e.target.value)} /></Field>
        <Field label={t("hindsight.tags")}><Input value={tags} onChange={e => setTags(e.target.value)} /></Field>
      </div>
      <details><summary>{t("hindsight.advanced")}</summary><Field label={t("hindsight.advanced")} hint={t("hindsight.advancedHint")}>
        <Textarea rows={8} className="hs-code" value={advanced} onChange={e => setAdvanced(e.target.value)} />
      </Field></details>
      <Button type="submit" variant="primary" disabled={mutation.busy || !client.can(operation)}>{mutation.busy ? t("hindsight.working") : operationLabel}</Button>
    </form><ErrorNotice error={error ?? mutation.error} /></Card>
    {mutation.result !== undefined && <QueryResult client={client} value={mutation.result} />}
  </>;
}
export function QueryResult({ client, value }: { client: HindsightClient; value: unknown }) {
  const { t } = useTranslation(), data = record(value);
  const [selected, setSelected] = useState("");
  const results = records(data.results ?? record(data.based_on).memories);
  return <Card className="hs-panel">
    {typeof data.text === "string" && <Markdown>{data.text}</Markdown>}
    <Section title={t("hindsight.evidence")}><RecordTable rows={results} onOpen={row => setSelected(text(row.id))} /></Section>
    {selected && <ResultRead key={selected} client={client} operation="get_memory" input={{ path: { memory_id: selected } }}>{memory => <>
      <NativeDetails value={memory} /><Attachments client={client} value={record(memory).attachments} />
    </>}</ResultRead>}
    {Object.entries(record(data.source_facts)).length > 0 && <Section title={t("hindsight.sourceFacts")}><RecordTable rows={records(Object.values(record(data.source_facts)))} /></Section>}
    {Object.entries(record(data.chunks)).map(([id, chunk]) => <details key={id}><summary>{t("hindsight.chunks")}: {id}</summary>
      <NativeDetails value={chunk} /><Attachments client={client} value={record(chunk).attachments} /></details>)}
    {data.structured_output_error ? <p role="alert">{text(data.structured_output_error)}</p> : null}
    <Raw value={value} />
  </Card>;
}
