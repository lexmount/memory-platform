import {lazy,Suspense,useCallback} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {useTranslation} from 'react-i18next';
import type {MemoryWorkspaceContext} from '../contracts';
const Native=lazy(()=>import('../../../../provider-ui/openviking/dist/hindsight.js').then(m=>({default:m.HindsightWorkspace})));
export function OfficialHindsight({context,page}:{context:MemoryWorkspaceContext;page:string}) {
 const {i18n}=useTranslation(),location=useLocation(),navigate=useNavigate();
 const onNavigate=useCallback((next:string)=>navigate('/memory/hindsight/'+next+location.search),[location.search,navigate]);
 const surface=document.querySelector('[data-memory-console]')?.shadowRoot;
 return <Suspense fallback={<p role="status">{i18n.language==='zh'?'正在加载工作区…':'Loading workspace…'}</p>}><Native context={context} page={page} language={i18n.language} portalContainer={surface as unknown as HTMLElement|null} onNavigate={onNavigate}/></Suspense>;
}
