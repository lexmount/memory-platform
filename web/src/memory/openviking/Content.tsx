import { DirectoryTree } from "./DirectoryTree";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Download, FileText, Folder, House, RefreshCw, FolderTree, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, SectionHeader, Select, Tabs, Textarea } from "../../ui/index";
import type { MemoryWorkspaceContext } from "../contracts";
import { memoryURI, parentMemoryURI, type OVClient, type Receipt } from "./client";
import { offsetParam, useOVLocation, useOVMutation, useOVRead } from "./hooks";
import { ContentText, ErrorNotice, LoadState, NativeDetails, Pagination, ReceiptNotice } from "./shared";

type Props = { context: MemoryWorkspaceContext; client: OVClient };

export function ContentPage({ context, client }: Props) {
  const { t } = useTranslation();
  const { params, set, go } = useOVLocation();
  const domains: Record<string, string> = { memory: context.user.mapping.memory_uri ?? "", resources: context.user.mapping.resources_uri ?? "", skills: context.user.mapping.skills_uri ?? "", privateResources: context.user.mapping.private_resources_uri ?? "", privateSkills: context.user.mapping.private_skills_uri ?? "", all: "viking://" };
  const domain = params.get("domain") || "memory";
  const root = domains[domain] ?? "";
  const directory = params.get("directory") || root;
  const selected = params.get("uri") || directory;
  const tree = params.get("view") === "tree";
  const [treeRevision, setTreeRevision] = useState(0);
  const offset = offsetParam(params);
  const valid = memoryURI(root, directory) && memoryURI(root, selected);
  const listing = useOVRead(context, JSON.stringify([directory, tree, offset]), signal => client.list(directory, offset, false, signal), valid && !tree);
  const parent = parentMemoryURI(root, directory);
  const peerPrefix = root.replace(/\/memories$/, "") + "/peers/";
  const peer = directory.startsWith(peerPrefix) ? directory.slice(peerPrefix.length).split("/")[0] : "";
  return <>
    <SectionHeader title={t("ov.content")} description={t("ov.contentDescription")} actions={<Button icon={<RefreshCw size={16} />} onClick={()=>{listing.reload();setTreeRevision(value=>value+1);}}>{t("ov.refresh")}</Button>} />
    <Card className="ov-content-browser ov-studio-browser">
      <form key={directory} className="ov-location-bar" onSubmit={event => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("uri")?.toString().trim() ?? "";
        set({ directory: value, uri: null, offset: null });
      }}>
        <IconButton variant="text" label={t("ov.root")} onClick={() => set({ directory: root, uri: null, offset: null })}><House size={17} /></IconButton>
        <IconButton variant="text" label={t("ov.parent")} disabled={parent === directory} onClick={() => set({ directory: parent, uri: null, offset: null })}><ArrowUp size={17} /></IconButton>
        <Input name="uri" aria-label={t("ov.uri")} title={directory} defaultValue={directory} required />
        <Button type="submit">{t("ov.open")}</Button>
      </form>
      {domain === "memory" && <details className="ov-location-options">
        <summary>{t("ov.peer")}{peer && <Badge>{peer}</Badge>}</summary>
        <form className="ov-peer-form" key={`${root}:${peer}`} onSubmit={event => {
          event.preventDefault();
          const peer = new FormData(event.currentTarget).get("peer")?.toString().trim() ?? "";
          const uri = peer ? `${root.replace(/\/memories$/, "")}/peers/${peer}/memories` : root;
          if (peer && (/[\\/%?#\r\n]/.test(peer) || peer === "." || peer === "..")) {
            set({ directory: "invalid-peer", uri: null, offset: null }); return;
          }
          set({ directory: uri, uri: null, offset: null });
        }}>
          <div className="ov-peer-input"><Input name="peer" aria-label={t("ov.peer")} defaultValue={peer} /><Button type="submit">{t("ov.apply")}</Button></div>
          <p className="ov-muted">{t("ov.peerHint")}</p>
        </form>
      </details>}
      {!valid ? <div className="ov-error" role="alert">{t("ov.invalidURI")}</div> : <div className="ov-browser">
        <aside className="ov-list-panel" aria-label={t("ov.content")}>
          <header className="ov-explorer-heading"><FolderTree size={18}/><strong>{t("nativeUI.explorer")}</strong><IconButton variant="text" label={t("ov.retrieval")} onClick={()=>go("retrieval",{uri:directory})}><Search size={16}/></IconButton></header>
    <Field label={t("nativeMemory.domain")}><Select label={t("nativeMemory.domain")} value={domain}
      options={Object.keys(domains).filter(key => domains[key]).map(value => ({ value, label: t(value === "privateResources" || value === "privateSkills" ? `memoryProject.${value}` : `nativeMemory.${value}`) }))}
      onChange={value => set({ domain: value, directory: null, uri: null, offset: null, layer: null })} /></Field>

          <Tabs label={t("ov.mode")} value={tree ? "tree" : "list"} items={[{ value: "list", label: t("ov.list") }, { value: "tree", label: t("ov.tree") }]}
            onChange={value => set({ view: value, offset: null })} />
          {tree ? <DirectoryTree key={`${directory}:${treeRevision}`} context={context} client={client} root={root} uri={directory} selected={selected} pageOffset={offset} onPage={offset=>set({offset})} onSelect={uri=>set({uri,layer:null})}/> : <LoadState state={listing} empty={listing.data?.length === 0}>{entries => <>
            <ul className="ov-files">{entries.slice(0, 50).filter(entry => memoryURI(root, entry.uri)).map(entry =>
              <li key={entry.uri} className={`ov-file-row ${entry.uri === selected ? "is-active" : ""}`}>
                {entry.isDir ? <Folder size={17} /> : <FileText size={17} />}
                <Button variant="text" onClick={() => set({ uri: entry.uri, layer: null })}>{entry.name || entry.uri.split("/").pop()}</Button>
                {entry.isDir && <Button size="sm" onClick={() => set({ directory: entry.uri, uri: null, offset: null })}>{t("ov.open")}</Button>}
                {tree && <small>{entry.uri.replace(directory + "/", "")}</small>}
              </li>,
            )}</ul>
          </>}</LoadState>}
          {!tree && (offset > 0 || (listing.data?.length ?? 0) > 50) && <Pagination offset={offset} more={(listing.data?.length ?? 0) > 50} onChange={value => set({ offset: value })} />}
        </aside>
        <ContentDetail key={selected} context={context} client={client} uri={selected} root={root} />
      </div>}
    </Card>
  </>;
}

function ContentDetail({ context, client, uri, root }: Props & { uri: string; root: string }) {
  const { t } = useTranslation();
  const { params, set, go } = useOVLocation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
  const mutation = useOVMutation(context);
  const rawLayer = params.get("layer") ?? "read";
  const source = params.get("format") === "source";
  const layer = ["abstract", "overview", "metadata"].includes(rawLayer) ? rawLayer : "read";
  const stat = useOVRead(context, uri, signal => client.stat(uri, signal));
  const isDir = typeof stat.data?.isDir === "boolean" ? stat.data.isDir : undefined;
  const contentURI = layer === "read" || isDir !== false ? uri : parentMemoryURI(root, uri);
  const read = useOVRead(context, JSON.stringify([contentURI, layer]), signal =>
    layer === "metadata" ? client.attrs(uri, signal) : client.read(contentURI, layer as "read" | "abstract" | "overview", signal),
  isDir !== undefined && (layer !== "read" || !isDir));
  const canEdit = isDir === false && layer === "read" && typeof read.data === "string" && !read.loading && !read.error && client.can("write");
  const readText = typeof read.data === "string" ? read.data : "";
  const refresh = () => { stat.reload(); read.reload(); };
  return <section className="ov-detail" aria-label={t("ov.body")}>
    <header className="ov-document-heading">
      <div>{isDir ? <Folder size={18} /> : <FileText size={18} />}<h3>{uri.split("/").pop()}</h3><Badge>{t(isDir ? "ov.directory" : "ov.file")}</Badge></div>
      <code title={uri}>{uri}</code>
    </header>
    <div className="ov-detail-toolbar">
      <Tabs label={t("ov.content")} value={layer} items={["read", "abstract", "overview", "metadata"].map(value => ({ value, label: t(`ov.${value === "read" ? "body" : value}`) }))}
        onChange={value => set({ layer: value })} />
      <div className="ov-actions">
        <Button size="sm" disabled={!canEdit || mutation.pending} onClick={() => { setDraft(readText); setEditing(true); }}>{t("ov.edit")}</Button>
        <Button size="sm" variant="text" icon={<Download size={14} />} disabled={isDir !== false || !client.can("download") || mutation.pending} onClick={() => void mutation.run(
          signal => client.download(uri, signal),
          blob => {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url; anchor.download = uri.split("/").pop() || "memory";
            anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
          },
        )}>{t("ov.download")}</Button>
        <Button size="sm" variant="text" disabled={isDir === undefined || !client.can("reindex") || mutation.pending} onClick={() => void mutation.run(signal => client.reindex(uri, signal), setReceipt)}>{t("ov.reindex")}</Button>
        <Button size="sm" variant="text" onClick={refresh}>{t("ov.refresh")}</Button>
      </div>
    </div>
    <div className="ov-detail-body">
      {layer === "read" && isDir === false && <Tabs label={t("nativeUI.display")} value={source ? "source" : "preview"} items={[{value:"preview",label:t("nativeUI.preview")},{value:"source",label:t("nativeUI.source")}]} onChange={value=>set({format:value})}/>}

      <ErrorNotice error={mutation.error} />
      <ReceiptNotice receipt={receipt} onTask={task => go("tasks", { task, resource: uri, taskType: "admin_reindex" })} />
      <LoadState state={stat}>{value => typeof value.isDir !== "boolean" ? <NativeDetails value={value} /> : <>
        {layer === "read" && isDir ? <div className="ov-directory-empty"><FolderTree size={40}/><EmptyState title={t("ov.selectFile")} description={t("nativeUI.directoryHint")}/><div className="ov-actions"><Button onClick={()=>set({layer:"abstract"})}>{t("ov.abstract")}</Button><Button onClick={()=>set({layer:"overview"})}>{t("ov.overview")}</Button></div></div> : <LoadState state={read}>{value =>
          layer === "metadata" ? <NativeDetails value={value} label={t("ov.metadata")} /> : source && layer === "read" && typeof value === "string" ? <pre className="ov-source-view">{value}</pre> : <ContentText value={value} />
        }</LoadState>}
        <NativeDetails value={value} />
      </>}</LoadState>
    </div>
    <Modal className="ov-editor" open={editing} title={t("ov.edit")} onClose={() => { if (!mutation.pending) setEditing(false); }} footer={<>
      <Button disabled={mutation.pending} onClick={() => setEditing(false)}>{t("ov.cancel")}</Button>
      <Button variant="primary" disabled={mutation.pending} onClick={() => void mutation.run(signal => client.write(uri, draft, signal), result => {
        setReceipt(result); setEditing(false); refresh();
      })}>{t(mutation.pending ? "ov.saving" : "ov.save")}</Button>
    </>}>
      <p className="ov-muted">{t("ov.editHint")}</p>
      <Field label={t("ov.body")}><Textarea disabled={mutation.pending} value={draft} onChange={event => setDraft(event.target.value)} rows={18} /></Field>
      <ErrorNotice error={mutation.error} />
    </Modal>
  </section>;
}
