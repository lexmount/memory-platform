import { useCallback, lazy, Suspense } from 'react';
import { useLocation,useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
const OpenVikingWorkspace = lazy(()=>import('../../../../provider-ui/openviking/dist/index.js').then(m=>({default:m.OpenVikingWorkspace})));
import type { MemoryWorkspaceContext } from '../contracts';
const pages:Record<string,string>={sessions:'sessions',content:'filesystem',resources:'filesystem',retrieval:'retrieval',skills:'skills',tasks:'tasks',experience:'agent-experience',compile:'compile',watches:'watches',overview:'home',logs:'request-logs'};
export function OfficialWorkspace({context,page}:{context:MemoryWorkspaceContext;page:string}) {
 const {i18n}=useTranslation(),location=useLocation(),navigate=useNavigate();
 const query=new URLSearchParams(location.search),native=query.get('studio');
 const rootPage=pages[page.split('/')[0]||'']||'filesystem';
 const initial=new URLSearchParams();if(rootPage==='filesystem')initial.set('uri',page==='resources'?'viking://resources':context.user.mapping.memory_uri||'viking://');
 const path=native&&native.startsWith('/'+rootPage)?native:'/'+rootPage+(initial.size?'?'+initial:'');
 const onNavigate=useCallback((path:string)=>{
  const segment=path.split(/[/?]/)[1];const entry=Object.entries(pages).find(([,target])=>target===segment);if(!entry)return;
  const q=new URLSearchParams(location.search);if(q.get('studio')===path)return;q.set('studio',path);
  const nextPage=pages[page]===segment?page:entry[0];
  navigate('/memory/openviking/'+nextPage+'?'+q,{replace:true});
 },[location.search,navigate,page]);
 const surface=document.querySelector('[data-memory-console]')?.shadowRoot;
 return <Suspense fallback={<p role="status">{i18n.language==='zh'?'正在加载工作区…':'Loading workspace…'}</p>}><OpenVikingWorkspace context={context} path={path} language={i18n.language} portalContainer={surface as unknown as HTMLElement|null} onNavigate={onNavigate}/></Suspense>;
}
export const officialPages=new Set(Object.keys(pages));
