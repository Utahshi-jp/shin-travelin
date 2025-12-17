import { ComponentPropsWithoutRef, ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: "default" | "muted" | "brand";
  className?: string;
  as?: "section" | "div" | "fieldset" | "form";
} & Pick<ComponentPropsWithoutRef<"section">, "id" | "aria-labelledby">;

const toneClass: Record<NonNullable<SectionCardProps["tone"]>, string> = {
  default: "border-slate-200 bg-white",
  muted: "border-slate-100 bg-slate-50",
  brand: "border-blue-200 bg-blue-50",
};

export function SectionCard({ title, description, actions, children, tone = "default", className = "", as = "section", ...rest }: SectionCardProps) {
  const Component = as;
  return (
    <Component
      className={`rounded-2xl border p-5 shadow-sm ${toneClass[tone]} ${className}`.trim()}
      {...rest}
    >
      {(title || description || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <p className="text-base font-semibold text-slate-900">{title}</p>}
            {description && <p className="text-sm text-slate-600">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2 text-sm">{actions}</div>}
        </header>
      )}
      <div className={title || description || actions ? "mt-4" : ""}>{children}</div>
    </Component>
  );
}
