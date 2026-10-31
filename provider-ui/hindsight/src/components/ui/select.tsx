import React from "react";
import * as Shared from "#/components/ui/select";
export function Select({children,...props}:any) {
 const items:any[]=[];
 const visit=(nodes:any)=>React.Children.forEach(nodes,node=>{if(!React.isValidElement<any>(node))return;if(node.type===SelectItem)items.push({value:node.props.value,label:node.props.children});else visit(node.props.children)});
 visit(children);return <Shared.Select {...props} items={items}>{children}</Shared.Select>;
}
export const SelectContent = Shared.SelectContent;
export const SelectGroup = Shared.SelectGroup;
export const SelectItem = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.SelectItem ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
export const SelectLabel = Shared.SelectLabel;
export const SelectScrollDownButton = Shared.SelectScrollDownButton;
export const SelectScrollUpButton = Shared.SelectScrollUpButton;
export const SelectSeparator = Shared.SelectSeparator;
export const SelectTrigger = React.forwardRef<any,any>(({asChild,children,onSelect,...props},ref)=><Shared.SelectTrigger ref={ref} {...props} {...(onSelect?{onClick:onSelect}:{})} {...(asChild?{render:children}:{children})}/>);
export const SelectValue = Shared.SelectValue;
