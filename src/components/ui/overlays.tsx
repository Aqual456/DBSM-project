"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { Button } from "./primitives";

/** Accessible modal/drawer: role=dialog, aria-modal, labelled, focus trapped, Escape closes, focus restored. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size,
  drawer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "wide" | "narrow";
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]), select, textarea, button:not([data-close])");
      (first ?? ref.current)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={`overlay ${drawer ? "drawer" : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.16 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={ref}
            className={`dialog ${size ?? ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={reduce ? false : drawer ? { x: 40, opacity: 0 } : { y: 12, scale: 0.98, opacity: 0 }}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : drawer ? { x: 40, opacity: 0 } : { y: 8, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="dialog-head">
              <div>
                <h2 id={titleId}>{title}</h2>
                {description && <p id={descId}>{description}</p>}
              </div>
              <Button variant="ghost" size="sm" iconOnly aria-label="Close dialog" data-close onClick={onClose} icon={<X size={16} />} />
            </div>
            <div className="dialog-body">{children}</div>
            {footer && <div className="dialog-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---- Toasts --------------------------------------------------------------------
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.18 }}>
              <span className="t-icon">{t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}</span>
              <span>{t.text}</span>
              <button aria-label="Dismiss notification" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---- Confirm -------------------------------------------------------------------
type ConfirmOpts = { title: string; text?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        size="narrow"
        title={state?.title ?? ""}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.danger ? "danger-solid" : "primary"} data-autofocus onClick={() => close(true)}>
              {state?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <div className="muted">{state?.text}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
