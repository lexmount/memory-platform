import React from "react";
import * as Shared from "#/components/ui/tabs";
export const Tabs = Shared.Tabs;
export const TabsList = Shared.TabsList;
export const TabsTrigger = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.TabsTrigger ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
export const TabsContent = Shared.TabsContent;
