import React from "react";
import * as Shared from "#/components/ui/button";
export const Button = React.forwardRef<any,any>(({asChild,children,variant,...props},ref)=><Shared.Button ref={ref} variant={variant==="gradient"?"default":variant} {...props} {...(asChild?{render:children}:{children})}/>);
export const buttonVariants = (props:any={}) => Shared.buttonVariants({...props,variant:props.variant==="gradient"?"default":props.variant});
export type ButtonProps = React.ComponentProps<typeof Button>;
