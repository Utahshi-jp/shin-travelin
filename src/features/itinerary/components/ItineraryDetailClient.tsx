"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/shared/api/client";
import { Loading } from "@/shared/ui/Loading";
import { useToast } from "@/shared/ui/ToastProvider";
import { ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import { ItineraryEditor } from "./ItineraryEditor";

const POLL_INTERVAL_MS = 3000;
const POLL_MAX = 20; // 約1分で打ち切り

type Props = {
  id: string;
  jobId?: string;
  initialItinerary: ItineraryFormValues | null;
};

type JobState = {
  status: string;
  message?: string;
  attempts: number;
};

export function ItineraryDetailClient({ id, jobId, initialItinerary }: Props) {
  const { push } = useToast();
  const [itinerary, setItinerary] = useState<ItineraryFormValues | null>(initialItinerary);
  const [jobState, setJobState] = useState<JobState | null>(jobId ? { status: "pending", attempts: 0 } : null);
  const [isReloading, setIsReloading] = useState(false);

  const reloadLatest = useCallback(async () => {
    setIsReloading(true);
    try {
      const latest = await api.getItinerary(id);
      setItinerary(latest as ItineraryFormValues);
      return latest as ItineraryFormValues;
    } catch (err) {
      const apiErr = err as ApiError;
      push({ message: `再取得に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
      return null;
    } finally {
      setIsReloading(false);
    }
  }, [id, push]);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let tries = 0;
    const timer = setInterval(async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const res = await api.getJobStatus(jobId);
        setJobState({ status: res.status, attempts: tries, message: res.error });
        if (res.status === "completed" || res.status === "succeeded") {
          await reloadLatest();
          clearInterval(timer);
        }
        if (res.status === "failed" || tries >= POLL_MAX) {
          clearInterval(timer);
        }
      } catch (err) {
        const apiErr = err as ApiError;
        push({ message: `ジョブ確認に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, reloadLatest, push]);

  const jobLabel = useMemo(() => {
    if (!jobState) return null;
    if (jobState.status === "completed" || jobState.status === "succeeded") return "生成が完了しました。最新の旅程を表示しています。";
    if (jobState.status === "failed") return jobState.message ?? "生成に失敗しました";
    return `生成中... (試行 ${jobState.attempts})`;
  }, [jobState]);

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
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <p>{jobLabel}</p>
          {jobId && <p className="text-xs text-slate-500">jobId: {jobId}</p>}
        </div>
      )}
      <button
        type="button"
        onClick={reloadLatest}
        disabled={isReloading}
        className="rounded border px-3 py-1 text-sm disabled:opacity-60"
      >
        最新を再取得
      </button>
      <ItineraryEditor itinerary={itinerary} onReloadLatest={reloadLatest} />
    </section>
  );
}
