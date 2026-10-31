import React from "react";
import * as Shared from "#/components/ui/pagination";
export const Pagination = Shared.Pagination;
export const PaginationContent = Shared.PaginationContent;
export const PaginationEllipsis = Shared.PaginationEllipsis;
export const PaginationItem = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.PaginationItem ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
export const PaginationLink = Shared.PaginationLink;
export const PaginationNext = Shared.PaginationNext;
export const PaginationPrevious = Shared.PaginationPrevious;
