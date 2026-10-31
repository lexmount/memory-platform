import { useMemo } from "react";
import { BookOpen, FileText, ListTodo, MessagesSquare, Search, Database, Code, Shield, RefreshCw, Settings, Terminal } from "lucide-react";
import type { MemoryProviderModule, MemoryWorkspaceContext } from "../contracts";
import { NativeOperations } from "../NativeOperations";
import { createOVClient, OVError } from "./client";
import { ErrorNotice } from "./shared";
import { ContentPage } from "./Content";
import { SessionsPage } from "./Sessions";
import { RetrievalPage } from "./Retrieval";
import { TasksPage } from "./Tasks";
import { ExperiencePage } from "./Experience";

function Workspace({ context, page }: { context: MemoryWorkspaceContext; page: string }) {
  const client = useMemo(() => createOVClient(context), [context]);
  if (!context.user.mapping.memory_uri) return <ErrorNotice error={new OVError("invalidResponse", "Missing memory mapping")} />;
  const section = page.split("/")[0] ?? "";
  if (["resources", "skills", "privacy", "watches", "settings", "compile", "diagnostics", "native"].includes(section)) return <NativeOperations key={page} context={context} group={section} />;
  const Component = { content: ContentPage, sessions: SessionsPage, retrieval: RetrievalPage, tasks: TasksPage, experience: ExperiencePage }[page.split("/")[0] ?? ""];
  // Page-specific mutations, drafts and timers end on navigation, even though
  // the host deliberately keeps the subject context alive between pages.
  return Component ? <div className="ov-workspace"><Component key={page} context={context} client={client} /></div> : null;
}
export const openVikingModule: MemoryProviderModule = {
  id: "openviking", labelKey: "ov.label", defaultPage: "content",
  navigation: [
    { id: "content", labelKey: "ov.content", icon: FileText },
    { id: "resources", labelKey: "nativeMemory.resources", icon: Database },
    { id: "skills", labelKey: "nativeMemory.skills", icon: Code },
    { id: "sessions", labelKey: "ov.sessions", icon: MessagesSquare },
    { id: "retrieval", labelKey: "ov.retrieval", icon: Search },
    { id: "tasks", labelKey: "ov.tasks", icon: ListTodo },
    { id: "experience", labelKey: "ov.experience", icon: BookOpen },
    { id: "privacy", labelKey: "nativeMemory.privacy", icon: Shield },
    { id: "watches", labelKey: "nativeMemory.watches", icon: RefreshCw },
    { id: "settings", labelKey: "nativeMemory.settings", icon: Settings },
    { id: "compile", labelKey: "nativeMemory.compile", icon: Code },
    { id: "diagnostics", labelKey: "nativeMemory.diagnostics", icon: ListTodo },
    { id: "native", labelKey: "nativeMemory.title", icon: Terminal },
  ],
  Workspace,
};
