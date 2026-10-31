import React, { useEffect, useLayoutEffect, useState } from 'react'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18n from '#/i18n'
import { queryClient } from '#/lib/query-client'
import { routeTree } from './routes'
import { PlatformConnectionProvider } from '#/hooks/use-app-connection'
import { TooltipProvider } from '#/components/ui/tooltip'
import { PortalContainerContext } from './portal'
import { bindPlatform, type PlatformContext } from './transport'
import '#/styles.css'
const allowed = /^\/(filesystem|retrieval|skills|tasks|watches|compile|agent-experience|home|request-logs)(\/|\?|$)/
export function OpenVikingWorkspace({context,path,language,portalContainer,onNavigate}:{context:PlatformContext;path:string;language:string;portalContainer:HTMLElement|null;onNavigate:(path:string)=>void}) {
 const [ready,setReady]=useState(false)
 const [router]=useState(()=>createRouter({routeTree,history:createMemoryHistory({initialEntries:[allowed.test(path)?path:'/filesystem']}),defaultPreload:false}))
 useLayoutEffect(()=>{const release=bindPlatform(context);queryClient.clear();setReady(true);return()=>{release();void queryClient.cancelQueries();queryClient.clear()}},[context])
 useEffect(()=>{void i18n.changeLanguage(language.startsWith('zh')?'zh-CN':'en')},[language])
 useEffect(()=>{if(allowed.test(path)&&router.state.location.href!==path)void router.navigate({to:path,replace:true})},[path,router])
 useEffect(()=>router.subscribe('onResolved',()=>{const next=router.state.location.href;if(allowed.test(next))onNavigate(next);else void router.navigate({to:path,replace:true})}),[router,onNavigate,path])
 if(!ready)return <div role="status">Loading…</div>
 return <PortalContainerContext.Provider value={portalContainer}><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}><TooltipProvider><PlatformConnectionProvider identity={context.identity} mapping={context.user.mapping}>
  <div className="official-workspace"><RouterProvider router={router}/></div>
 </PlatformConnectionProvider></TooltipProvider></QueryClientProvider></I18nextProvider></PortalContainerContext.Provider>
}
