import { getPlatform, platformFetch } from './transport'
export function nativeHindsightURL(url:URL, bank:string,method:string) {
 const p=url.pathname;const q=new URLSearchParams(url.search);const root='/v1/default/banks/'+encodeURIComponent(bank)
 const supplied=q.get('bank_id')||q.get('agent_id');if(supplied&&supplied!==bank)throw new Error('Bank does not match current user')
 q.delete('bank_id');q.delete('agent_id')
 let path:string|undefined
 if(p.startsWith('/api/banks/')) {const parts=p.slice('/api/banks/'.length).split('/');if(decodeURIComponent(parts.shift()!)!==bank)throw new Error('Bank does not match current user');path=root+(parts.length?'/'+parts.join('/'):'')}
 else if(p.startsWith('/api/stats/')){const parts=p.slice('/api/stats/'.length).split('/');if(decodeURIComponent(parts.shift()!)!==bank)throw new Error('Bank does not match current user');path=root+'/stats'+(parts.length?'/'+parts.join('/'):'')}
 else if(p.startsWith('/api/operations/')){if(decodeURIComponent(p.slice('/api/operations/'.length))!==bank)throw new Error('Bank does not match current user');path=root+'/operations';if(q.has('operation_id')){path+='/'+encodeURIComponent(q.get('operation_id')!);q.delete('operation_id');if(method==='DELETE')path+='/cancel'}}
 else if(p==='/api/list')path=root+'/memories/list'
 else if(p==='/api/graph')path=root+'/graph'
 else if(p==='/api/recall')path=root+'/memories/recall'
 else if(p==='/api/reflect')path=root+'/reflect'
 else if(p.startsWith('/api/memories/retain'))path=root+'/memories'
 else if(p.startsWith('/api/memories/'))path=root+p.slice(4)
 else if(p.startsWith('/api/entities'))path=root+p.slice(4)
 else if(p.startsWith('/api/knowledge-base'))path=root+p.slice(4)
 else if(p.startsWith('/api/documents')){path=root+'/documents';if(q.has('document_id')){path+='/'+encodeURIComponent(q.get('document_id')!);q.delete('document_id')}path+=p.slice('/api/documents'.length)}
 else if(p==='/api/chunks'){path='/v1/default/chunks/'+encodeURIComponent(q.get('chunk_id')||'');q.delete('chunk_id')}
 else if(p.startsWith('/api/files/download/'))path='/v1/default/files/download/'+p.slice('/api/files/download/'.length)
 else if(p==='/api/files/retain')path=root+'/files/retain'
 return path ? path+(q.size?'?'+q:'') : undefined
}
export async function hindsightFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 const context=getPlatform();const bank=context.user.mapping.bank_id
 if(!bank)throw new Error('Missing bank mapping')
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,window.location.origin)
 const operations=new Set(context.provider.operations.map(o=>o.id))
 if(url.pathname==='/api/version')return Response.json({features:{observations:operations.has('get_observation_history'),bank_config_api:operations.has('get_bank_config'),bank_llm_health:false,document_export_api:false,document_import_api:false,audit_log:operations.has('list_audit_logs'),llm_trace:operations.has('list_llm_requests'),store_document_text:true}})
 const method=(init?.method||'GET').toUpperCase()
 const path=nativeHindsightURL(url,bank,method)
 if(!path)return Response.json({error:'当前项目未开放此操作 / Operation unavailable in this project'},{status:403})
 let body=init?.body
 if(typeof body==='string') {
  const parsed=JSON.parse(body);if((parsed.bank_id&&parsed.bank_id!==bank)||(parsed.agent_id&&parsed.agent_id!==bank))throw new Error('Bank does not match current user')
  delete parsed.bank_id;delete parsed.agent_id
  if(url.pathname.includes('/retain')) {if(url.pathname.endsWith('_async'))parsed.async=true;if(parsed.observation_scopes&&Array.isArray(parsed.items)){parsed.items=parsed.items.map((item:any)=>({...item,observation_scopes:item.observation_scopes??parsed.observation_scopes}));delete parsed.observation_scopes}}
  body=JSON.stringify(parsed)
 }
 if(body instanceof FormData&&url.pathname==='/api/files/retain') {const meta=JSON.parse(String(body.get('request')||'{}'));if(meta.bank_id&&meta.bank_id!==bank)throw new Error('Bank does not match current user');delete meta.bank_id;const form=new FormData();for(const [k,v]of body.entries())if(k!=='request')form.append(k,v);form.append('request',JSON.stringify(meta));body=form}
 return platformFetch(path,{...init,body})
}
