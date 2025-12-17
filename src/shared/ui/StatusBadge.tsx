import { ReactNode } from "react";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "critical";
  icon?: ReactNode;
  className?: string;
};

const toneToClass: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  neutral: "bg-slate-100 text-slate-700",
  positive: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-700",
};

export function StatusBadge({ children, tone = "neutral", icon, className = "" }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneToClass[tone]} ${className}`.trim()}>
      {icon}
      {children}
    </span>
  );
}
