import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Folder,Plus,MoreHorizontal} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Button,Input,Modal} from '../ui';
import type {MemoryBridge,MemoryProject} from './contracts';
export function WorkspaceSwitcher({bridge,onChanged,applications,currentApplication,onSelectApplication,onCreateApplication}:{bridge:MemoryBridge;onChanged(deleted?:string):void;applications:readonly MemoryProject[];currentApplication?:string;onSelectApplication(app:MemoryProject):void;onCreateApplication():void}){
 const {t}=useTranslation();const details=useRef<HTMLDetailsElement>(null),summary=useRef<HTMLElement>(null);const [target,setTarget]=useState<Element|null>(null);
 const [menu,setMenu]=useState<string>(),[action,setAction]=useState<{project:MemoryProject;kind:'rename'|'delete'}>(),[name,setName]=useState(''),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>{const c=new AbortController();controller.current=c;return()=>c.abort()},[bridge.identity]);
 const current=applications.find(project=>project.id===currentApplication);
 useEffect(()=>{setTarget(document.querySelector('[data-memory-console]')?.shadowRoot?.querySelector('[data-workspace-switcher]')??null)},[]);
 useEffect(()=>{const outside=(e:Event)=>{if(details.current&&!e.composedPath().includes(details.current)){details.current.open=false;setMenu(undefined)}};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[]);
 const close=()=>{if(details.current)details.current.open=false;setMenu(undefined)};
 const start=(project:MemoryProject,kind:'rename'|'delete')=>{setAction({project,kind});setName(project.name);setFailed(false);close()};
 const submit=async()=>{const signal=controller.current?.signal;if(!action||busy||!signal||signal.aborted)return;setBusy(true);setFailed(false);try{
  if(action.kind==='rename')await bridge.updateProject(action.project.id,{name:name.trim()},signal);
  else {if(!bridge.deleteProject)throw new Error('Unavailable');await bridge.deleteProject(action.project.id,signal)}
  if(!signal.aborted){onChanged(action.kind==='delete'?action.project.id:undefined);setAction(undefined)}
 }catch{if(!signal.aborted)setFailed(true)}finally{if(!signal.aborted)setBusy(false)}};
 const content=<><details className="workspace-picker" ref={details} onToggle={()=>{if(!details.current?.open)setMenu(undefined)}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();if(menu)setMenu(undefined);else{close();summary.current?.focus()}}}}>
 <summary ref={summary} title={current?.name} aria-label={t('spaces.switch')}><Folder size={16}/><span>{current?.name??t('spaces.choose')}</span><ChevronDown size={14}/></summary>
 <div className="workspace-popover" role="dialog" aria-label={t('spaces.switch')}><strong>{t('spaces.projects')}</strong>
 <div className="workspace-applications"><div className="workspace-options">{applications.map(app=><div key={app.id} className={`project-option ${app.id===currentApplication?'is-selected':''}`}>
 <div className="project-option-row"><button type="button" className="project-select" title={app.name} aria-current={app.id===currentApplication?'true':undefined} onClick={()=>{onSelectApplication(app);close()}}><span>{app.name}</span></button>
 <button type="button" className="project-more" aria-label={t('spaces.actions',{name:app.name})} aria-haspopup="menu" aria-expanded={menu===app.id} onClick={()=>setMenu(menu===app.id?undefined:app.id)}><MoreHorizontal size={17}/></button></div>
 {menu===app.id&&<div className="project-actions-menu" role="menu" aria-label={t('spaces.actions',{name:app.name})}><button role="menuitem" type="button" onClick={()=>start(app,'rename')}>{t('spaces.rename')}</button><button role="menuitem" type="button" className="project-delete" onClick={()=>start(app,'delete')}>{t('spaces.delete')}</button></div>}
 </div>)}</div><button className="workspace-add" type="button" onClick={()=>{onCreateApplication();close()}}><Plus size={16}/>{t('memoryProject.newProject')}</button></div>
 </div></details>
 {action&&<Modal open={true} title={t(action?.kind==='delete'?'spaces.delete':'spaces.rename')} onClose={()=>{if(!busy)setAction(undefined)}}>
 <form onSubmit={e=>{e.preventDefault();void submit()}} className="project-action-form">
 {action?.kind==='rename'?<Input autoFocus aria-label={t('spaces.name')} value={name} required maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)}/>:<p>{t('spaces.deleteConfirm',{name:action?.project.name})}</p>}
 {failed&&<p role="alert">{t('spaces.failed')}</p>}<div><Button disabled={busy} onClick={()=>setAction(undefined)}>{t('appFlow.cancel')}</Button><Button type="submit" variant="primary" disabled={busy||(action?.kind==='rename'&&!name.trim())}>{t(busy?'memoryProject.working':action?.kind==='delete'?'spaces.delete':'memoryProject.save')}</Button></div>
 </form></Modal>}</>;
 return target?createPortal(content,target):<div className="workspace-picker-fallback">{content}</div>;
}
