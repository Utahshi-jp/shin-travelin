"use client";

import Link from "next/link";
import type { ScenarioSelector } from "@/shared/api/client";
import type { ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import { KeyValueList } from "@/shared/ui/KeyValueList";
import { Loading } from "@/shared/ui/Loading";
import { SectionCard } from "@/shared/ui/SectionCard";
import { StateCallout } from "@/shared/ui/StateCallout";
import { ItineraryEditor } from "./ItineraryEditor";
import type {
  Highlights,
  ItinerarySummary,
  JobState,
  ScenarioMatrixActivity,
  ScenarioMatrixDay,
} from "./ItineraryDetail.types";

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

type DayOption = { dayIndex: number; date: string };

type ItineraryDetailViewProps = {
  itineraryId: string;
  itinerary: ItineraryFormValues | null;
  summary: ItinerarySummary;
  jobLabel: string | null;
  jobVariant: React.ComponentProps<typeof StateCallout>["variant"];
  jobState: JobState | null;
  isPlanEmpty: boolean;
  isJobLocked: boolean;
  selectedDays: number[];
  dayOptions: DayOption[];
  scenarioMode: ScenarioSelector;
  onScenarioModeChange: (mode: ScenarioSelector) => void;
  onToggleDay: (dayIndex: number) => void;
  onSelectAllDays: () => void;
  onClearSelectedDays: () => void;
  onRegenerate: (overrideDays?: number[]) => void;
  onRegenerateAll: () => void;
  destinationInputs: string[];
  canAddDestinationHint: boolean;
  onDestinationHintAdd: () => void;
  onDestinationHintRemove: (index: number) => void;
  onDestinationHintChange: (index: number, value: string) => void;
  destinationHints: string[];
  highlights: Highlights;
  scenarioMatrixDays: ScenarioMatrixDay[];
  onReloadLatest: () => Promise<ItineraryFormValues | null>;
};

export function ItineraryDetailView(props: ItineraryDetailViewProps) {
  const {
    itineraryId,
    itinerary,
    summary,
    jobLabel,
    jobVariant,
    jobState,
    isPlanEmpty,
    isJobLocked,
    selectedDays,
    dayOptions,
    scenarioMode,
    onScenarioModeChange,
    onToggleDay,
    onSelectAllDays,
    onClearSelectedDays,
    onRegenerate,
    onRegenerateAll,
    destinationInputs,
    canAddDestinationHint,
    onDestinationHintAdd,
    onDestinationHintRemove,
    onDestinationHintChange,
    destinationHints,
    highlights,
    scenarioMatrixDays,
    onReloadLatest,
  } = props;

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
              onClick={onRegenerateAll}
              disabled={isJobLocked || !dayOptions.length}
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
              disabled={isJobLocked}
              onChange={(event) => onScenarioModeChange(event.target.value as ScenarioSelector)}
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
                  disabled={isJobLocked}
                  onChange={() => onToggleDay(day.dayIndex)}
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
              onClick={onSelectAllDays}
              className="rounded-full border px-3 py-1"
              disabled={!dayOptions.length || isJobLocked}
            >
              全選択
            </button>
            <button type="button" onClick={onClearSelectedDays} className="rounded-full border px-3 py-1" disabled={!selectedDays.length}>
              クリア
            </button>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">目的地のヒント（任意）</p>
              <span className="text-[11px] text-slate-500">最大5件</span>
            </div>
            <p className="text-xs text-slate-500">部分再生成で重視したい都市やランドマークを入力すると、AIが新しい文脈を反映しやすくなります。</p>
            <div className="space-y-2">
              {destinationInputs.map((value, index) => (
                <div key={`regen-destination-${index}`} className="flex gap-2">
                  <input
                    value={value}
                    onChange={(event) => onDestinationHintChange(index, event.target.value)}
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder={index === 0 ? "例: 札幌市" : "例: 小樽運河"}
                    aria-label={`目的地ヒント ${index + 1}`}
                  />
                  <button
                    type="button"
                    aria-label={`目的地ヒント ${index + 1} を削除`}
                    onClick={() => onDestinationHintRemove(index)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-red-200 hover:text-red-600"
                  >
                    削除
                  </button>
                </div>
              ))}
              {!destinationInputs.length && <p className="text-xs text-slate-400">例: 札幌市 / 小樽運河 / 美瑛の丘</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>{destinationHints.length ? `${destinationHints.length} 件送信予定` : "空欄の行は自動で除外されます"}</span>
              <button
                type="button"
                onClick={onDestinationHintAdd}
                disabled={!canAddDestinationHint}
                className="rounded-full border border-slate-300 px-3 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                目的地を追加
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRegenerate()}
            disabled={!selectedDays.length || isJobLocked}
            className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            選択した日を再生成
          </button>
        </SectionCard>

        <SectionCard
          tone="muted"
          title="保存済みの旅程"
          description="部分再生成を送信すると即時に反映され、生成したスケジュールはいつでも開き直せます。"
        >
          <p className="text-sm text-slate-600">
            保存済みの旅程は一覧ページにまとまり、過去のドラフトや印刷ビューもここからすぐに開けます。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Link
              href="/itineraries"
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              保存済み旅程を開く
            </Link>
            <Link
              href={`/itineraries/${itineraryId}/print`}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400"
            >
              印刷はここから
            </Link>
          </div>
        </SectionCard>
      </div>

      {scenarioMatrixDays.length > 0 && (
        <SectionCard title="天候別タイムライン" description="晴天・悪天候プランを同時間帯で比較できます。">
          <ScenarioMatrix days={scenarioMatrixDays} />
        </SectionCard>
      )}

      <ItineraryEditor itinerary={itinerary} onReloadLatest={onReloadLatest} highlights={highlights} />
    </section>
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
