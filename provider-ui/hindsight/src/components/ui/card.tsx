import React from "react";
import * as Shared from "#/components/ui/card";
export const Card = Shared.Card;
export const CardHeader = Shared.CardHeader;
export const CardFooter = Shared.CardFooter;
export const CardTitle = Shared.CardTitle;
export const CardAction = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.CardAction ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
export const CardDescription = Shared.CardDescription;
export const CardContent = Shared.CardContent;
