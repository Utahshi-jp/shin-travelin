"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/shared/api/client";
import { Loading } from "@/shared/ui/Loading";
import { useToast } from "@/shared/ui/ToastProvider";
import { ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import { ItineraryEditor } from "./ItineraryEditor";

const POLL_SCHEDULE_MS = [2000, 4000, 8000];
const POLL_TIMEOUT_MS = 120_000;

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
  const [itinerary, setItinerary] = useState<ItineraryFormValues | null>(() => sanitizeItinerary(initialItinerary));
  const [activeJobId, setActiveJobId] = useState<string | null>(jobId ?? null);
  const [jobState, setJobState] = useState<JobState | null>(jobId ? { status: "queued", jobId, attempts: 0, partialDays: [] } : null);
  const [isReloading, setIsReloading] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [pendingDays, setPendingDays] = useState<number[]>([]);
  const [highlights, setHighlights] = useState<Highlights>({ pending: [], completed: [], failed: [] });
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
      return sanitized;
    } catch (err) {
      const apiErr = err as ApiError;
      push({ message: `再取得に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
      return null;
    } finally {
      setIsReloading(false);
    }
  }, [id, push]);

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
      const { jobId: nextJobId } = await api.regenerateItinerary(id, sortedTargets);
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

  if (!itinerary) {
    return (
      <section className="mt-4 space-y-3 rounded border p-4">
        <p className="text-sm text-slate-600">旅程を取得しています...</p>
        {jobLabel && <p className="text-xs text-slate-500">{jobLabel}</p>}
        <Loading label="Loading itinerary" />
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-3">
      {jobLabel && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm" aria-live="polite">
          <p>{jobLabel}</p>
          {jobState?.jobId && <p className="text-xs text-slate-500">jobId: {jobState.jobId}</p>}
        </div>
      )}

      {scenarioMatrixDays.length > 0 && <ScenarioMatrix days={scenarioMatrixDays} />}

      {isPlanEmpty && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm" aria-live="polite">
          <p>AI応答に時刻や内容が不足していたため、空のプランとして保存されています。</p>
          <p className="mt-1 text-xs text-amber-900">全日再生成を試すか、「最新を再取得」で改善後のプランを取得してください。</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="rounded border border-amber-400 px-3 py-1"
              onClick={handleRegenerateAll}
              disabled={!!activeJobId || isRegenerating || !dayOptions.length}
            >
              全日を再生成する
            </button>
          </div>
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">部分再生成</h2>
          <div className="flex gap-3 text-[11px] text-slate-600">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />成功(緑)</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />生成中(黄)</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500" />未生成(黄)</span>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {dayOptions.map((day) => (
            <label key={day.dayIndex} className="flex items-center gap-2 text-sm">
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
            className="rounded border px-3 py-1"
            disabled={!dayOptions.length || !!activeJobId || isRegenerating}
          >
            全選択
          </button>
          <button
            type="button"
            onClick={() => setSelectedDays([])}
            className="rounded border px-3 py-1"
            disabled={!selectedDays.length}
          >
            クリア
          </button>
        </div>
        <button
          type="button"
          onClick={() => handleRegenerate()}
          disabled={!selectedDays.length || !!activeJobId || isRegenerating}
          className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          選択した日を再生成
        </button>
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={reloadLatest} disabled={isReloading} className="rounded border px-3 py-1 text-sm disabled:opacity-60">
          最新を再取得
        </button>
      </div>

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

function ScenarioMatrix({ days }: { days: ScenarioMatrixDay[] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">天候別タイムライン</h2>
        <p className="text-xs text-slate-500">同じ時間に晴/雨プランを見比べられます</p>
      </header>
      <div className="mt-4 space-y-4">
        {days.map((day) => (
          <article key={`matrix-${day.dayIndex}`} className="rounded border border-slate-100 p-3">
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
    </section>
  );
}

function ScenarioCell({ activity, emptyLabel }: { activity?: ScenarioMatrixActivity; emptyLabel: string }) {
  if (!activity) {
    return <p className="text-xs text-slate-400">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-1 text-xs text-slate-700">
      <p className="font-semibold text-slate-800">{activity.location || "場所未設定"}</p>
      <p>{activity.content || "内容未設定"}</p>
    </div>
  );
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
  const grouped = new Map<string, { sunny: ScenarioMatrixActivity[]; rainy: ScenarioMatrixActivity[] }>();
  const register = (activity: ScenarioMatrixActivity | undefined, scenario: "sunny" | "rainy") => {
    if (!activity || !activity.time) return;
    const bucket = grouped.get(activity.time) ?? { sunny: [], rainy: [] };
    bucket[scenario].push(activity);
    grouped.set(activity.time, bucket);
  };

  sunnyActivities.forEach((activity) => register(activity, "sunny"));
  rainyActivities.forEach((activity) => register(activity, "rainy"));

  const orderedTimes = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const slots: ScenarioMatrixSlot[] = [];
  orderedTimes.forEach((time) => {
    const bucket = grouped.get(time);
    if (!bucket) return;
    const count = Math.max(bucket.sunny.length, bucket.rainy.length, 1);
    for (let idx = 0; idx < count; idx += 1) {
      slots.push({ time, sunny: bucket.sunny[idx], rainy: bucket.rainy[idx] });
    }
  });

  return slots;
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
        location: activity.location ?? "",
        content: activity.content ?? "",
        url: activity.url ?? "",
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

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
