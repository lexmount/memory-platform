import React,{useEffect,useLayoutEffect,useState} from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from '#/i18n'
import { IntlProvider } from 'use-intl'
import { PlatformBankContext } from '@hs/lib/bank-context'
import { FeaturesProvider } from '@hs/lib/features-context'
import { AddDocument } from '@hs/components/platform-add-document'
import BankPage from '@hs/components/platform-bank-page'
import en from '@hs/messages/en.json'
import zh from '@hs/messages/zh-CN.json'
import { bindPlatform,type PlatformContext } from './transport'
import { PortalContainerContext } from './portal'
import { HindsightNavigationContext } from './hs-navigation'
import { Toaster } from '#/components/ui/sonner'
const nativeViews:Record<string,string>={overview:'home',memories:'data',management:'profile',playground:'reflect',models:'knowledge'}
const platformViews:Record<string,string>={home:'overview',data:'memories',profile:'management',think:'reflect','mental-models':'knowledge'}
export function HindsightWorkspace({context,page,search='',language,portalContainer,onNavigate}:{context:PlatformContext;page:string;search?:string;language:string;portalContainer:HTMLElement|null;onNavigate:(page:string)=>void}) {
 const [ready,setReady]=useState(false)
 useLayoutEffect(()=>{const release=bindPlatform(context);setReady(true);return release},[context])
 useEffect(()=>{void i18n.changeLanguage(language.startsWith('zh')?'zh-CN':'en')},[language])
 if(!ready)return <div role="status">Loading…</div>
 const chinese=language.startsWith('zh'),bank=context.user.mapping.bank_id
 const query=new URLSearchParams(search);query.delete('project');query.delete('userid');query.set('view',nativeViews[page]||page)
 if(page==='models')query.set('knowledgeTab','models')
 const translate=(href:string)=>{const url=new URL(href,window.location.origin);if(url.pathname!=='/banks/'+bank && url.pathname!=='/banks/'+encodeURIComponent(bank))return null;const q=url.searchParams;const view=q.get('view')||'home';q.delete('view');q.delete('project');q.delete('userid');return (platformViews[view]||view)+(q.size?'?'+q:'')}
 const nav=(href:string)=>{const next=translate(href);if(next)onNavigate(next)}
 const resolveHref=(href:string)=>{const next=translate(href);if(!next)return '#';const [path,params]=next.split('?');const q=new URLSearchParams(params);const current=new URLSearchParams(search);for(const key of ['project','userid']){const value=current.get(key);if(value)q.set(key,value)}return '#/memory/hindsight/'+path+'?'+q}

 return <PortalContainerContext.Provider value={portalContainer}><I18nextProvider i18n={i18n}><IntlProvider locale={chinese?'zh-CN':'en'} messages={chinese?zh:en} timeZone="Asia/Shanghai"><HindsightNavigationContext.Provider value={{path:'/banks/'+encodeURIComponent(bank)+'?'+query,navigate:nav,resolveHref}}><PlatformBankContext.Provider value={{currentBank:bank,currentBankName:context.user.user_id==='default'?(chinese?'默认用户':'Default user'):(context.user.user_id||bank),banks:[bank],bankInfos:[],banksLoading:false,banksLoadingMore:false,hasMoreBanks:false,totalBanks:1,bankSearch:'',loadBanks:async()=>{},loadMoreBanks:async()=>{},searchBanks:async()=>{},setCurrentBank:()=>{}}}><FeaturesProvider>
 <div className="official-workspace hindsight-official"><AddDocument/><BankPage/><Toaster/></div>
 </FeaturesProvider></PlatformBankContext.Provider></HindsightNavigationContext.Provider></IntlProvider></I18nextProvider></PortalContainerContext.Provider>
}
