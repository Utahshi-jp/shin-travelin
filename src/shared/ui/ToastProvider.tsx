"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type Toast = {
  id: string;
  message: string;
  variant?: "info" | "error" | "success";
  correlationId?: string;
};

const ToastContext = createContext<{
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  remove: (id: string) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    setToasts((prev) => [...prev, { id: crypto.randomUUID(), ...toast }]);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toasts, push, remove }), [toasts, push, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProviderが必要です");
  return ctx;
}

// Simple display helper for SSRシナリオで相関IDを示すために利用。
export function ToastNote({ correlationId }: { correlationId: string }) {
  return <p className="text-[11px] text-slate-500">cid: {correlationId}</p>;
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded border px-3 py-2 text-sm shadow ${toast.variant === "error" ? "border-red-300 bg-red-50" : toast.variant === "success" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p>{toast.message}</p>
              {toast.correlationId && <p className="text-[11px] text-slate-500">cid: {toast.correlationId}</p>}
            </div>
            <button onClick={() => onDismiss(toast.id)} aria-label="閉じる" className="text-slate-500">
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
