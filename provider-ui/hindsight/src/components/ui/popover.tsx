import React from "react";
import * as Shared from "#/components/ui/popover";
export const Popover = Shared.Popover;
export const PopoverContent = Shared.PopoverContent;
export const PopoverDescription = Shared.PopoverDescription;
export const PopoverHeader = Shared.PopoverHeader;
export const PopoverTitle = Shared.PopoverTitle;
export const PopoverTrigger = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.PopoverTrigger ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
