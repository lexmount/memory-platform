import React,{createContext,useContext} from 'react'
export const HindsightNavigationContext=createContext({path:'',navigate:(_href:string)=>{},resolveHref:(href:string)=>href})
export function usePathname(){return useContext(HindsightNavigationContext).path.split('?')[0]}
export function useRouter(){const {navigate}=useContext(HindsightNavigationContext);return {push:navigate,replace:navigate,refresh:()=>{}}}
export function useSearchParams(){return new URLSearchParams(useContext(HindsightNavigationContext).path.split('?')[1]||'')}
export default function Link({href,onClick,...props}:any){const {navigate,resolveHref}=useContext(HindsightNavigationContext);return <a {...props} href={resolveHref(String(href))} onClick={e=>{onClick?.(e);if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(String(href))}}/>}
