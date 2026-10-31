import React,{useLayoutEffect,useState} from 'react'
import { IntlProvider } from 'use-intl'
import { PlatformBankContext } from '@hs/lib/bank-context'
import { FeaturesProvider } from '@hs/lib/features-context'
import { DocumentsView } from '@hs/components/documents-view'
import { DataView } from '@hs/components/data-view'
import { MentalModelsView } from '@hs/components/mental-models-view'
import { EntitiesView } from '@hs/components/entities-view'
import { ThinkView } from '@hs/components/think-view'
import { KnowledgeBaseView } from '@hs/components/knowledge-base-view'
import en from '@hs/messages/en.json'
import zh from '@hs/messages/zh-CN.json'
import { bindPlatform,type PlatformContext } from './transport'
import { PortalContainerContext } from './portal'
import { HindsightNavigationContext } from './hs-navigation'
import { Tabs,TabsList,TabsTrigger } from '#/components/ui/tabs'
import { Toaster } from '#/components/ui/sonner'
export function HindsightWorkspace({context,page,language,portalContainer,onNavigate}:{context:PlatformContext;page:string;language:string;portalContainer:HTMLElement|null;onNavigate:(page:string)=>void}) {
 const [ready,setReady]=useState(false),[type,setType]=useState('world')
 useLayoutEffect(()=>{const release=bindPlatform(context);setReady(true);return release},[context])
 if(!ready)return <div role="status">Loading…</div>
 const chinese=language.startsWith('zh'),bank=context.user.mapping.bank_id
 const nav=(href:string)=>{const v=new URL(href,window.location.origin).searchParams.get('view');onNavigate(({data:'memories',documents:'documents',entities:'entities','mental-models':'models',knowledge:'knowledge',think:'playground'} as Record<string,string>)[v||'']||page)}
 const views:Record<string,React.ReactNode>={documents:<DocumentsView/>,models:<MentalModelsView/>,entities:<EntitiesView/>,playground:<ThinkView/>,knowledge:<KnowledgeBaseView/>}
 return <PortalContainerContext.Provider value={portalContainer}><IntlProvider locale={chinese?'zh-CN':'en'} messages={chinese?zh:en} timeZone="Asia/Shanghai"><HindsightNavigationContext.Provider value={{path:'/banks/'+bank,navigate:nav}}><PlatformBankContext.Provider value={{currentBank:bank,currentBankName:bank,banks:[bank],bankInfos:[],banksLoading:false,banksLoadingMore:false,hasMoreBanks:false,totalBanks:1,bankSearch:'',loadBanks:async()=>{},loadMoreBanks:async()=>{},searchBanks:async()=>{},setCurrentBank:()=>{}}}><FeaturesProvider>
 <div className="official-workspace hindsight-official" key={page}>{page==='memories'?<><Tabs value={type} onValueChange={value=>setType(String(value))}><TabsList><TabsTrigger value="world">{chinese?'客观事实':'World'}</TabsTrigger><TabsTrigger value="experience">{chinese?'经历':'Experience'}</TabsTrigger><TabsTrigger value="observation">{chinese?'观察总结':'Observations'}</TabsTrigger></TabsList></Tabs><DataView key={type} factType={type as any}/></>:views[page]}<Toaster/></div>
 </FeaturesProvider></PlatformBankContext.Provider></HindsightNavigationContext.Provider></IntlProvider></PortalContainerContext.Provider>
}
