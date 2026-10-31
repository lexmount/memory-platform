import { AxiosError } from 'axios'
import type { AxiosAdapter } from 'axios'
export type PlatformContext = {
 identity: string; signal: AbortSignal; user: { user_id?:string; mapping: Readonly<Record<string,string>> };
 provider: { version?:string; features?:Readonly<Record<string,boolean>>; operations: readonly {id:string; method:string; path:string}[] };
 invoke: (id:string,input: {path?:Record<string,string>;query?:Record<string,unknown>;body?:unknown;headers?:Record<string,string>},signal?:AbortSignal,upload?:FormData)=>Promise<Response>;
}
let active: PlatformContext | undefined
export function bindPlatform(context: PlatformContext) { active=context; return () => { if(active===context) active=undefined } }
export function getPlatform() { if(!active || active.signal.aborted) throw new DOMException('Workspace closed','AbortError'); return active }
export function matchOperation(operations: PlatformContext['provider']['operations'],method:string,path:string) {
 for(const op of operations) {
  if(op.method.toUpperCase()!==method.toUpperCase()) continue
  const names:string[]=[]
  const pattern=op.path.split('/').map(part=>{ if(part.startsWith('{')&&part.endsWith('}')) { names.push(part.slice(1,-1)); return '([^/]+)' } return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') }).join('/')
  const match=path.match(new RegExp('^'+pattern+'$'))
  if(match) return {op,path:Object.fromEntries(names.map((name,i)=>[name,decodeURIComponent(match[i+1]!)]))}
 }
 return null
}
export async function platformFetch(input: RequestInfo | URL,init?:RequestInit):Promise<Response> {
 const context=getPlatform()
 const request=new Request(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,window.location.origin),init)
 const url=new URL(request.url)
 // Requests remain scoped to the current application/user; upstream keys never enter this module.
 const route=matchOperation(context.provider.operations,request.method,url.pathname)
 if(!route) return Response.json({status:'error',error:{code:'UNSUPPORTED',message:'当前项目未开放此操作 / Operation unavailable in this project'}},{status:403})
 const query:Record<string,unknown>={};for(const key of new Set(url.searchParams.keys())) {const values=url.searchParams.getAll(key);query[key]=values.length>1?values:values[0]}
 const headers:Record<string,string>={};for(const key of ['Accept','Range','If-Match','X-OpenViking-Actor-Peer']) {const value=request.headers.get(key);if(value)headers[key]=value}
 let body:unknown;let upload:FormData|undefined
 if(!['GET','HEAD'].includes(request.method)) {
  if(request.headers.get('content-type')?.includes('multipart/form-data')) upload=await request.formData()
  else {const raw=await request.text();if(raw) {try{body=JSON.parse(raw)}catch{body=raw}}}
 }
 context.signal.throwIfAborted()
 return context.invoke(route.op.id,{path:route.path,query,body,headers},request.signal,upload)
}
export const platformAxiosAdapter: AxiosAdapter = async config => {
 const url=new URL(config.url||'',config.baseURL||window.location.origin)
 if(config.params) for(const [key,value] of Object.entries(config.params)) {if(value==null)continue;for(const v of Array.isArray(value)?value:[value])url.searchParams.append(key,String(v))}
 const headers=new Headers();for(const [key,value] of Object.entries(config.headers?.toJSON()||{}))if(value!=null)headers.set(key,String(value))
 if(config.data instanceof FormData)headers.delete('Content-Type')
 const response=await platformFetch(url,{method:config.method,headers,body:config.data,signal:config.signal as AbortSignal})
 const data=config.responseType==='blob'?await response.blob():config.responseType==='arraybuffer'?await response.arrayBuffer():await response.text()
 const result={data,status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),config}
 if(!response.ok)throw new AxiosError(response.statusText||'Request failed',undefined,config,undefined,result)
 return result
}
function scopedStorage(kind:'localStorage'|'sessionStorage') {
 const key=(name:string)=>'memory:official:'+encodeURIComponent(active?.identity||'unbound')+':'+name
 return {
  getItem:(name:string)=>{try{return window[kind].getItem(key(name))}catch{return null}},
  setItem:(name:string,value:string)=>{if(active)try{window[kind].setItem(key(name),value)}catch{}},
  removeItem:(name:string)=>{try{window[kind].removeItem(key(name))}catch{}},
 }
}
export const platformLocalStorage=scopedStorage('localStorage')
export const platformSessionStorage=scopedStorage('sessionStorage')
