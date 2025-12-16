import Link from "next/link";
import { cookies } from "next/headers";
import { api, ApiError } from "@/shared/api/client";
import { EmptyState } from "@/shared/ui/EmptyState";
import { ToastNote } from "@/shared/ui/ToastProvider";

type ListResponse = { items: { id: string; title: string; version: number; createdAt: string }[]; page: number; total: number };

export default async function ItinerariesPage({ searchParams }: { searchParams: { page?: string } }) {
  const token = cookies().get("shin_access_token")?.value;
  const page = searchParams?.page ? parseInt(searchParams.page, 10) || 1 : 1;

  if (!token) {
    return <p className="p-6 text-sm text-slate-600">一覧を取得するにはログインしてください。</p>;
  }

  let data: ListResponse | null = null;
  let error: ApiError | null = null;
  try {
    data = await api.listItineraries(page, { token, cookieToken: token });
  } catch (err) {
    error = err instanceof ApiError ? err : new ApiError({ status: 500, code: "UNKNOWN", message: "一覧取得に失敗しました" });
  }

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-xl font-bold">旅程一覧</h1>
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>一覧取得に失敗しました。</p>
          <p className="text-xs text-red-600">{error.code}: {error.message}</p>
          {error.correlationId && <ToastNote correlationId={error.correlationId} />}
        </div>
      </main>
    );
  }

  if (!data || !data.items.length) {
    return <EmptyState title="旅程がまだありません" description="トップページから旅程を作成してください" />;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-bold">旅程一覧</h1>
      <ul className="mt-4 divide-y rounded border">
        {data.items.map((itinerary) => (
          <li key={itinerary.id} className="p-3 hover:bg-slate-50">
            <Link href={`/itineraries/${itinerary.id}`} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{itinerary.title}</p>
                <p className="text-xs text-slate-500">version {itinerary.version}</p>
              </div>
              <span className="text-xs text-slate-500">{new Date(itinerary.createdAt).toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
      <nav className="mt-4 flex items-center justify-between text-sm">
        <Link
          className={`rounded border px-3 py-1 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          href={`/itineraries${page > 2 ? `?page=${page - 1}` : page === 2 ? "" : ""}`}
          aria-disabled={page <= 1}
        >
          前のページ
        </Link>
        <Link
          className={`rounded border px-3 py-1 ${data.items.length === 0 ? "pointer-events-none opacity-50" : ""}`}
          href={`/itineraries?page=${page + 1}`}
          aria-disabled={data.items.length === 0}
        >
          次のページ
        </Link>
      </nav>
    </main>
  );
}
