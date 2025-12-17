import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/shared/api/client";
import { KeyValueList } from "@/shared/ui/KeyValueList";
import { ToastNote } from "@/shared/ui/ToastProvider";
import { PrintToolbar } from "./PrintToolbar";

type PrintDto = {
  id: string;
  title: string;
  days: { dayIndex: number; date: string; scenario: "SUNNY" | "RAINY"; activities: { time: string; location: string; content: string }[] }[];
};

export async function generateMetadata({ params }: { params: { id: string } }) {
  try {
    const token = (await cookies()).get("shin_access_token")?.value;
    if (!token) {
      return { title: "旅程印刷", openGraph: { title: "旅程印刷", description: "旅程の印刷ページ" } };
    }
    const printable = await api.getPrintable(params.id, { token, cookieToken: token });
    const url = `${process.env.NEXT_PUBLIC_APP_BASE_URL ?? "http://localhost:3000"}/itineraries/${params.id}/print`;
    return {
      title: `${printable.title} | 旅程印刷`,
      openGraph: {
        title: `${printable.title} | shin-travelin`,
        description: `${printable.title} の印刷ビュー`,
        url,
      },
    };
  } catch {
    return { title: "旅程印刷" };
  }
}

export default async function PrintPage({ params }: { params: { id: string } }) {
  const token = cookies().get("shin_access_token")?.value;
  if (!token) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <p className="font-semibold">印刷にはログインが必要です。</p>
          <p className="mt-1 text-xs text-slate-500">トップページでログイン／新規登録すると保存済みの旅程を印刷できます。</p>
          <div className="mt-4">
            <Link href="/" className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white" prefetch={false}>
              トップページへ戻る
            </Link>
          </div>
        </div>
      </main>
    );
  }

  let data: PrintDto | null = null;
  let error: ApiError | null = null;
  try {
    data = await api.getPrintable(params.id, { token, cookieToken: token });
  } catch (err) {
    error = err as ApiError;
  }

  if (error?.status === 404) notFound();

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 print:px-0">
        <h1 className="text-2xl font-bold">旅程印刷</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>印刷用データの取得に失敗しました。</p>
          <p className="text-xs text-red-600">{error.code}: {error.message}</p>
          {error.correlationId && <ToastNote correlationId={error.correlationId} />}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href={`/itineraries/${params.id}`} className="rounded-full border border-red-300 px-3 py-1" prefetch={false}>
              詳細へ戻る
            </Link>
            <Link href="/itineraries" className="rounded-full border px-3 py-1" prefetch={false}>
              一覧を開く
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!data) notFound();

  const grouped = data!.days.reduce<Record<number, PrintDto["days"]>>((acc, day) => {
    const bucket = acc[day.dayIndex] ?? [];
    bucket.push(day);
    acc[day.dayIndex] = bucket.sort((a, b) => (a.scenario > b.scenario ? 1 : -1));
    return acc;
  }, {});
  const summary = buildPrintSummary(data!.days);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 print:px-6">
      <header className="space-y-4 border-b border-slate-200 pb-6 print:border-none">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PRINT SHEET</p>
        <h1 className="text-3xl font-semibold text-slate-900 print:text-center">{data!.title}</h1>
        <KeyValueList
          columns={2}
          items={[
            { label: "日数", value: `${summary.dayCount} 日`, hint: "晴天/悪天候ペアを1日として計算" },
            { label: "期間", value: summary.dateRange ?? "日付未設定" },
            { label: "総アクティビティ", value: `${summary.activityCount} 件` },
            { label: "印刷時刻", value: summary.generatedAt },
          ]}
        />
        <PrintToolbar />
      </header>

      <section className="mt-6 space-y-5 print:space-y-3">
        {Object.entries(grouped)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([dayIndex, variants]) => (
            <article
              key={dayIndex}
              className="rounded-2xl border border-slate-200 bg-white p-4 print:break-inside-avoid print:border-slate-100"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Day {Number(dayIndex) + 1}</h2>
                  <p className="text-xs text-slate-500">{formatDate(variants[0]?.date)}</p>
                </div>
                <div className="flex gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">晴天</span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">悪天候</span>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {variants.map((variant, i) => (
                  <div key={`${variant.scenario}-${i}`} className="rounded-2xl border border-dashed border-slate-300 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {variant.scenario === "RAINY" ? "悪天候プラン" : "晴天プラン"} / {formatDate(variant.date)}
                    </p>
                    <table className="mt-2 w-full text-sm">
                      <tbody>
                        {variant.activities.map((act, idx) => (
                          <tr key={idx} className="align-top">
                            <td className="w-16 px-1 py-1 font-mono text-xs text-slate-500">{act.time}</td>
                            <td className="px-1 py-1 font-semibold text-slate-800">{act.location || "場所未設定"}</td>
                            <td className="px-1 py-1 text-xs text-slate-600">{act.content || "内容未設定"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </article>
          ))}
      </section>
    </main>
  );
}

function buildPrintSummary(days: PrintDto["days"]) {
  const uniqueDays = new Set(days.map((day) => day.dayIndex)).size;
  const activityCount = days.reduce((sum, day) => sum + day.activities.length, 0);
  const dateRange = resolveDateRange(days.map((day) => day.date));
  return {
    dayCount: uniqueDays,
    activityCount,
    dateRange,
    generatedAt: new Date().toLocaleString("ja-JP"),
  };
}

function resolveDateRange(dates: string[]) {
  const valid = dates.filter(Boolean);
  if (!valid.length) return null;
  const sorted = valid.map((date) => new Date(date)).sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  const firstLabel = first.toLocaleDateString("ja-JP");
  const lastLabel = last.toLocaleDateString("ja-JP");
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
}

function formatDate(value?: string) {
  if (!value) return "日付未設定";
  return new Date(value).toLocaleDateString("ja-JP");
}
