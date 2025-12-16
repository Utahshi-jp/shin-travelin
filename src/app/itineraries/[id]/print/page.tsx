import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/shared/api/client";
import { ToastNote } from "@/shared/ui/ToastProvider";

type PrintDto = { id: string; title: string; days: { date: string; activities: { time: string; location: string; content: string }[] }[] };

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 print:px-0">
      <h1 className="text-2xl font-bold print:text-center print:text-3xl">{data!.title}</h1>
      <section className="mt-4 space-y-4">
        {data!.days.map((day, idx) => (
          <div key={idx} className="rounded border p-3 print:break-inside-avoid print:border print:border-slate-200 print:p-4">
            <h2 className="font-semibold">{day.date}</h2>
            <ul className="mt-2 space-y-1">
              {day.activities.map((act, i) => (
                <li key={i} className="text-sm">
                  <span className="font-mono">{act.time}</span> {act.location} - {act.content}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
