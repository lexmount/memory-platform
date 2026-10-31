import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,Folder,Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {MemoryProject} from './contracts';
export function WorkspaceSwitcher({applications,currentApplication,onSelectApplication,onCreateApplication}:{applications:readonly MemoryProject[];currentApplication?:string;onSelectApplication(app:MemoryProject):void;onCreateApplication():void}){
 const {t}=useTranslation();const details=useRef<HTMLDetailsElement>(null),summary=useRef<HTMLElement>(null);const [target,setTarget]=useState<Element|null>(null);
 const current=applications.find(project=>project.id===currentApplication);
 useEffect(()=>{setTarget(document.querySelector('[data-memory-console]')?.shadowRoot?.querySelector('[data-workspace-switcher]')??null)},[]);
 useEffect(()=>{const outside=(e:Event)=>{if(details.current&&!e.composedPath().includes(details.current))details.current.open=false};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[]);
 const close=()=>{if(details.current)details.current.open=false};
 const content=<details className="workspace-picker" ref={details} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();summary.current?.focus()}}}>
 <summary ref={summary} aria-label={t('spaces.switch')}><Folder size={16}/><span>{current?.name??t('spaces.choose')}</span><ChevronDown size={14}/></summary>
 <div className="workspace-popover" role="dialog" aria-label={t('spaces.switch')}><strong>{t('spaces.projects')}</strong>
 <div className="workspace-applications"><div className="workspace-options">{applications.map(app=><button key={app.id} type="button" className={app.id===currentApplication?'is-selected':''} onClick={()=>{onSelectApplication(app);close()}}><span>{app.name}</span>{app.id===currentApplication&&<Check size={16}/>}</button>)}</div><button className="workspace-add" type="button" onClick={()=>{onCreateApplication();close()}}><Plus size={16}/>{t('memoryProject.newProject')}</button></div>
 </div></details>;
 return target?createPortal(content,target):<div className="workspace-picker-fallback">{content}</div>;
}
