import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Users} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {MemoryBridge,MemoryProject,MemoryUserPage} from './contracts';
export function UserSwitcher({bridge,project,user,onSelect}:{bridge:MemoryBridge;project:MemoryProject;user:string;onSelect(user:string):void}){
 const {t}=useTranslation();const details=useRef<HTMLDetailsElement>(null);const [items,setItems]=useState<MemoryUserPage['items']>([]),[cursor,setCursor]=useState(''),[next,setNext]=useState(''),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 useEffect(()=>{const c=new AbortController();setLoading(true);setFailed(false);void bridge.users(project.id,cursor,c.signal).then(page=>{if(c.signal.aborted)return;setItems(old=>[...new Map([...(cursor?old:[]),...page.items].map(item=>[item.user_id,item])).values()]);setNext(page.next_cursor);setLoading(false)},()=>{if(!c.signal.aborted){setFailed(true);setLoading(false)}});return()=>c.abort()},[bridge,project.id,cursor,revision]);
 useEffect(()=>{const outside=(e:Event)=>{if(details.current&&!e.composedPath().includes(details.current))details.current.open=false};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[]);
 const label=(id:string)=>id==='default'?t('userSwitcher.default'):id;
 return <details className="workspace-picker sidebar-user-switcher" ref={details} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();if(details.current)details.current.open=false;details.current?.querySelector('summary')?.focus()}}}>
 <summary aria-label={t('userSwitcher.switch')} title={label(user)}><Users size={16}/><span>{label(user)}</span><ChevronDown size={14}/></summary>
 <div className="workspace-popover" role="dialog" aria-label={t('userSwitcher.switch')}><strong>{t('appFlow.users')}</strong><div className="workspace-options">{items.map(item=><button key={item.user_id} type="button" className={item.user_id===user?'is-selected':''} onClick={()=>{onSelect(item.user_id);if(details.current)details.current.open=false}}><span>{label(item.user_id)}</span>{item.user_id===user&&<Check size={15}/>}</button>)}</div>
 {loading&&<p role="status">{t('memory.loading')}</p>}{failed&&<div role="alert"><p>{t('userSwitcher.failed')}</p><button type="button" className="workspace-add" onClick={()=>setRevision(v=>v+1)}>{t('memory.retry')}</button></div>}
 {!failed&&!loading&&!items.length&&<p>{t('memoryProject.noUsers')}</p>}{next&&!loading&&<button type="button" className="workspace-add" onClick={()=>setCursor(next)}>{t('memory.more')}</button>}
 </div></details>;
}
