import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import { Button } from "../ui/index";

type Write = { id: number; workspace: string; operation: string; state: "pending" | "uncertain" };
type Receipt = { confirmed(): void; uncertain(): void };
type Writes = { records: readonly Write[]; begin(workspace: string, operation: string): Receipt; acknowledge(id: number): void };
const Context = createContext<Writes | null>(null);

// Owned by the application, outside route/page keys, and remounted at login
// epoch changes. Keep only operation identity, never request/response data.
export function NativeWritesProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<readonly Write[]>([]);
  const sequence = useRef(0);
  const begin = useCallback((workspace: string, operation: string): Receipt => {
    const id = ++sequence.current;
    setRecords(previous => [...previous, { id, workspace, operation, state: "pending" }]);
    const settle = (confirmed: boolean) => setRecords(previous => {
      // An abandoned write stays uncertain even if its transport finishes late.
      if (!previous.some(record => record.id === id && record.state === "pending")) return previous;
      return confirmed ? previous.filter(record => record.id !== id)
        : previous.map(record => record.id === id ? { ...record, state: "uncertain" } : record);
    });
    return { confirmed: () => settle(true), uncertain: () => settle(false) };
  }, []);
  const acknowledge = useCallback((id: number) => {
    setRecords(previous => previous.filter(record => record.id !== id || record.state === "pending"));
  }, []);
  const outstanding = records.length > 0;
  useEffect(() => {
    if (!outstanding) return;
    // Hard navigation/reload destroys this session state. Let the browser warn
    // before losing pending or unacknowledged results.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [outstanding]);
  const value = useMemo(() => ({ records, begin, acknowledge }), [records, begin, acknowledge]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNativeWrites() {
  const context = useContext(Context);
  if (!context) throw new Error("NativeWritesProvider is required");
  return context;
}

export function NativeWriteNotices({ workspace }: { workspace: string }) {
  const { records, acknowledge } = useNativeWrites();
  const { t } = useTranslation();
  const uncertain = records.filter(record => record.workspace === workspace && record.state === "uncertain");
  if (!uncertain.length) return null;
  return <section className="memory-status memory-write-notice" role="alert">
    <CircleAlert size={20} aria-hidden="true" />
    <div className="memory-status-copy">
      <strong>{t("nativeMemory.unconfirmedWrites")}</strong>
      <p>{t("nativeMemory.uncertain")}</p>
      <ul>{uncertain.map(record => <li key={record.id}>
        <code>{record.operation}</code>
        <Button variant="text" size="sm" onClick={() => acknowledge(record.id)}>{t("nativeMemory.acknowledgeWrite")}</Button>
      </li>)}</ul>
    </div>
  </section>;
}
