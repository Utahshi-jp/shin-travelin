import { ReactNode } from "react";

type Item = {
  label: string;
  value: ReactNode;
  hint?: string;
};

type KeyValueListProps = {
  items: Item[];
  columns?: 1 | 2;
  dense?: boolean;
};

export function KeyValueList({ items, columns = 2, dense = false }: KeyValueListProps) {
  const gridClass = columns === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2";
  const spacing = dense ? "gap-2" : "gap-4";
  return (
    <dl className={`grid ${gridClass} ${spacing}`}>
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className="text-sm font-semibold text-slate-900">{item.value}</dd>
          {item.hint && <p className="text-xs text-slate-500">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
