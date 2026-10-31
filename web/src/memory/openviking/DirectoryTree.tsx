import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { Button, IconButton } from "../../ui/index";
import { memoryURI, type OVClient } from "./client";
import type { MemoryWorkspaceContext } from "../contracts";
import { useOVRead } from "./hooks";
import { ErrorNotice } from "./shared";

type Props = { context: MemoryWorkspaceContext; client: OVClient; root: string; uri: string; selected: string; onSelect(uri: string): void; pageOffset?: number; onPage?(offset:number):void; depth?: number };
export function DirectoryTree({ context, client, root, uri, selected, onSelect, depth = 0, pageOffset, onPage }: Props) {
  const { t } = useTranslation();
  const [localOffset, setLocalOffset] = useState(0);
  const offset = pageOffset ?? localOffset, setOffset = onPage ?? setLocalOffset;
  const listing = useOVRead(context, JSON.stringify(["explorer",uri,offset]), signal => client.list(uri, offset, false, signal));
  return <div className="ov-tree-branch"><ErrorNotice error={listing.error} />{listing.data?.length === 0 && <p>{t("ov.empty")}</p>}{listing.loading && <p role="status">{t("memory.loading")}</p>}
    {listing.data?.slice(0,50).filter(entry => memoryURI(root,entry.uri) && entry.uri !== uri).map(entry => <TreeEntry key={entry.uri} {...{context,client,root,selected,onSelect,depth}} uri={entry.uri} name={entry.name ?? entry.uri.split("/").pop() ?? entry.uri} isDir={entry.isDir === true} />)}
    {Boolean(listing.error) && <Button size="sm" onClick={listing.reload}>{t("memory.retry")}</Button>}
    {offset > 0 && <Button size="sm" onClick={()=>setOffset(Math.max(0,offset-50))}>{t("ov.previous")}</Button>}
    {(listing.data?.length ?? 0)>50 && <Button size="sm" onClick={()=>setOffset(offset+50)}>{t("memory.more")}</Button>}
  </div>;
}
function TreeEntry(props: Props & {name:string;isDir:boolean}) {
  const {t}=useTranslation(),[expanded,setExpanded]=useState(false);
  const {uri,name,isDir,selected,onSelect,depth=0}=props;
  return <div><div className={`ov-tree-row ${selected===uri?'is-active':''}`} style={{paddingLeft:8+Math.min(depth,8)*14}}>
    {isDir ? <IconButton variant="text" label={`${t(expanded?'nativeUI.collapse':'nativeUI.expand')} ${name}`} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</IconButton> : <span className="ov-tree-spacer"/>}
    {isDir?<Folder size={16}/>:<FileText size={16}/>}<Button variant="text" title={uri} onClick={()=>onSelect(uri)}>{name || uri.split('/').pop()}</Button>
  </div>{isDir && expanded && depth<20 && <DirectoryTree {...props} depth={depth+1}/>}</div>;
}
