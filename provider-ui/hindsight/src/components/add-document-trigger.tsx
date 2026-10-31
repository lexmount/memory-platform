import { createContext, useContext } from "react";
import { useTranslations } from "use-intl";
import { Plus } from "lucide-react";
import { Button } from "@hs/components/ui/button";

export const AddDocumentContext = createContext<(() => void) | null>(null);
export function AddDocumentTrigger({ light = false, empty = false }: { light?: boolean; empty?: boolean }) {
  const open = useContext(AddDocumentContext);
  const t = useTranslations("addDocument");
  if (!open) return null;
  return <Button variant={light ? "ghost" : "default"} size="sm" className={light ? "h-7 gap-1 px-2 text-xs" : "h-9 shrink-0 gap-1.5"} onClick={open} data-add-document>
    <Plus className="h-4 w-4" />{t(empty ? "generateMemoriesButton" : light ? "addShort" : "addDocumentButton")}
  </Button>;
}
