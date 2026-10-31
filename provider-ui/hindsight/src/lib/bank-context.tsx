import React,{createContext,useContext} from 'react';
export const PlatformBankContext=createContext<any>(null);
export const useBank=()=>useContext(PlatformBankContext);
