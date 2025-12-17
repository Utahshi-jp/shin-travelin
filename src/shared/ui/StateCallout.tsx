import { ReactNode } from "react";

type StateCalloutProps = {
  title: string;
  description?: ReactNode;
  variant?: "info" | "success" | "warning" | "error";
  actions?: ReactNode;
};

const baseClass = "rounded-xl border p-4 text-sm";
const variantClass: Record<NonNullable<StateCalloutProps["variant"]>, { wrapper: string; title: string; body: string }> = {
  info: { wrapper: `${baseClass} border-slate-200 bg-slate-50`, title: "text-slate-900", body: "text-slate-600" },
  success: { wrapper: `${baseClass} border-emerald-200 bg-emerald-50`, title: "text-emerald-900", body: "text-emerald-800" },
  warning: { wrapper: `${baseClass} border-amber-200 bg-amber-50`, title: "text-amber-900", body: "text-amber-800" },
  error: { wrapper: `${baseClass} border-red-200 bg-red-50`, title: "text-red-900", body: "text-red-800" },
};

export function StateCallout({ title, description, variant = "info", actions }: StateCalloutProps) {
  const tone = variantClass[variant];
  return (
    <div className={tone.wrapper} role="status" aria-live="polite">
      <p className={`font-semibold ${tone.title}`}>{title}</p>
      {description && <div className={`mt-1 text-xs ${tone.body}`}>{description}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">{actions}</div>}
    </div>
  );
}
