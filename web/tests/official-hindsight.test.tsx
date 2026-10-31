import {act} from 'react';
import {memoryProject} from './test/memory-project-fixtures';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {HindsightWorkspace} from '../../provider-ui/openviking/dist/hindsight.js';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('uses the scoped bank and does not loop after an entity graph outage',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);const controller=new AbortController();
 const invoke=vi.fn(async(id:string)=>id==='graph'?Response.json({error:'unavailable'},{status:503}):Response.json({items:[],entities:[],tags:[],total:0}));
 const context={identity:'app:user',signal:controller.signal,project:memoryProject(),schema:async()=>({}),user:{project_id:'project',user_id:'user',provider:{provider:'hindsight',version:'1.1.0',operations:[]},mapping:{bank_id:'app-bank'}},provider:{provider:'hindsight',version:'1.1.0',operations:[{id:'graph',method:'GET',description:'',request_media:null,permission:'read',path:'/v1/default/banks/{bank_id}/entities/graph'},{id:'entities',method:'GET',description:'',request_media:null,permission:'read',path:'/v1/default/banks/{bank_id}/entities'},{id:'tags',method:'GET',description:'',request_media:null,permission:'read',path:'/v1/default/banks/{bank_id}/tags'}]},invoke};
 try {
  await act(async()=>root.render(<HindsightWorkspace context={context} page="entities" language="en" portalContainer={node} onNavigate={()=>{}}/>));
  await vi.waitFor(()=>expect(invoke.mock.calls.filter(c=>c[0]==='graph')).toHaveLength(1));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,150));});
  expect(invoke.mock.calls.filter(c=>c[0]==='graph')).toHaveLength(1);
  expect((invoke.mock.calls.find(c=>c[0]==='graph') as any)[1].path).toEqual({bank_id:'app-bank'});
 } finally {await act(async()=>root.unmount());controller.abort();node.remove();vi.unstubAllGlobals();}
});
