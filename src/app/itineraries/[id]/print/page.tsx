import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/shared/api/client";
import { ToastNote } from "@/shared/ui/ToastProvider";

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
    return <p className="p-6 text-sm text-slate-600">印刷にはログインが必要です。</p>;
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
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>印刷用データの取得に失敗しました。</p>
          <p className="text-xs text-red-600">{error.code}: {error.message}</p>
          {error.correlationId && <ToastNote correlationId={error.correlationId} />}
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 print:px-0">
      <h1 className="text-2xl font-bold print:text-center print:text-3xl">{data!.title}</h1>
      <section className="mt-4 space-y-4">
        {Object.entries(grouped)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([dayIndex, variants]) => (
            <div key={dayIndex} className="rounded border p-3 print:break-inside-avoid print:border print:border-slate-200 print:p-4">
              <h2 className="font-semibold">Day {Number(dayIndex) + 1}</h2>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                {variants.map((variant, i) => (
                  <div key={`${variant.scenario}-${i}`} className="rounded border border-dashed border-slate-300 p-2">
                    <p className="text-xs font-semibold text-slate-600">
                      {variant.scenario === "RAINY" ? "悪天候プラン" : "晴天プラン"} / {new Date(variant.date).toLocaleDateString("ja-JP")}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {variant.activities.map((act, idx) => (
                        <li key={idx} className="text-sm">
                          <span className="font-mono">{act.time}</span> {act.location} - {act.content}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </section>
    </main>
  );
}
