"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, ScenarioSelector } from "@/shared/api/client";
import { KeyValueList } from "@/shared/ui/KeyValueList";
import { Loading } from "@/shared/ui/Loading";
import { SectionCard } from "@/shared/ui/SectionCard";
import { StateCallout } from "@/shared/ui/StateCallout";
import { useToast } from "@/shared/ui/ToastProvider";
import { ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import { ItineraryEditor } from "./ItineraryEditor";

const POLL_SCHEDULE_MS = [2000, 4000, 8000];
const POLL_TIMEOUT_MS = 120_000;

const CATEGORY_LABELS: Record<string, string> = {
  FOOD: "グルメ",
  SIGHTSEEING: "観光",
  MOVE: "移動",
  REST: "休憩",
  STAY: "宿泊",
  SHOPPING: "買い物",
  OTHER: "その他",
};

const CATEGORY_BADGES: Record<string, string> = {
  FOOD: "border-rose-200 bg-rose-50 text-rose-700",
  SIGHTSEEING: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MOVE: "border-slate-200 bg-slate-50 text-slate-600",
  REST: "border-amber-200 bg-amber-50 text-amber-800",
  STAY: "border-indigo-200 bg-indigo-50 text-indigo-700",
  SHOPPING: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  OTHER: "border-gray-200 bg-gray-50 text-gray-600",
};

type Props = {
  id: string;
  jobId?: string;
  initialItinerary: ItineraryFormValues | null;
};

type JobState = {
  status: string;
  jobId: string;
  attempts: number;
  message?: string | null;
  partialDays: number[];
};

type Highlights = {
  pending: number[];
  completed: number[];
  failed: number[];
};

export function ItineraryDetailClient({ id, jobId, initialItinerary }: Props) {
  const { push } = useToast();
  const router = useRouter();
  const [itinerary, setItinerary] = useState<ItineraryFormValues | null>(() => sanitizeItinerary(initialItinerary));
  const [activeJobId, setActiveJobId] = useState<string | null>(jobId ?? null);
  const [jobState, setJobState] = useState<JobState | null>(jobId ? { status: "queued", jobId, attempts: 0, partialDays: [] } : null);
  const [isReloading, setIsReloading] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [pendingDays, setPendingDays] = useState<number[]>([]);
  const [highlights, setHighlights] = useState<Highlights>({ pending: [], completed: [], failed: [] });
  const [scenarioMode, setScenarioMode] = useState<ScenarioSelector>("BOTH");
  useEffect(() => {
    setItinerary(sanitizeItinerary(initialItinerary));
  }, [initialItinerary]);
  const hasActivities = itinerary?.days?.some((day) => day.activities && day.activities.length > 0) ?? false;
  const isPlanEmpty = Boolean(itinerary && itinerary.days.length > 0 && !hasActivities);
  const scenarioMatrixDays = useMemo(() => buildScenarioMatrix(itinerary), [itinerary]);

  const reloadLatest = useCallback(async () => {
    setIsReloading(true);
    try {
      const latest = (await api.getItinerary(id)) as ItineraryFormValues;
      const sanitized = sanitizeItinerary(latest);
      setItinerary(sanitized);
      router.refresh();
      return sanitized;
    } catch (err) {
      const apiErr = err as ApiError;
      push({ message: `再取得に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
      return null;
    } finally {
      setIsReloading(false);
    }
  }, [id, push, router]);

  const dayOptions = useMemo(() => {
    if (!itinerary) return [] as { dayIndex: number; date: string }[];
    const map = new Map<number, string>();
    itinerary.days.forEach((day) => {
      if (!map.has(day.dayIndex)) map.set(day.dayIndex, day.date);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dayIndex, date]) => ({ dayIndex, date }));
  }, [itinerary]);

  useEffect(() => {
    setSelectedDays((current) => current.filter((index) => dayOptions.some((day) => day.dayIndex === index)));
  }, [dayOptions]);

  useEffect(() => {
    if (!activeJobId) return () => undefined;
    let cancelled = false;
    let timeout: NodeJS.Timeout | undefined;
    let attempts = 0;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled || !activeJobId) return;
      attempts += 1;
      try {
        const res = await api.getJobStatus(activeJobId);
        const nextState: JobState = {
          status: res.status,
          jobId: activeJobId,
          attempts,
          message: res.error,
          partialDays: res.partialDays ?? [],
        };
        setJobState(nextState);

        const normalized = res.status.toLowerCase();
        const isSuccess = normalized === "succeeded" || normalized === "completed";
        const isFailed = normalized === "failed";

        if (isSuccess) {
          const completed = nextState.partialDays.length ? nextState.partialDays : pendingDays;
          const failed = pendingDays.filter((day) => !nextState.partialDays.includes(day));
          setHighlights({ pending: [], completed, failed });
          setPendingDays([]);
          await reloadLatest();
          setActiveJobId(null);
          return;
        }

        if (isFailed) {
          const failedTargets = pendingDays.length ? pendingDays : nextState.partialDays;
          setHighlights({ pending: [], completed: [], failed: failedTargets });
          setPendingDays([]);
          setActiveJobId(null);
          return;
        }

        const elapsed = Date.now() - startedAt;
        if (elapsed >= POLL_TIMEOUT_MS) {
          push({ message: "生成ジョブがタイムアウトしました", variant: "error" });
          setActiveJobId(null);
          return;
        }

        const delay = POLL_SCHEDULE_MS[Math.min(attempts - 1, POLL_SCHEDULE_MS.length - 1)];
        timeout = setTimeout(poll, delay);
      } catch (err) {
        const apiErr = err as ApiError;
        push({ message: `ジョブ確認に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
        setActiveJobId(null);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [activeJobId, pendingDays, reloadLatest, push]);

  const jobLabel = useMemo(() => {
    if (!jobState) return null;
    const normalized = jobState.status.toLowerCase();
    if (normalized === "succeeded" || normalized === "completed") {
      if (jobState.message === "AI_PARTIAL_SUCCESS") return "一部のみ成功しました。未生成日は黄色で表示しています。";
      return "生成が完了しました。最新の旅程を表示しています。";
    }
    if (normalized === "failed") return jobState.message ?? "生成に失敗しました";
    if (normalized === "queued") return "生成待機中です";
    if (normalized === "running") return `生成中... (試行 ${jobState.attempts})`;
    return jobState.message ?? jobState.status;
  }, [jobState]);

  const toggleDay = (dayIndex: number) => {
    setSelectedDays((current) =>
      current.includes(dayIndex) ? current.filter((value) => value !== dayIndex) : [...current, dayIndex].sort((a, b) => a - b),
    );
  };

  const handleRegenerate = async (overrideDays?: number[]) => {
    const targetDays = overrideDays ?? selectedDays;
    if (!targetDays.length) return;
    setIsRegenerating(true);
    try {
      const sortedTargets = [...targetDays].sort((a, b) => a - b);
      const { jobId: nextJobId } = await api.regenerateItinerary(id, { days: sortedTargets, scenario: scenarioMode });
      setActiveJobId(nextJobId);
      setJobState({ status: "queued", jobId: nextJobId, attempts: 0, partialDays: [] });
      setPendingDays(sortedTargets);
      setHighlights({ pending: sortedTargets, completed: [], failed: [] });
      push({ message: "部分再生成を開始しました", variant: "success" });
    } catch (err) {
      const apiErr = err as ApiError;
      push({ message: `再生成に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRegenerateAll = async () => {
    if (!dayOptions.length) return;
    const allDays = dayOptions.map((day) => day.dayIndex);
    setSelectedDays(allDays);
    await handleRegenerate(allDays);
  };

  const summary = useMemo(() => buildSummary(itinerary), [itinerary]);
  const jobVariant = resolveJobVariant(jobState?.status ?? null);

  if (!itinerary) {
    return (
      <section className="mt-4 space-y-3">
        {jobLabel && (
          <StateCallout
            variant={jobVariant}
            title="生成ステータス"
            description={(
              <p className="text-xs text-slate-600">
                {jobLabel}
                {jobState?.jobId && <span className="block">jobId: {jobState.jobId}</span>}
              </p>
            )}
          />
        )}
        <SectionCard tone="muted" title="旅程を取得しています">
          <Loading label="旅程を取得しています" />
        </SectionCard>
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-4">
      <SectionCard tone="muted" title={summary?.title ?? "旅程情報"} description="全体像 → 日別 → スポットの順で把握できます。">
        {summary ? (
          <KeyValueList items={summary.items} columns={2} />
        ) : (
          <Loading label="旅程を取得しています" />
        )}
      </SectionCard>

      {jobLabel && (
        <StateCallout
          variant={jobVariant}
          title="生成ステータス"
          description={(
            <div className="space-y-1 text-xs text-slate-600">
              <p>{jobLabel}</p>
              {jobState?.jobId && <p className="font-mono">jobId: {jobState.jobId}</p>}
            </div>
          )}
        />
      )}

      {isPlanEmpty && (
        <StateCallout
          variant="warning"
          title="アクティビティが空の状態です"
          description="全日または一部の日でAIの応答が未完了です。再生成または再取得を試してください。"
          actions={(
            <button
              type="button"
              className="rounded-full border border-amber-400 px-3 py-1 text-xs font-semibold text-amber-900"
              onClick={handleRegenerateAll}
              disabled={!!activeJobId || isRegenerating || !dayOptions.length}
            >
              全日を再生成
            </button>
          )}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <SectionCard title="部分再生成" description="生成済みの日を複数選択して再キックできます。">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
            <StatusLegend color="bg-emerald-500" label="成功" />
            <StatusLegend color="bg-amber-500" label="生成中" />
            <StatusLegend color="bg-red-400" label="要再生成" />
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-600">
            <label className="font-semibold" htmlFor="scenario-mode">
              天候シナリオ
            </label>
            <select
              id="scenario-mode"
              value={scenarioMode}
              disabled={!!activeJobId || isRegenerating}
              onChange={(event) => setScenarioMode(event.target.value as ScenarioSelector)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="BOTH">晴天+悪天候を再生成</option>
              <option value="SUNNY">晴天プランのみ再生成</option>
              <option value="RAINY">悪天候プランのみ再生成</option>
            </select>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {dayOptions.map((day) => (
              <label key={day.dayIndex} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedDays.includes(day.dayIndex)}
                  disabled={!!activeJobId || isRegenerating}
                  onChange={() => toggleDay(day.dayIndex)}
                />
                <span>
                  Day {day.dayIndex + 1} ({new Date(day.date).toLocaleDateString("ja-JP")})
                </span>
              </label>
            ))}
            {!dayOptions.length && <p className="text-sm text-slate-500">再生成できる日がありません。</p>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelectedDays(dayOptions.map((day) => day.dayIndex))}
              className="rounded-full border px-3 py-1"
              disabled={!dayOptions.length || !!activeJobId || isRegenerating}
            >
              全選択
            </button>
            <button type="button" onClick={() => setSelectedDays([])} className="rounded-full border px-3 py-1" disabled={!selectedDays.length}>
              クリア
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleRegenerate()}
            disabled={!selectedDays.length || !!activeJobId || isRegenerating}
            className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            選択した日を再生成
          </button>
        </SectionCard>

        <SectionCard
          tone="muted"
          title="保存済みの旅程"
          description="生成したスケジュールはいつでも開き直せます。"
        >
          <p className="text-sm text-slate-600">
            保存済みの旅程は一覧ページにまとまり、過去のドラフトもすぐ取り出せます。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={reloadLatest} disabled={isReloading} className="rounded-full border px-3 py-1 disabled:opacity-60">
              最新を再取得
            </button>
            <button
              type="button"
              onClick={handleRegenerateAll}
              className="rounded-full border px-3 py-1"
              disabled={!!activeJobId || isRegenerating || !dayOptions.length}
            >
              全日を再生成
            </button>
            <Link
              href="/itineraries"
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              保存済み旅程を開く
            </Link>
          </div>
        </SectionCard>
      </div>

      {scenarioMatrixDays.length > 0 && (
        <SectionCard title="天候別タイムライン" description="晴天・悪天候プランを同時間帯で比較できます。">
          <ScenarioMatrix days={scenarioMatrixDays} />
        </SectionCard>
      )}

      <ItineraryEditor itinerary={itinerary} onReloadLatest={reloadLatest} highlights={highlights} />
    </section>
  );
}

type ScenarioMatrixActivity = ItineraryFormValues["days"][number]["activities"][number];

type ScenarioMatrixSlot = {
  time: string;
  sunny?: ScenarioMatrixActivity;
  rainy?: ScenarioMatrixActivity;
};

type ScenarioMatrixDay = {
  dayIndex: number;
  date: string;
  slots: ScenarioMatrixSlot[];
};

type ItinerarySummarySource = ItineraryFormValues & { updatedAt?: string | Date };

function hasUpdatedAt(source: ItineraryFormValues): source is ItinerarySummarySource {
  return Object.prototype.hasOwnProperty.call(source, "updatedAt");
}

function ScenarioMatrix({ days }: { days: ScenarioMatrixDay[] }) {
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <article key={`matrix-${day.dayIndex}`} className="rounded-2xl border border-slate-100 p-3">
          <div className="flex flex-wrap items-center justify-between text-sm">
            <p className="font-semibold">Day {day.dayIndex + 1}</p>
            <p className="text-slate-600">{new Date(day.date).toLocaleDateString("ja-JP")}</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="w-24 px-2 py-1 font-medium">時間帯</th>
                  <th className="px-2 py-1 font-medium">晴天プラン</th>
                  <th className="px-2 py-1 font-medium">悪天候プラン</th>
                </tr>
              </thead>
              <tbody>
                {day.slots.map((slot, idx) => (
                  <tr key={`${day.dayIndex}-${slot.time}-${idx}`} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 font-mono text-xs text-slate-600">{slot.time}</td>
                    <td className="px-2 py-2">
                      <ScenarioCell activity={slot.sunny} emptyLabel="晴天プランが未生成です" />
                    </td>
                    <td className="px-2 py-2">
                      <ScenarioCell activity={slot.rainy} emptyLabel="悪天候プランが未生成です" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}

function ScenarioCell({ activity, emptyLabel }: { activity?: ScenarioMatrixActivity; emptyLabel: string }) {
  if (!activity) {
    return <p className="text-xs text-slate-400">{emptyLabel}</p>;
  }
  const badgeClass = resolveCategoryBadge(activity.category);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/70 p-3 text-xs shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{activity.area || "エリア未設定"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${badgeClass}`}>
          {CATEGORY_LABELS[activity.category ?? "OTHER"] ?? "その他"}
        </span>
        {activity.placeName && <span className="text-[11px] text-slate-600">{activity.placeName}</span>}
        {activity.stayMinutes ? <span className="text-[11px] text-slate-500">{formatStayDuration(activity.stayMinutes)}</span> : null}
      </div>
      <p className="mt-1 text-slate-600">{activity.description || "内容未設定"}</p>
    </div>
  );
}

function StatusLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function resolveCategoryBadge(category?: string | null) {
  if (!category) return CATEGORY_BADGES.OTHER;
  return CATEGORY_BADGES[category] ?? CATEGORY_BADGES.OTHER;
}

function formatStayDuration(minutes?: number | null) {
  if (!minutes || minutes <= 0) return "";
  if (minutes < 60) return `${minutes}分滞在`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) {
    return `${hours}時間滞在`;
  }
  return `約${minutes}分滞在`;
}

function buildSummary(itinerary: ItineraryFormValues | null) {
  if (!itinerary) return null;
  const uniqueDays = Array.from(new Set(itinerary.days.map((day) => day.dayIndex))).length;
  const range = resolveDateRange(itinerary.days.map((day) => day.date));
  const updatedLabel = hasUpdatedAt(itinerary) && itinerary.updatedAt
    ? new Date(itinerary.updatedAt).toLocaleString("ja-JP")
    : "未取得";
  return {
    title: itinerary.title || "無題の旅程",
    items: [
      { label: "日数", value: uniqueDays ? `${uniqueDays} 日` : "未設定", hint: "晴天/悪天候ペアは同じ日としてカウント" },
      { label: "日付", value: range ?? "日付未設定" },
      { label: "バージョン", value: `v${itinerary.version}` },
      { label: "最終更新", value: updatedLabel },
    ],
  };
}

function resolveDateRange(dates: Array<string | undefined>) {
  const valid = dates.filter((date): date is string => Boolean(date));
  if (!valid.length) return null;
  const sorted = valid.map((date) => new Date(date)).sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  const firstLabel = first.toLocaleDateString("ja-JP");
  const lastLabel = last.toLocaleDateString("ja-JP");
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
}

function resolveJobVariant(status: string | null) {
  if (!status) return "info" as const;
  const normalized = status.toLowerCase();
  if (normalized === "succeeded" || normalized === "completed") return "success" as const;
  if (normalized === "failed") return "error" as const;
  if (normalized === "running" || normalized === "queued") return "info" as const;
  return "info" as const;
}

function buildScenarioMatrix(itinerary: ItineraryFormValues | null): ScenarioMatrixDay[] {
  if (!itinerary || !itinerary.days.length) return [];
  const map = new Map<number, { date: string; sunny?: ItineraryFormValues["days"][number]; rainy?: ItineraryFormValues["days"][number] }>();
  itinerary.days.forEach((day) => {
    const bucket = map.get(day.dayIndex) ?? { date: day.date };
    bucket.date = day.date ?? bucket.date;
    if (day.scenario === "SUNNY") bucket.sunny = day;
    if (day.scenario === "RAINY") bucket.rainy = day;
    map.set(day.dayIndex, bucket);
  });

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([dayIndex, bucket]) => ({
      dayIndex,
      date: bucket.date,
      slots: buildScenarioSlots(bucket.sunny?.activities ?? [], bucket.rainy?.activities ?? []),
    }))
    .filter((day) => day.slots.length > 0);
}

function buildScenarioSlots(
  sunnyActivities: ScenarioMatrixActivity[],
  rainyActivities: ScenarioMatrixActivity[],
): ScenarioMatrixSlot[] {
  const grouped = new Map<string, { label: string; order: number; sunny: ScenarioMatrixActivity[]; rainy: ScenarioMatrixActivity[] }>();
  const register = (activity: ScenarioMatrixActivity | undefined, scenario: "sunny" | "rainy", index: number) => {
    if (!activity) return;
    const { key, label, order } = normalizeScenarioSlotTime(activity.time, index, scenario);
    const bucket = grouped.get(key) ?? { label, order, sunny: [], rainy: [] };
    bucket.label = label;
    bucket.order = order;
    bucket[scenario].push(activity);
    grouped.set(key, bucket);
  };

  sunnyActivities.forEach((activity, idx) => register(activity, "sunny", idx));
  rainyActivities.forEach((activity, idx) => register(activity, "rainy", idx));

  const buckets = Array.from(grouped.values()).sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
  const slots: ScenarioMatrixSlot[] = [];
  buckets.forEach((bucket) => {
    const count = Math.max(bucket.sunny.length, bucket.rainy.length, 1);
    for (let idx = 0; idx < count; idx += 1) {
      slots.push({ time: bucket.label, sunny: bucket.sunny[idx], rainy: bucket.rainy[idx] });
    }
  });

  return slots;
}

function normalizeScenarioSlotTime(time: string | undefined, index: number, scenario: "sunny" | "rainy") {
  if (!time) {
    return { key: `blank-${scenario}-${index}`, label: "--:--", order: 24 * 60 + index };
  }
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = clamp(parseInt(match[1], 10), 0, 23);
    const minute = clamp(parseInt(match[2], 10), 0, 59);
    const label = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    return { key: label, label, order: hour * 60 + minute };
  }
  return { key: `${time}-${scenario}-${index}`, label: time, order: 24 * 60 + index };
}

function sanitizeItinerary(itinerary: ItineraryFormValues | null): ItineraryFormValues | null {
  if (!itinerary) return null;
  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      date: normalizeDateField(day.date),
      activities: (day.activities ?? []).map((activity) => ({
        ...activity,
        time: normalizeTimeField(activity.time),
        area: activity.area ?? "",
        placeName: activity.placeName ?? "",
        category: activity.category ?? "SIGHTSEEING",
        description: activity.description ?? "",
        stayMinutes: normalizeStayMinutesField(activity.stayMinutes),
        weather: activity.weather ?? "UNKNOWN",
      })),
    })),
  };
}

function normalizeTimeField(value?: string) {
  if (!value) return "09:00";
  const match = value.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const hour = clamp(Number(match[1]), 0, 23);
    const minute = clamp(Number(match[2]), 0, 59);
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length >= 3) {
    const hour = clamp(Number(digits.slice(0, digits.length - 2)), 0, 23);
    const minute = clamp(Number(digits.slice(-2)), 0, 59);
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }
  return "09:00";
}

function normalizeDateField(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function normalizeStayMinutesField(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return undefined;
  const clamped = Math.max(5, Math.min(Number(value), 1440));
  return clamped;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
