import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Menu, X } from "lucide-react";
import { IconButton } from "./ui/index";

export function MemoryFrame({ navigationContent, children }: { navigationContent?: (close: () => void) => ReactNode; children: ReactNode }) {
  const { t } = useTranslation(), location = useLocation();
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <div className="app-shell memory-shell">
    <div className="memory-menu-toggle"><IconButton label={t("nav.mobile")} onClick={() => setOpen(true)}><Menu size={20} /></IconButton></div>
    <aside className="sidebar safe-left"><nav aria-label={t("nav.label")}>{navigationContent?.(() => setOpen(false))}</nav></aside>
    <main id="main-content" tabIndex={-1} className="main-content safe-bottom safe-right">{children}</main>
    <dialog ref={dialog} className="mobile-navigation" aria-label={t("nav.label")} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
      <div className="mobile-nav-heading"><strong>Memory</strong><IconButton label={t("nav.closeMobile")} onClick={() => setOpen(false)}><X size={20} /></IconButton></div>
      {navigationContent?.(() => setOpen(false))}
    </dialog>
  </div>;
}
