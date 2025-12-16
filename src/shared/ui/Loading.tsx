export function Loading({ label = "読み込み中..." }: { label?: string }) {
  return <p className="text-sm text-slate-600" aria-busy="true">{label}</p>;
}
