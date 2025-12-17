"use client";

export function PrintToolbar() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm print:hidden">
      <button
        type="button"
        onClick={handlePrint}
        className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
      >
        この画面を印刷する
      </button>
      <p className="text-xs text-slate-500">印刷後もURLを共有すると最新データにアクセスできます。</p>
    </div>
  );
}
