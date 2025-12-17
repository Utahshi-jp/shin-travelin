import Link from "next/link";
import { cookies } from "next/headers";
import { api, ApiError, ItineraryListQuery } from "@/shared/api/client";
import { EmptyState } from "@/shared/ui/EmptyState";
import { ToastNote } from "@/shared/ui/ToastProvider";

type SearchParams = { page?: string; keyword?: string; startDate?: string; endDate?: string; purpose?: string };
type ListItem = {
  id: string;
  title: string;
  version: number;
  createdAt: string;
  firstDate: string | null;
  lastDate: string | null;
  purposes: string[];
};
type ListResponse = { items: ListItem[]; page: number; total: number; pageSize: number };

export default async function ItinerariesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const resolvedSearch = await searchParams;
  const token = (await cookies()).get("shin_access_token")?.value;
  const page = resolvedSearch?.page ? parseInt(resolvedSearch.page, 10) || 1 : 1;
  const keyword = resolvedSearch?.keyword?.trim() ?? "";
  const startDate = resolvedSearch?.startDate ?? "";
  const endDate = resolvedSearch?.endDate ?? "";
  const purpose = resolvedSearch?.purpose?.trim() ?? "";
  const filters: ItineraryListQuery = {
    page,
    keyword: keyword || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    purpose: purpose || undefined,
  };
  const hasFilters = Boolean(keyword || startDate || endDate || purpose);

  if (!token) {
    return <p className="p-6 text-sm text-slate-600">一覧を取得するにはログインしてください。</p>;
  }

  let data: ListResponse | null = null;
  let error: ApiError | null = null;
  try {
    data = await api.listItineraries(filters, { token, cookieToken: token });
  } catch (err) {
    error = err instanceof ApiError ? err : new ApiError({ status: 500, code: "UNKNOWN", message: "一覧取得に失敗しました" });
  }

  const baseFilterParams: Record<string, string | undefined> = {
    keyword: keyword || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    purpose: purpose || undefined,
  };
  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    Object.entries(baseFilterParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (targetPage > 1) params.set("page", String(targetPage));
    return params.size ? `/itineraries?${params.toString()}` : "/itineraries";
  };

  if (error) {
    const retryHref = buildPageHref(page);
    return (
      <main className="mx-auto max-w-4xl px-6 py-8" aria-live="polite">
        <h1 className="text-xl font-bold">旅程一覧</h1>
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          <p>一覧取得に失敗しました。</p>
          <p className="text-xs text-red-600">{error.code}: {error.message}</p>
          <div className="mt-3 flex gap-2">
            <Link href={retryHref} className="rounded border border-red-400 px-3 py-1 text-xs font-semibold text-red-700" prefetch={false}>
              再度取得する
            </Link>
            {hasFilters && (
              <Link href="/itineraries" className="rounded border px-3 py-1 text-xs" prefetch={false}>
                条件をクリア
              </Link>
            )}
          </div>
          {error.correlationId && <ToastNote correlationId={error.correlationId} />}
        </div>
      </main>
    );
  }

  if (!data || !data.items.length) {
    return (
      <EmptyState
        title={hasFilters ? "検索条件に一致する旅程が見つかりません" : "旅程がまだありません"}
        description={hasFilters ? "条件を調整するかクリアして再検索してください" : "トップページから旅程を作成してください"}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-bold">旅程一覧</h1>
      <form className="mt-4 grid gap-3 rounded border border-slate-200 bg-white p-4" method="get" aria-label="旅程の検索フォーム">
        <input type="hidden" name="page" value="1" />
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm font-medium">
            キーワード
            <input name="keyword" defaultValue={keyword} className="mt-1 w-full rounded border px-3 py-2" placeholder="タイトルで検索" />
          </label>
          <label className="text-sm font-medium">
            目的（purpose）
            <input name="purpose" defaultValue={purpose} className="mt-1 w-full rounded border px-3 py-2" placeholder="例: sightseeing" />
          </label>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm font-medium">
            開始日
            <input type="date" name="startDate" defaultValue={startDate} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="text-sm font-medium">
            終了日
            <input type="date" name="endDate" defaultValue={endDate} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            検索
          </button>
          {hasFilters && (
            <Link href="/itineraries" className="rounded border px-4 py-2 text-sm" prefetch={false}>
              条件をクリア
            </Link>
          )}
        </div>
      </form>
      <ul className="mt-4 divide-y rounded border">
        {data.items.map((itinerary) => (
          <li key={itinerary.id} className="p-3 hover:bg-slate-50">
            <Link href={`/itineraries/${itinerary.id}`} className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-medium">{itinerary.title}</p>
                <p className="text-xs text-slate-500">version {itinerary.version}</p>
                <p className="text-xs text-slate-500">
                  {itinerary.firstDate && itinerary.lastDate
                    ? `${new Date(itinerary.firstDate).toLocaleDateString()} - ${new Date(itinerary.lastDate).toLocaleDateString()}`
                    : "日付情報なし"}
                </p>
                {!!itinerary.purposes.length && (
                  <span className="flex flex-wrap gap-1">
                    {itinerary.purposes.map((purposeTag) => (
                      <span key={purposeTag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-600">
                        {purposeTag}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500">{new Date(itinerary.createdAt).toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
      <nav className="mt-4 flex items-center justify-between text-sm">
        <Link className={`rounded border px-3 py-1 ${hasPrev ? "" : "pointer-events-none opacity-50"}`} href={hasPrev ? buildPageHref(page - 1) : "#"} aria-disabled={!hasPrev} prefetch={false}>
          前のページ
        </Link>
        <p className="text-xs text-slate-500">
          {page} / {totalPages}
        </p>
        <Link className={`rounded border px-3 py-1 ${hasNext ? "" : "pointer-events-none opacity-50"}`} href={hasNext ? buildPageHref(page + 1) : "#"} aria-disabled={!hasNext} prefetch={false}>
          次のページ
        </Link>
      </nav>
    </main>
  );
}
