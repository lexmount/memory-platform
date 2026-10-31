"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "#/platform/hs-navigation";
import { useTranslations } from "use-intl";
import { toast } from "sonner";
import { platformLocalStorage as localStorage } from "#/platform/transport";

import { DataView } from "@hs/components/data-view";
import { DocumentsView } from "@hs/components/documents-view";
import { EntitiesView } from "@hs/components/entities-view";
import { KnowledgeBaseView } from "@hs/components/knowledge-base-view";
import { HomeView } from "@hs/components/home-view";
import { ThinkView } from "@hs/components/think-view";
import { SearchDebugView } from "@hs/components/search-debug-view";
import { BankProfileView } from "@hs/components/bank-profile-view";
import { BankConfigView } from "@hs/components/bank-config-view";
import { MemoryDefenseSection } from "@hs/components/memory-defense-section";
import { BankStatsView } from "@hs/components/bank-stats-view";
import { BankOperationsView } from "@hs/components/bank-operations-view";
import { MentalModelsView } from "@hs/components/mental-models-view";
import { WebhooksView } from "@hs/components/webhooks-view";
import { AuditLogsView } from "@hs/components/audit-logs-view";
import { LLMRequestsView } from "@hs/components/llm-requests-view";
import { FeatureNotEnabled } from "@hs/components/feature-not-enabled";
import { useFeatures } from "@hs/lib/features-context";
import { useBank } from "@hs/lib/bank-context";
import { bankRoute } from "@hs/lib/bank-url";
import { client } from "@hs/lib/api";
import { Button } from "@hs/components/ui/button";
import { UnderlineTabs } from "@hs/components/ui/underline-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hs/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@hs/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hs/components/ui/dialog";
import { Input } from "@hs/components/ui/input";
import { Checkbox } from "@hs/components/ui/checkbox";
import { Label } from "@hs/components/ui/label";
import {
  Brain,
  Copy,
  Download,
  Trash2,
  MoreVertical,
  Pencil,
  RotateCcw,
  Activity,
} from "lucide-react";
import { Spinner } from "@hs/components/ui/spinner";
import { LlmHealthDialog } from "@hs/components/llm-health-dialog";

type NavItem =
  | "home"
  | "recall"
  | "reflect"
  | "data"
  | "documents"
  | "entities"
  | "knowledge"
  | "profile";
type DataSubTab = "world" | "experience" | "observations";
type KnowledgeTab = "pages" | "models";
type BankConfigTab =
  | "general"
  | "memory-defense"
  | "configuration"
  | "webhooks"
  | "audit-logs"
  | "llm-requests";

const LAST_DATA_SUB_TAB_KEY = "hindsight.memories.subTab";

function readLastDataSubTab(): DataSubTab | null {
  try {
    const v = localStorage.getItem(LAST_DATA_SUB_TAB_KEY);
    return v === "world" || v === "experience" || v === "observations" ? v : null;
  } catch {
    return null;
  }
}

export default function BankPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("bank");
  const tCommon = useTranslations("common");
  const { features } = useFeatures();
  const { currentBank: bankId, currentBankName, setCurrentBank, loadBanks } = useBank();

  const view = (searchParams.get("view") || "home") as NavItem;
  // Memories reopens on the sub-tab the user last picked, not always World —
  // unless the URL names one, so a shared link still wins. `undefined` until
  // storage has been read after mount (it can't be read during server render),
  // and the tab body waits for it so World isn't loaded only to be thrown away.
  const urlSubTab = searchParams.get("subTab") as DataSubTab | null;
  const [lastSubTab, setLastSubTab] = useState<DataSubTab | null | undefined>(undefined);
  useEffect(() => setLastSubTab(readLastDataSubTab()), []);
  const subTab: DataSubTab = urlSubTab || lastSubTab || "world";
  const subTabReady = urlSubTab !== null || lastSubTab !== undefined;
  const knowledgeTab = (searchParams.get("knowledgeTab") || "pages") as KnowledgeTab;
  const bankConfigTab = (searchParams.get("bankConfigTab") || "general") as BankConfigTab;
  const bankConfigEnabled = features?.bank_config_api ?? false;
  const llmTraceEnabled = features?.llm_trace ?? false;
  const llmHealthEnabled = features?.bank_llm_health ?? false;
  // A clone is an export and an import back to back, so it needs both halves
  // enabled server-side — the endpoint answers 404 otherwise.
  const cloneEnabled =
    false;

  // `audit_log_enabled` and `enable_observations` are hierarchical
  // (env -> tenant -> bank): a bank can opt in even when the deployment default
  // is off. The /version feature flags only report the global default, so gate
  // these tabs on the bank's *resolved* config instead. Fall back to the global
  // flag when the bank config API is disabled (per-bank overrides can't exist
  // then) or the field is unavailable.
  const [bankAuditLogEnabled, setBankAuditLogEnabled] = useState<boolean | null>(null);
  const [bankObservationsEnabled, setBankObservationsEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!bankId || !bankConfigEnabled) {
      setBankAuditLogEnabled(null);
      setBankObservationsEnabled(null);
      return;
    }
    let cancelled = false;
    client
      .getBankConfig(bankId)
      .then((r) => {
        if (cancelled) return;
        const audit = r.config?.audit_log_enabled;
        const observations = r.config?.enable_observations;
        setBankAuditLogEnabled(typeof audit === "boolean" ? audit : null);
        setBankObservationsEnabled(typeof observations === "boolean" ? observations : null);
      })
      .catch(() => {
        if (cancelled) return;
        setBankAuditLogEnabled(null);
        setBankObservationsEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bankId, bankConfigEnabled]);
  const auditLogEnabled = bankAuditLogEnabled ?? features?.audit_log ?? false;
  const observationsEnabled = bankObservationsEnabled ?? features?.observations ?? false;
  // The fact types behind the Memories tabs, so each tab can warm the others.
  const memoryTabTypes: ("world" | "experience" | "observation")[] = observationsEnabled
    ? ["world", "experience", "observation"]
    : ["world", "experience"];

  // Bank actions state
  const [showLlmHealthDialog, setShowLlmHealthDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showClearObservationsDialog, setShowClearObservationsDialog] = useState(false);
  const [isClearingObservations, setIsClearingObservations] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [isRecoveringConsolidation, setIsRecoveringConsolidation] = useState(false);
  const [showResetConfigDialog, setShowResetConfigDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneTargetId, setCloneTargetId] = useState("");
  // One checkbox per include_* flag the clone endpoint takes, with the same
  // defaults, so what the dialog offers and what the API does are the same three
  // choices rather than a UI-only summary of them.
  const [cloneIncludeData, setCloneIncludeData] = useState(true);
  const [cloneIncludeBankConfig, setCloneIncludeBankConfig] = useState(true);
  const [cloneIncludeHistory, setCloneIncludeHistory] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isResettingConfig, setIsResettingConfig] = useState(false);

  const handleTabChange = (tab: NavItem) => {
    if (!bankId) return;
    router.push(bankRoute(bankId, `?view=${tab}`));
  };

  const handleDataSubTabChange = (newSubTab: DataSubTab) => {
    if (!bankId) return;
    try {
      localStorage.setItem(LAST_DATA_SUB_TAB_KEY, newSubTab);
    } catch {
      // Storage blocked: the tab just won't be remembered.
    }
    // The native history API updates useSearchParams without a router round
    // trip, so the tab switches on the click instead of after a navigation.
    router.push(bankRoute(bankId, `?view=data&subTab=${newSubTab}`));
  };

  const handleKnowledgeTabChange = (tab: KnowledgeTab) => {
    if (!bankId) return;
    router.push(bankRoute(bankId, `?view=knowledge&knowledgeTab=${tab}`));
  };

  const handleBankConfigTabChange = (newTab: BankConfigTab) => {
    if (!bankId) return;
    router.push(bankRoute(bankId, `?view=profile&bankConfigTab=${newTab}`));
  };

  const handleDeleteBank = async () => {
    if (!bankId) return;

    setIsDeleting(true);
    try {
      await client.deleteBank(bankId);
      setShowDeleteDialog(false);
      setCurrentBank(null);
      await loadBanks();
      router.push("/");
    } catch (error) {
      // Error toast is shown automatically by the API client interceptor
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClearObservations = async () => {
    if (!bankId) return;

    setIsClearingObservations(true);
    try {
      const result = await client.clearObservations(bankId);
      setShowClearObservationsDialog(false);
      toast.success(t("observationsCleared"), {
        description: result.message || t("observationsClearedDefault"),
      });
    } catch (error) {
      // Error toast is shown automatically by the API client interceptor
    } finally {
      setIsClearingObservations(false);
    }
  };

  const handleCloneBank = async () => {
    const target = cloneTargetId.trim();
    if (!bankId || !target) return;
    setIsCloning(true);
    try {
      const { operation_id } = await client.cloneBank(bankId, target, {
        includeData: cloneIncludeData,
        includeBankConfig: cloneIncludeBankConfig,
        includeHistory: cloneIncludeHistory,
      });
      toast.success(t("cloneStarted"));

      // The clone runs in the background: re-embedding every fact takes as long
      // as the bank is big, so the dialog waits on the operation rather than
      // dropping the user on a bank that is still filling up.
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        const op = await client.getOperationStatus(bankId, operation_id);
        if (op.status === "completed") {
          toast.success(t("cloneSucceeded", { bankName: target }));
          setShowCloneDialog(false);
          router.push(bankRoute(target, "?view=profile"));
          return;
        }
        if (op.status === "failed") {
          toast.error(op.error_message || t("cloneFailed"));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      toast.error(t("cloneFailed"));
    } catch {
      // No toast here: the API client already showed one carrying the server's
      // own message ("Target bank '…' already exists", …), which is more useful
      // than a generic failure. A second one just stacks a red alert under it.
    } finally {
      setIsCloning(false);
    }
  };

  const handleResetConfig = async () => {
    if (!bankId) return;
    setIsResettingConfig(true);
    try {
      await client.resetBankConfig(bankId);
      setShowResetConfigDialog(false);
    } catch {
      // Error toast shown by API client interceptor
    } finally {
      setIsResettingConfig(false);
    }
  };

  const handleTriggerConsolidation = async () => {
    if (!bankId) return;

    setIsConsolidating(true);
    try {
      await client.triggerConsolidation(bankId);
    } catch (error) {
      // Error toast is shown automatically by the API client interceptor
    } finally {
      setIsConsolidating(false);
    }
  };

  const handleRecoverConsolidation = async () => {
    if (!bankId) return;

    setIsRecoveringConsolidation(true);
    try {
      const result = await client.recoverConsolidation(bankId);
      toast.success(t("recoveredMemories", { count: result.retried_count }));
    } catch (error) {
      // Error toast is shown automatically by the API client interceptor
    } finally {
      setIsRecoveringConsolidation(false);
    }
  };

  return (
    <div className="hindsight-bank-page">
              {/* Bank Configuration Tab */}
              {view === "profile" && (
                <div>
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h1 className="text-3xl font-bold mb-2 text-foreground">
                        {t("bankConfiguration")}
                      </h1>
                      <p className="text-muted-foreground">{t("bankConfigurationDescription")}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          {t("actions")}
                          <MoreVertical className="w-4 h-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={async () => {
                            if (!bankId) return;
                            try {
                              const manifest = await client.exportBankTemplate(bankId);
                              const json = JSON.stringify(manifest, null, 2);
                              await navigator.clipboard.writeText(json);
                              toast.success(t("templateCopied"));
                            } catch {
                              toast.error(t("failedToExportTemplate"));
                            }
                          }}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          {t("exportTemplate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setCloneTargetId(bankId ? `${bankId}-copy` : "");
                            setCloneIncludeData(true);
                            setCloneIncludeBankConfig(true);
                            setCloneIncludeHistory(false);
                            setShowCloneDialog(true);
                          }}
                          disabled={!cloneEnabled}
                          title={
                            !cloneEnabled
                              ? t("platformLifecycleManaged")
                              : undefined
                          }
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          {t("cloneBank")}
                          {!cloneEnabled && (
                            <span className="ml-auto text-xs text-muted-foreground">Off</span>
                          )}
                        </DropdownMenuItem>
                        {llmHealthEnabled && (
                          <DropdownMenuItem onClick={() => setShowLlmHealthDialog(true)}>
                            <Activity className="w-4 h-4 mr-2" />
                            {t("health")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleTriggerConsolidation}
                          disabled={isConsolidating || !observationsEnabled}
                          title={
                            !observationsEnabled ? "Observations feature is not enabled" : undefined
                          }
                        >
                          {isConsolidating ? (
                            <Spinner size="sm" className="mr-2" />
                          ) : (
                            <Brain className="w-4 h-4 mr-2" />
                          )}
                          {isConsolidating ? t("consolidating") : t("runConsolidation")}
                          {!observationsEnabled && (
                            <span className="ml-auto text-xs text-muted-foreground">Off</span>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleRecoverConsolidation}
                          disabled={isRecoveringConsolidation || !observationsEnabled}
                          title={
                            !observationsEnabled ? "Observations feature is not enabled" : undefined
                          }
                        >
                          {isRecoveringConsolidation ? (
                            <Spinner size="sm" className="mr-2" />
                          ) : (
                            <RotateCcw className="w-4 h-4 mr-2" />
                          )}
                          {isRecoveringConsolidation ? t("recovering") : t("recoverConsolidation")}
                          {!observationsEnabled && (
                            <span className="ml-auto text-xs text-muted-foreground">Off</span>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setShowClearObservationsDialog(true)}
                          disabled={!observationsEnabled}
                          className="text-amber-600 dark:text-amber-400 focus:text-amber-700 dark:focus:text-amber-300"
                          title={
                            !observationsEnabled ? "Observations feature is not enabled" : undefined
                          }
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          {t("clearObservations")}
                          {!observationsEnabled && (
                            <span className="ml-auto text-xs text-muted-foreground">Off</span>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowResetConfigDialog(true)}
                          disabled={!bankConfigEnabled}
                          className="text-amber-600 dark:text-amber-400 focus:text-amber-700 dark:focus:text-amber-300"
                          title={!bankConfigEnabled ? "Bank Config API is disabled" : undefined}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          {t("resetConfiguration")}
                          {!bankConfigEnabled && (
                            <span className="ml-auto text-xs text-muted-foreground">Off</span>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled title={t("platformLifecycleManaged")} onClick={() => setShowDeleteDialog(true)}
                          className="text-red-600 dark:text-red-400 focus:text-red-700 dark:focus:text-red-300"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          {t("deleteBank")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <UnderlineTabs
                    value={bankConfigTab}
                    onChange={handleBankConfigTabChange}
                    tabs={[
                      { id: "general", label: t("general") },
                      ...(bankConfigEnabled
                        ? [
                            { id: "memory-defense" as const, label: t("memoryDefense") },
                            { id: "configuration" as const, label: t("configuration") },
                          ]
                        : []),
                      { id: "webhooks", label: t("webhooks") },
                      { id: "audit-logs", label: t("auditLogs"), off: !auditLogEnabled },
                      { id: "llm-requests", label: t("llmRequests"), off: !llmTraceEnabled },
                    ]}
                  />

                  {/* Tab content */}
                  <div>
                    {bankConfigTab === "general" && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t("overviewAndOperations")}
                        </p>
                        <div className="space-y-6">
                          <BankStatsView />
                          <BankOperationsView />
                          <BankProfileView hideReflectFields />
                        </div>
                      </div>
                    )}
                    {bankConfigTab === "memory-defense" && bankConfigEnabled && bankId && (
                      <div className="space-y-6">
                        <MemoryDefenseSection bankId={bankId} />
                      </div>
                    )}
                    {bankConfigTab === "configuration" && bankConfigEnabled && (
                      <div className="space-y-6">
                        <BankConfigView manageAliases={false} />
                      </div>
                    )}
                    {bankConfigTab === "webhooks" && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t("webhooksDescription")}
                        </p>
                        <WebhooksView />
                      </div>
                    )}
                    {bankConfigTab === "audit-logs" &&
                      (auditLogEnabled ? (
                        <div>
                          <p className="text-sm text-muted-foreground mb-4">
                            {t("auditLogsDescription")}
                          </p>
                          <AuditLogsView />
                        </div>
                      ) : (
                        <FeatureNotEnabled
                          title={t("auditLogsNotEnabled")}
                          description={t.rich("auditLogsDisabledMessage", {
                            envVar: () => (
                              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                                HINDSIGHT_API_AUDIT_LOG_ENABLED=true
                              </code>
                            ),
                          })}
                        />
                      ))}
                    {bankConfigTab === "llm-requests" &&
                      (llmTraceEnabled ? (
                        <div>
                          <p className="text-sm text-muted-foreground mb-4">
                            {t("llmRequestsDescription")}
                          </p>
                          <LLMRequestsView />
                        </div>
                      ) : (
                        <FeatureNotEnabled
                          title={t("llmRequestsNotEnabled")}
                          description={t.rich("llmRequestsDisabledMessage", {
                            envVar: () => (
                              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                                HINDSIGHT_API_LLM_TRACE_ENABLED=true
                              </code>
                            ),
                          })}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Recall Tab */}
              {view === "recall" && (
                <div>
                  <h1 className="text-3xl font-bold mb-2 text-foreground">{t("recallAnalyzer")}</h1>
                  <p className="text-muted-foreground mb-6">{t("recallAnalyzerDescription")}</p>
                  <SearchDebugView />
                </div>
              )}

              {/* Reflect Tab */}
              {view === "reflect" && (
                <div>
                  <h1 className="text-3xl font-bold mb-2 text-foreground">{t("reflect")}</h1>
                  <p className="text-muted-foreground mb-6">{t("reflectDescription")}</p>
                  <ThinkView />
                </div>
              )}

              {/* Data/Memories Tab */}
              {view === "data" && (
                <div>
                  <h1 className="text-3xl font-bold mb-2 text-foreground">{t("memories")}</h1>
                  <p className="text-muted-foreground mb-6">{t("memoriesDescription")}</p>

                  <UnderlineTabs
                    value={subTab}
                    onChange={handleDataSubTabChange}
                    tabs={[
                      { id: "world", label: t("worldFacts") },
                      { id: "experience", label: t("experience") },
                      { id: "observations", label: t("observations"), off: !observationsEnabled },
                    ]}
                  />

                  <div>
                    {subTabReady && subTab === "world" && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t("worldFactsDescription")}
                        </p>
                        <DataView
                          key="world"
                          factType="world"
                          prefetchTypes={memoryTabTypes.filter((ft) => ft !== "world")}
                        />
                      </div>
                    )}
                    {subTabReady && subTab === "experience" && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t("experienceDescription")}
                        </p>
                        <DataView
                          key="experience"
                          factType="experience"
                          prefetchTypes={memoryTabTypes.filter((ft) => ft !== "experience")}
                        />
                      </div>
                    )}
                    {subTabReady &&
                      subTab === "observations" &&
                      (observationsEnabled ? (
                        <div>
                          <p className="text-sm text-muted-foreground mb-4">
                            {t("observationsDescription")}
                          </p>
                          <DataView
                            key="observations"
                            factType="observation"
                            prefetchTypes={memoryTabTypes.filter((ft) => ft !== "observation")}
                          />
                        </div>
                      ) : (
                        <FeatureNotEnabled
                          title={t("observationsNotEnabled")}
                          description={t.rich("observationsDisabledMessage", {
                            envVar: () => (
                              <code className="px-1 py-0.5 bg-muted rounded text-xs">
                                HINDSIGHT_API_ENABLE_OBSERVATIONS=true
                              </code>
                            ),
                          })}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Documents Tab — DocumentsView renders its own title row so the
                Export/Import Actions menu can sit beside the heading. */}
              {view === "documents" && (
                <div>
                  <DocumentsView />
                </div>
              )}

              {/* Entities Tab */}
              {view === "entities" && (
                <div>
                  <h1 className="text-3xl font-bold mb-2 text-foreground">{t("entities")}</h1>
                  <p className="text-muted-foreground mb-6">{t("entitiesDescription")}</p>
                  <EntitiesView />
                </div>
              )}

              {/* Knowledge Tab — Pages (knowledge base) + Mental Models sub-tabs. */}
              {view === "knowledge" && (
                <div>
                  <h1 className="text-3xl font-bold mb-2 text-foreground">{t("knowledge")}</h1>
                  <p className="text-muted-foreground mb-4">{t("knowledgeDescription")}</p>

                  <UnderlineTabs
                    className="mb-4"
                    value={knowledgeTab}
                    onChange={handleKnowledgeTabChange}
                    tabs={[
                      { id: "pages", label: t("pages") },
                      { id: "models", label: t("mentalModels") },
                    ]}
                  />

                  {/* Keyed by bank so switching banks remounts the view: every
                      bank-scoped piece of state (tree, open tabs, selected page and
                      its backing mental model) is dropped in one go, instead of
                      effects re-running against a half-cleared previous bank. */}
                  {knowledgeTab === "pages" && <KnowledgeBaseView key={bankId ?? "no-bank"} />}
                  {knowledgeTab === "models" && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-4">
                        {t("mentalModelsDescription")}
                      </p>
                      <MentalModelsView key="mental-models" />
                    </div>
                  )}
                </div>
              )}

              {/* Home Tab — bank dashboard. */}
              {view === "home" && bankId && (
                <HomeView bankId={bankId} bankName={currentBankName ?? bankId} onNavigate={(tab) => handleTabChange(tab as NavItem)} />
              )}

      {/* LLM connectivity check */}
      {bankId && (
        <LlmHealthDialog
          bankId={bankId}
          open={showLlmHealthDialog}
          onOpenChange={setShowLlmHealthDialog}
        />
      )}

      {/* Dry-run extraction */}

      {/* Delete Bank Confirmation Dialog */}
      {/* Clone bank */}
      <Dialog open={showCloneDialog} onOpenChange={setShowCloneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cloneBankTitle")}</DialogTitle>
            <DialogDescription>{t("cloneBankDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clone-target-id">{t("cloneTargetLabel")}</Label>
              <Input
                id="clone-target-id"
                value={cloneTargetId}
                onChange={(e) => setCloneTargetId(e.target.value)}
                placeholder={t("cloneTargetPlaceholder")}
                disabled={isCloning}
                autoFocus
              />
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("cloneWhatToCopy")}</p>
              {(
                [
                  {
                    id: "clone-include-data",
                    label: t("cloneIncludeData"),
                    hint: t("cloneIncludeDataHint"),
                    checked: cloneIncludeData,
                    set: setCloneIncludeData,
                  },
                  {
                    id: "clone-include-bank-config",
                    label: t("cloneIncludeBankConfig"),
                    hint: t("cloneIncludeBankConfigHint"),
                    checked: cloneIncludeBankConfig,
                    set: setCloneIncludeBankConfig,
                  },
                  {
                    id: "clone-include-history",
                    label: t("cloneIncludeHistory"),
                    hint: t("cloneIncludeHistoryHint"),
                    checked: cloneIncludeHistory,
                    set: setCloneIncludeHistory,
                  },
                ] as const
              ).map((flag) => (
                <div key={flag.id} className="flex items-start gap-2">
                  <Checkbox
                    id={flag.id}
                    checked={flag.checked}
                    onCheckedChange={(checked) => flag.set(checked === true)}
                    disabled={isCloning}
                    // The checkbox is 16px and the label line is 20px, so without
                    // this the box rides above the text it belongs to.
                    className="mt-0.5"
                  />
                  <div className="grid gap-1 leading-none">
                    <Label htmlFor={flag.id}>{flag.label}</Label>
                    <p className="text-xs text-muted-foreground">{flag.hint}</p>
                  </div>
                </div>
              ))}
              {!cloneIncludeData && !cloneIncludeBankConfig && !cloneIncludeHistory && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("cloneNothingSelected")}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCloneDialog(false)}
              disabled={isCloning}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleCloneBank}
              disabled={
                isCloning ||
                !cloneTargetId.trim() ||
                (!cloneIncludeData && !cloneIncludeBankConfig && !cloneIncludeHistory)
              }
            >
              {isCloning && <Spinner size="sm" className="mr-2" />}
              {isCloning ? t("cloning") : t("cloneBank")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteMemoryBank")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {t.rich("deleteBankPrompt", {
                    bankName: () => <span className="font-semibold text-foreground">{bankId}</span>,
                  })}
                </p>
                <p className="text-red-600 dark:text-red-400 font-medium">
                  {t("deleteBankWarning")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBank}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t("deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t("deleteBank")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Configuration Confirmation Dialog */}
      <AlertDialog open={showResetConfigDialog} onOpenChange={setShowResetConfigDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resetConfigTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {t.rich("resetConfigPrompt", {
                    bankName: () => <span className="font-semibold text-foreground">{bankId}</span>,
                  })}
                </p>
                <p className="text-amber-600 dark:text-amber-400 font-medium">
                  {t("resetConfigWarning")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResettingConfig}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetConfig} disabled={isResettingConfig}>
              {isResettingConfig ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t("resetting")}
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {t("resetConfiguration")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Observations Confirmation Dialog */}
      <AlertDialog open={showClearObservationsDialog} onOpenChange={setShowClearObservationsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clearObservationsTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {t.rich("clearObservationsPrompt", {
                    bankName: () => <span className="font-semibold text-foreground">{bankId}</span>,
                  })}
                </p>
                <p className="text-amber-600 dark:text-amber-400 font-medium">
                  {t("clearObservationsWarning")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearingObservations}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearObservations}
              disabled={isClearingObservations}
              className="bg-amber-500 text-white hover:bg-amber-600"
            >
              {isClearingObservations ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t("clearing")}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t("clearObservations")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
