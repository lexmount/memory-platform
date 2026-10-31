import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ArrowRight,Brain,Plus,Search} from 'lucide-react';
import {Badge,Button,Input,Select} from '../ui';
import type {MemoryProject} from './contracts';
export function ProjectDirectory({projects,onSelect,onCreate}:{projects:readonly MemoryProject[];onSelect(project:MemoryProject):void;onCreate():void}){
 const {t}=useTranslation();const [query,setQuery]=useState(''),[engine,setEngine]=useState('');
 const filtered=projects.filter(p=>(!engine||p.provider===engine)&&`${p.name} ${p.id}`.toLowerCase().includes(query.trim().toLowerCase()));
 return <div className="project-directory">
  <section className="project-directory-banner"><div className="directory-brand-icon"><Brain size={28}/></div><div><h1>{t('directory.title')}</h1><p>{t('directory.description')}</p></div></section>
  <div className="directory-tab">{t('directory.myProjects')}<span>{projects.length}</span></div>
  <section className="app-overview-card directory-card">
   <div className="directory-toolbar"><Button variant="primary" onClick={onCreate}><Plus size={16}/>{t('memoryProject.newProject')}</Button><div className="directory-filters"><label className="directory-search"><Search size={17}/><Input aria-label={t('directory.search')} placeholder={t('directory.search')} value={query} onChange={e=>setQuery(e.target.value)}/></label><Select label={t('directory.engine')} value={engine} onChange={setEngine} options={[{value:'',label:t('directory.allEngines')},{value:'hindsight',label:'Hindsight'},{value:'openviking',label:'OpenViking'}]}/></div></div>
   <p className="directory-note">{t('directory.hint')}</p>
   <div className="directory-table-scroll"><table className="directory-table"><thead><tr><th>{t('memoryProject.projectName')}</th><th>{t('appFlow.engine')}</th><th>{t('directory.status')}</th><th>{t('appFlow.created')}</th><th><span className="sr-only">{t('directory.open')}</span></th></tr></thead><tbody>{filtered.map(p=><tr key={p.id} onClick={()=>onSelect(p)}><td><button type="button" className="directory-project-link" onClick={e=>{e.stopPropagation();onSelect(p)}}><span className="directory-project-icon"><Brain size={21}/></span><span><strong>{p.name}</strong><small>{p.id}</small></span></button></td><td>{p.provider==='hindsight'?'Hindsight':p.provider==='openviking'?'OpenViking':p.provider}</td><td><Badge tone={p.enabled&&!p.revoked?'green':'neutral'}>{t(p.revoked?'memoryProject.revokedCredential':p.enabled?'memoryProject.enabled':'memoryProject.disabled')}</Badge></td><td>{new Date(p.created_at).toLocaleDateString()}</td><td><ArrowRight size={16}/></td></tr>)}</tbody></table></div>
   {!filtered.length&&<div className="app-empty"><Brain size={28}/><h2>{t(projects.length?'directory.noMatches':'directory.empty')}</h2><p>{t(projects.length?'directory.trySearch':'directory.emptyHint')}</p>{!projects.length&&<Button onClick={onCreate}>{t('memoryProject.newProject')}</Button>}</div>}
  </section>
 </div>;
}
