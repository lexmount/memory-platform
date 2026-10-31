import { OfficialHindsight } from "./OfficialWorkspace";
import { useTranslation } from "react-i18next";
import { Activity, BookOpen, Brain, Files, LayoutDashboard, Network, Settings, Sparkles, Terminal } from "lucide-react";
import { Badge } from "../../ui/index";
import { type MemoryBridge, type MemoryProviderModule, type MemoryWorkspaceContext } from "../contracts";
import { type HindsightClient } from "./client";
import { NativeOperations } from "../NativeOperations";
import { Collection } from "./collections";
import { EntityExplorer, Knowledge, Playground } from "./explore";
import { useHindsight } from "./hooks";
import { Management, Overview } from "./manage";

function renderPage(page: string, client: HindsightClient, formatTimeBucket?: MemoryBridge["formatTimeBucket"]) {
  switch (page) {
    case "overview": return <Overview client={client} formatTimeBucket={formatTimeBucket} />;
    case "memories": return <Collection client={client} kind="memories" />;
    case "documents": return <Collection client={client} kind="documents" />;
    case "entities": return <EntityExplorer client={client} />;
    case "models": return <Collection client={client} kind="models" />;
    case "knowledge": return <Knowledge client={client} />;
    case "playground": return <Playground client={client} />;
    case "management": return <Management client={client} />;
    default: return null;
  }
}
function HindsightWorkspace({ context, page, formatTimeBucket }: { context: MemoryWorkspaceContext; page: string; formatTimeBucket?: MemoryBridge["formatTimeBucket"] }) {
  const { t } = useTranslation(), client = useHindsight(context);
  const pageID = page.split("/")[0] ?? "";
  if (["memories","documents","entities","models","knowledge","playground"].includes(pageID) && context.provider.version === "1.1.0") return <OfficialHindsight context={context} page={pageID}/>;
  return <div className="hs-workspace" data-hindsight-workspace>
    <div className="hs-toolbar hs-intro"><div><strong>{t("hindsight.title")}</strong><Badge>{context.provider.version}</Badge></div>

    </div>
    <div key={`${context.identity}:${pageID}`}>
      {pageID === "native" ? <NativeOperations context={context} /> : renderPage(pageID, client, formatTimeBucket)}
    </div>
  </div>;
}

export const hindsightModule: MemoryProviderModule = Object.freeze({
  id: "hindsight", labelKey: "hindsight.title", defaultPage: "memories",
  navigation: [
    { id: "overview", labelKey: "hindsight.overview", icon: LayoutDashboard },
    { id: "memories", labelKey: "hindsight.memories", icon: Brain },
    { id: "documents", labelKey: "hindsight.documents", icon: Files },
    { id: "entities", labelKey: "hindsight.entities", icon: Network },
    { id: "models", labelKey: "hindsight.models", icon: Activity },
    { id: "knowledge", labelKey: "hindsight.knowledge", icon: BookOpen },
    { id: "playground", labelKey: "hindsight.playground", icon: Sparkles },
    { id: "management", labelKey: "hindsight.management", icon: Settings },
    { id: "native", labelKey: "nativeMemory.title", icon: Terminal },
  ],
  Workspace: HindsightWorkspace,
});
