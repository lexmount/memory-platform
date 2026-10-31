import officialStyles from "../../provider-ui/openviking/dist/style.css?inline";
import { PortalContainerContext } from "../../provider-ui/openviking/dist/shared.js";
import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Navigate, Route, Routes } from "react-router";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n/index";
import { componentStyles } from "./ui/styles";
import layout from "./app.css?inline";
import memoryStyles from "./memory/memory.css?inline";
import hindsightStyles from "./memory/hindsight/hindsight.css?inline";
import standalone from "./styles.css?inline";
import { MemoryPage } from "./memory/MemoryPage";
import { NativeWritesProvider } from "./memory/NativeWrites";
import type { MemoryBridge, MemoryProviderModule } from "./memory/contracts";
import { memoryRoutePattern } from "./memory/routes";


// Browsers do not consistently register @property rules inside shadow roots.
// Mirror Tailwind's non-inherited initial values in the base layer so native
// utilities work here exactly as they do in the standalone provider document.
const shadowPropertyDefaults = `@layer base { *, ::before, ::after { ${
  [...officialStyles.matchAll(/@property\s+(--tw-[\w-]+)\s*\{([^}]+)\}/g)]
    .filter(([, , body]) => /inherits\s*:\s*false/.test(body ?? ""))
    .flatMap(([, name, body]) => {
      const value = body?.match(/initial-value\s*:\s*([^;}]+)/)?.[1];
      return value ? [`${name}:${value};`] : [];
    }).join("\n")
} } }`;

export function MemorySurface({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { if (node) setRoot(node.shadowRoot ?? node.attachShadow({ mode: "open" })); }, []);
  return <div ref={attach} data-memory-console>{root && createPortal(<I18nextProvider i18n={i18n}>
    <style>{[officialStyles, shadowPropertyDefaults, componentStyles, layout, memoryStyles, hindsightStyles, standalone].join("\n")}</style><PortalContainerContext.Provider value={root as unknown as HTMLElement}>{children}</PortalContainerContext.Provider>
  </I18nextProvider>, root)}</div>;
}
export default function MemoryConsole({ memory, memoryModules, header, accountID }: { memory?: MemoryBridge; memoryModules?: readonly MemoryProviderModule[]; header?: ReactNode; accountID?: string }) {
  return <MemorySurface>{header}<NativeWritesProvider key={memory?.identity ?? "preview"}><Routes>
    <Route path={memoryRoutePattern} element={<MemoryPage bridge={memory} modules={memoryModules} />} />
    <Route path="/account/keys" element={<MemoryPage bridge={memory} modules={memoryModules} accountID={accountID} />} />
    <Route path="*" element={<Navigate to="/memory" replace />} />
  </Routes></NativeWritesProvider></MemorySurface>;
}
