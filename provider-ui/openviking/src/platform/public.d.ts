import type { ComponentType, HTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, ReactNode, Context } from 'react';
import type { MemoryWorkspaceContext } from '../../../web/src/memory/contracts';
export const OpenVikingWorkspace:ComponentType<{context:MemoryWorkspaceContext;path:string;language:string;portalContainer:HTMLElement|null;onNavigate:(path:string)=>void}>;
export const PortalContainerContext:Context<HTMLElement|null>;
export const Button:ComponentType<ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'default'|'outline'|'secondary'|'ghost'|'destructive'|'link';size?:'default'|'sm'|'lg'|'icon'}>;
export const Input:ComponentType<InputHTMLAttributes<HTMLInputElement>&{ref?:React.Ref<HTMLInputElement>}>;
export const Textarea:ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>&{ref?:React.Ref<HTMLTextAreaElement>}>;
export const Badge:ComponentType<HTMLAttributes<HTMLSpanElement>>;
export const Card:ComponentType<HTMLAttributes<HTMLDivElement>>;
export const Table:ComponentType<HTMLAttributes<HTMLTableElement>>;
export const TableHeader:ComponentType<HTMLAttributes<HTMLTableSectionElement>>;
export const TableBody:typeof TableHeader;
export const TableRow:ComponentType<HTMLAttributes<HTMLTableRowElement>>;
export const TableCell:ComponentType<HTMLAttributes<HTMLTableCellElement>>;
export const TableHead:typeof TableCell;

export const HindsightWorkspace:ComponentType<{context:MemoryWorkspaceContext;page:string;language:string;portalContainer:HTMLElement|null;onNavigate:(page:string)=>void}>;
