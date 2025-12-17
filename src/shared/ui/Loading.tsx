export function Loading({ label = "読み込み中..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600" role="status" aria-live="polite">
      <span className="relative inline-flex h-5 w-5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-300 opacity-75" />
        <span className="relative inline-flex h-5 w-5 rounded-full bg-blue-500" />
      </span>
      <span>{label}</span>
    </div>
  );
}
