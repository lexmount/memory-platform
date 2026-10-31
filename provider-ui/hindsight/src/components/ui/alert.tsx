import React from "react";
import * as Shared from "#/components/ui/alert";
export const Alert = Shared.Alert;
export const AlertTitle = Shared.AlertTitle;
export const AlertDescription = Shared.AlertDescription;
export const AlertAction = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.AlertAction ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
