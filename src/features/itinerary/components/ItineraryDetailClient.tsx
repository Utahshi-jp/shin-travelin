
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, ScenarioSelector } from "@/shared/api/client";
import { useToast } from "@/shared/ui/ToastProvider";
import type { ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import { sanitizeItinerary } from "../utils/sanitizeItinerary";
import type { Highlights, JobState, ScenarioMatrixDay } from "./ItineraryDetail.types";
import { describeTargetDayError, parseTargetDayErrorDetails } from "./ItineraryDetail.errors";
import { ItineraryDetailView } from "./ItineraryDetailView";
import { buildScenarioMatrix, buildSummary, resolveJobVariant } from "./ItineraryDetail.helpers";

const POLL_SCHEDULE_MS = [2000, 4000, 8000];
const POLL_TIMEOUT_MS = 120_000;
const DESTINATION_HINT_LIMIT = 5;

type Props = {
	id: string;
	jobId?: string;
	initialItinerary: ItineraryFormValues | null;
};

export function ItineraryDetailClient({ id, jobId, initialItinerary }: Props) {
	const { push } = useToast();
	const router = useRouter();
	const [itinerary, setItinerary] = useState<ItineraryFormValues | null>(() => sanitizeItinerary(initialItinerary));
	const [activeJobId, setActiveJobId] = useState<string | null>(jobId ?? null);
	const [jobState, setJobState] = useState<JobState | null>(jobId ? { status: "queued", jobId, attempts: 0, partialDays: [] } : null);
	const [selectedDays, setSelectedDays] = useState<number[]>([]);
	const [isRegenerating, setIsRegenerating] = useState(false);
	const [pendingDays, setPendingDays] = useState<number[]>([]);
	const [highlights, setHighlights] = useState<Highlights>({ pending: [], completed: [], failed: [] });
	const [scenarioMode, setScenarioMode] = useState<ScenarioSelector>("BOTH");
	const [destinationInputs, setDestinationInputs] = useState<string[]>([]);

	// ユーザー入力を正規化し、重複除去した上で AI へのヒントとして渡す。
	const destinationHints = useMemo(() => {
		const trimmed = destinationInputs
			.map((value) => value.trim())
			.filter((value) => value.length >= 3 && value.length <= 200);
		const unique: string[] = [];
		trimmed.forEach((value) => {
			if (!unique.includes(value)) unique.push(value);
		});
		return unique.slice(0, DESTINATION_HINT_LIMIT);
	}, [destinationInputs]);

	const canAddDestinationHint = destinationInputs.length < DESTINATION_HINT_LIMIT;

	useEffect(() => {
		setItinerary(sanitizeItinerary(initialItinerary));
	}, [initialItinerary]);

	const hasActivities = itinerary?.days?.some((day) => day.activities && day.activities.length > 0) ?? false;
	const isPlanEmpty = Boolean(itinerary && itinerary.days.length > 0 && !hasActivities);
	const scenarioMatrixDays = useMemo<ScenarioMatrixDay[]>(() => buildScenarioMatrix(itinerary), [itinerary]);

	// API から旅程を再取得し、SSR/ISR のキャッシュも更新する。
	const reloadLatest = useCallback(async () => {
		try {
			const latest = await api.getItinerary(id);
			const sanitized = sanitizeItinerary(latest);
			setItinerary(sanitized);
			router.refresh();
			return sanitized;
		} catch (err) {
			const apiErr = err as ApiError;
			push({ message: `再取得に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
			return null;
		}
	}, [id, push, router]);

	// 日付の重複を排除し、日別の再生成ターゲット候補を作成する。
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

	const appendDestinationHint = () => {
		setDestinationInputs((current) => (current.length >= DESTINATION_HINT_LIMIT ? current : [...current, ""]));
	};

	const removeDestinationHint = (index: number) => {
		setDestinationInputs((current) => current.filter((_, idx) => idx !== index));
	};

	const updateDestinationHint = (index: number, value: string) => {
		setDestinationInputs((current) => current.map((entry, idx) => (idx === index ? value : entry)));
	};

	useEffect(() => {
		setSelectedDays((current) => current.filter((index) => dayOptions.some((day) => day.dayIndex === index)));
	}, [dayOptions]);

	// ジョブ ID を持っている間は定期的にステータスをポーリングし、完了/失敗を UI に反映する。
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

	// 部分再生成の本体。scenario/destination の指定をまとめて API に送る。
	const handleRegenerate = async (overrideDays?: number[]) => {
		const targetDays = overrideDays ?? selectedDays;
		if (!targetDays.length || !itinerary) return;
		setIsRegenerating(true);
		try {
			const sortedTargets = [...targetDays].sort((a, b) => a - b);
			const payload: { days: number[]; destinations?: string[]; scenario?: ScenarioSelector } = { days: sortedTargets };
			if (destinationHints.length) {
				payload.destinations = destinationHints;
			}
			if (scenarioMode !== "BOTH") {
				payload.scenario = scenarioMode;
			}
			const { jobId: nextJobId } = await api.regenerateItinerary(itinerary.id, payload);
			setActiveJobId(nextJobId);
			setJobState({ status: "queued", jobId: nextJobId, attempts: 0, partialDays: [] });
			setPendingDays(sortedTargets);
			setHighlights({ pending: sortedTargets, completed: [], failed: [] });
			push({ message: "部分再生成を開始しました", variant: "success" });
		} catch (err) {
			const apiErr = err as ApiError;
			if (apiErr instanceof ApiError && apiErr.code === "VALIDATION_ERROR") {
				const parsed = parseTargetDayErrorDetails(apiErr.details);
				const { message, invalidIndexes } = describeTargetDayError(dayOptions.length, parsed);
				if (invalidIndexes?.length) {
					setSelectedDays((current) => current.filter((index) => !invalidIndexes.includes(index)));
				}
				push({ message, variant: "error", correlationId: apiErr.correlationId });
			} else {
				push({ message: `再生成に失敗しました: ${apiErr.code ?? "UNKNOWN"}`, variant: "error", correlationId: apiErr.correlationId });
			}
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
	const selectAllDays = useCallback(() => {
		setSelectedDays(dayOptions.map((day) => day.dayIndex));
	}, [dayOptions]);
	const clearSelection = useCallback(() => setSelectedDays([]), []);
	const isJobLocked = Boolean(activeJobId) || isRegenerating;

	return (
		<ItineraryDetailView
			itineraryId={id}
			itinerary={itinerary}
			summary={summary}
			jobLabel={jobLabel}
			jobVariant={jobVariant}
			jobState={jobState}
			isPlanEmpty={isPlanEmpty}
			isJobLocked={isJobLocked}
			selectedDays={selectedDays}
			dayOptions={dayOptions}
			scenarioMode={scenarioMode}
			onScenarioModeChange={setScenarioMode}
			onToggleDay={toggleDay}
			onSelectAllDays={selectAllDays}
			onClearSelectedDays={clearSelection}
			onRegenerate={handleRegenerate}
			onRegenerateAll={handleRegenerateAll}
			destinationInputs={destinationInputs}
			canAddDestinationHint={canAddDestinationHint}
			onDestinationHintAdd={appendDestinationHint}
			onDestinationHintRemove={removeDestinationHint}
			onDestinationHintChange={updateDestinationHint}
			destinationHints={destinationHints}
			highlights={highlights}
			scenarioMatrixDays={scenarioMatrixDays}
			onReloadLatest={reloadLatest}
		/>
	);
}


