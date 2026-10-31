import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { X, Search, Inbox, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
export function Button({
  variant = "default",
  size = "md",
  icon,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "text" | "link" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ifd-button ifd-button--${variant} ifd-button--${size} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "default" | "primary" | "text" | "link" | "danger";
}) {
  return (
    <Button
      aria-label={label}
      title={label}
      {...props}
      className={`ifd-icon-button ${props.className || ""}`}
    >
      {children}
    </Button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  return <span className={`ifd-badge ifd-badge--${tone}`}>{children}</span>;
}
export function Card({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ifd-card ${className}`} {...props}>
      {children}
    </div>
  );
}
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input className={`ifd-input ${className}`} {...props} />;
}
// PR #1380's textarea styles are exposed as a component so forms share them.
export function Textarea({
  className = "",
  variant = "default",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { variant?: "default" | "plain"; ref?: React.Ref<HTMLTextAreaElement> }) {
  return <textarea className={`ifd-input ifd-textarea ${variant === "plain" ? "ifd-textarea--plain" : ""} ${className}`} {...props} />;
}
export function SearchInput(props: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  const { t } = useTranslation();
  return (
    <div className="ifd-search">
      <Search size={16} />
      <Input aria-label={t("common.search")} {...props} />
    </div>
  );
}
export function Select({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly (string | { value: string; label: string })[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="ifd-select">
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option
            key={typeof o === "string" ? o : o.value}
            value={typeof o === "string" ? o : o.value}
          >
            {typeof o === "string" ? o : o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="ifd-field">
      <span>
        {required && <b className="ifd-required">*</b>}
        {label}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (s: string) => void;
  label: string;
}) {
  return (
    <div className="ifd-tabs" role="group" aria-label={label}>
      {items.map((s, i) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          className={value === s.value ? "is-active" : ""}
          onClick={() => onChange(s.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const n =
                (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) %
                items.length;
              const next = items[n];
              if (!next) return;
              onChange(next.value);
              (e.currentTarget.parentNode?.children[n] as HTMLElement).focus();
            }
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`ifd-switch ${checked ? "is-checked" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="ifd-empty">
      <div className="ifd-empty-icon">
        <Inbox size={36} />
      </div>
      <strong>{title || t("common.empty")}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Modal({
  className = "",
  open,
  onClose,
  title,
  children,
  footer,
}: {
  className?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useTranslation();
  useEffect(() => {
    const dialog = ref.current;
    const owner = dialog?.getRootNode() as Document | ShadowRoot | undefined;
    const prev = owner?.activeElement as HTMLElement | null;
    if (open) dialog?.showModal();
    else dialog?.close();
    return () => {
      if (open) {
        dialog?.close();
        if (prev?.isConnected) prev.focus();
      }
    };
  }, [open]);
  return (
    <dialog
      className={`ifd-modal ${className}`}
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <IconButton label={t("common.close")} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      <div className="ifd-modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
export function Toast({ message, variant = "success", onClose }: { message: string; variant?: "success" | "error"; onClose?: () => void }) {
  const { t } = useTranslation();
  return message ? (
    <div className={`ifd-toast ifd-toast-${variant}`} role={variant === "error" ? "alert" : "status"}>
      {variant === "error" ? <X size={17} /> : <Check size={17} />}
      <span>{message}</span>
      {onClose && <IconButton label={t("common.close")} onClick={onClose}><X size={17} /></IconButton>}
    </div>
  ) : null;
}
export function Table({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="ifd-table-wrap">
      <table className="ifd-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <EmptyState />}
    </div>
  );
}
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="ifd-section-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="ifd-actions">{actions}</div>
    </div>
  );
}
