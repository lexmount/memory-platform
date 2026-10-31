import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {OpenVikingWorkspace} from '../../provider-ui/openviking/dist/index.js';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('mounts native sessions through the scoped bridge without creating a session on entry',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);const controller=new AbortController();
 const invoke=vi.fn(async()=>Response.json({status:'ok',result:[]}));
 const context:any={identity:'native-sessions:user',signal:controller.signal,user:{mapping:{account_id:'project-account',user_id:'mapped-user'}},provider:{operations:[{id:'sessions',method:'GET',path:'/api/v1/sessions'}]},invoke};
 try {
  await act(async()=>root.render(<OpenVikingWorkspace context={context} path="/sessions" language="en" portalContainer={node} onNavigate={()=>{}}/>));
  await vi.waitFor(()=>expect(invoke.mock.calls.length).toBeGreaterThan(0));
  expect(invoke.mock.calls.every((call:any)=>call[0]==='sessions')).toBe(true);
  await vi.waitFor(()=>expect(node.textContent).toContain('No session selected'));
  expect(node.querySelector('.openviking-official')).not.toBeNull();
 }finally{await act(async()=>root.unmount());controller.abort();node.remove();vi.unstubAllGlobals()}
});
