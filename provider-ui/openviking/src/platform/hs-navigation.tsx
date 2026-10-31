import React,{createContext,useContext} from 'react'
export const HindsightNavigationContext=createContext({path:'',navigate:(_href:string)=>{}})
export function usePathname(){return useContext(HindsightNavigationContext).path}
export function useRouter(){const {navigate}=useContext(HindsightNavigationContext);return {push:navigate,replace:navigate,refresh:()=>{}}}
export function useSearchParams(){return new URLSearchParams(usePathname().split('?')[1]||'')}
export default function Link({href,onClick,...props}:any){const {navigate}=useContext(HindsightNavigationContext);return <a {...props} href={href} onClick={e=>{e.preventDefault();onClick?.(e);navigate(String(href))}}/>}
