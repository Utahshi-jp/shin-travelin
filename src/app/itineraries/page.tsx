import Link from "next/link";
import { cookies } from "next/headers";
import { api, ApiError, ItineraryListQuery } from "@/shared/api/client";
import { EmptyState } from "@/shared/ui/EmptyState";
import { SectionCard } from "@/shared/ui/SectionCard";
import { StateCallout } from "@/shared/ui/StateCallout";
import { StatusBadge } from "@/shared/ui/StatusBadge";
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
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <SectionCard tone="muted" title="旅程一覧を表示するにはログインが必要です" description="保存した旅程と生成履歴はログイン後に自動で読み込まれます。">
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/" className="rounded-full bg-blue-600 px-4 py-2 font-semibold text-white" prefetch={false}>
              トップへ戻る
            </Link>
            <p className="text-xs text-slate-600">トップページからログインまたは新規登録を行ってください。</p>
          </div>
        </SectionCard>
      </main>
    );
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
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8" aria-live="polite">
        <div>
          <h1 className="text-2xl font-semibold">旅程一覧</h1>
          <p className="text-sm text-slate-600">保存済みの旅程を取得できませんでした。下記のアクションをお試しください。</p>
        </div>
        <StateCallout
          variant="error"
          title="一覧取得に失敗しました"
          description={(
            <div className="space-y-1 text-xs">
              <p>{error.code}: {error.message}</p>
              {error.correlationId && <ToastNote correlationId={error.correlationId} />}
            </div>
          )}
          actions={(
            <>
              <Link href={retryHref} className="rounded-full border border-red-400 px-3 py-1 text-xs font-semibold text-red-700" prefetch={false}>
                再度取得する
              </Link>
              {hasFilters && (
                <Link href="/itineraries" className="rounded-full border px-3 py-1 text-xs" prefetch={false}>
                  条件をクリア
                </Link>
              )}
            </>
          )}
        />
      </main>
    );
  }

  if (!data || !data.items.length) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold">旅程一覧</h1>
          <p className="text-sm text-slate-600">まだ旅程が保存されていません。生成フォームから新規作成できます。</p>
        </div>
        <SectionCard tone="muted" title={hasFilters ? "条件に一致する旅程がありません" : "旅程がまだありません"} description={hasFilters ? "条件を見直すかリセットして再検索してください。" : "トップページで旅程生成フォームを送信するとここに保存されます。"}>
          <EmptyState
            title={hasFilters ? "検索条件に一致する旅程が見つかりません" : "旅程がまだありません"}
            description={hasFilters ? "条件を調整するかクリアして再検索してください" : "トップページから旅程を作成してください"}
          />
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {hasFilters && (
              <Link href="/itineraries" className="rounded-full border px-4 py-2" prefetch={false}>
                条件をクリア
              </Link>
            )}
            <Link href="/" className="rounded-full bg-blue-600 px-4 py-2 font-semibold text-white" prefetch={false}>
              旅程を作成する
            </Link>
          </div>
        </SectionCard>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">旅程一覧</h1>
        <p className="text-sm text-slate-600">日付・目的・最近の更新を一覧で確認できます。カード全体がクリック可能です。</p>
      </header>

      <SectionCard as="form" method="get" aria-label="旅程の検索フォーム" className="border-slate-200" title="検索とフィルタ" description="条件を入力すると即座に一覧が絞り込まれます。">
        <input type="hidden" name="page" value="1" />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            キーワード
            <input name="keyword" defaultValue={keyword} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="タイトルで検索" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            目的（purpose）
            <input name="purpose" defaultValue={purpose} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="例: sightseeing" />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            開始日
            <input type="date" name="startDate" defaultValue={startDate} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            終了日
            <input type="date" name="endDate" defaultValue={endDate} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            検索
          </button>
          {hasFilters && (
            <Link href="/itineraries" className="rounded-full border px-4 py-2 text-sm" prefetch={false}>
              条件をクリア
            </Link>
          )}
        </div>
      </SectionCard>

      {hasFilters && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          {keyword && <StatusBadge tone="neutral">キーワード: {keyword}</StatusBadge>}
          {purpose && <StatusBadge tone="neutral">目的: {purpose}</StatusBadge>}
          {startDate && <StatusBadge tone="neutral">開始: {new Date(startDate).toLocaleDateString()}</StatusBadge>}
          {endDate && <StatusBadge tone="neutral">終了: {new Date(endDate).toLocaleDateString()}</StatusBadge>}
        </div>
      )}

      <SectionCard title="保存済みの旅程" description={`全 ${data.total} 件`}>
        <ul className="space-y-3">
          {data.items.map((itinerary) => {
            const hasDate = itinerary.firstDate && itinerary.lastDate;
            const rangeLabel = hasDate
              ? `${new Date(itinerary.firstDate as string).toLocaleDateString()} - ${new Date(itinerary.lastDate as string).toLocaleDateString()}`
              : "日付未設定";
            const statusTone = hasDate ? "positive" : "warning";
            const statusLabel = hasDate ? "日程確定" : "日程調整中";
            return (
              <li key={itinerary.id}>
                <Link
                  href={`/itineraries/${itinerary.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm transition hover:border-blue-200 hover:shadow"
                  prefetch={false}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{itinerary.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <StatusBadge tone={statusTone as "positive" | "warning"}>{statusLabel}</StatusBadge>
                        <span>version {itinerary.version}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>保存日時</p>
                      <p className="font-mono">{new Date(itinerary.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-500">期間</p>
                      <p>{rangeLabel}</p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-500">目的</p>
                      <p>{itinerary.purposes.length ? itinerary.purposes.slice(0, 2).join(", ") : "未設定"}</p>
                    </div>
                  </div>
                  {!!itinerary.purposes.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {itinerary.purposes.map((purposeTag) => (
                        <span key={purposeTag} className="rounded-full bg-slate-100 px-3 py-0.5 text-[11px] uppercase tracking-wide text-slate-600">
                          {purposeTag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <nav className="mt-5 flex items-center justify-between text-sm">
          <Link className={`rounded-full border px-3 py-1 ${hasPrev ? "" : "pointer-events-none opacity-50"}`} href={hasPrev ? buildPageHref(page - 1) : "#"} aria-disabled={!hasPrev} prefetch={false}>
            前のページ
          </Link>
          <p className="text-xs text-slate-500">
            {page} / {totalPages}
          </p>
          <Link className={`rounded-full border px-3 py-1 ${hasNext ? "" : "pointer-events-none opacity-50"}`} href={hasNext ? buildPageHref(page + 1) : "#"} aria-disabled={!hasNext} prefetch={false}>
            次のページ
          </Link>
        </nav>
      </SectionCard>
    </main>
  );
}
