import type { ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import type { ItinerarySummary, ScenarioMatrixActivity, ScenarioMatrixDay } from "./ItineraryDetail.types";

export type JobVariant = "info" | "success" | "warning" | "error";

type MaybeWithUpdatedAt = ItineraryFormValues & { updatedAt?: string | Date };

export function buildSummary(itinerary: ItineraryFormValues | null): ItinerarySummary {
  if (!itinerary) return null;
  const uniqueDays = new Set(itinerary.days.map((day) => day.dayIndex)).size;
  const range = resolveDateRange(itinerary.days.map((day) => day.date));
  const updatedLabel = hasUpdatedAt(itinerary) && itinerary.updatedAt ? new Date(itinerary.updatedAt).toLocaleString("ja-JP") : "未取得";

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

export function resolveDateRange(dates: Array<string | undefined>) {
  const valid = dates.filter((date): date is string => Boolean(date));
  if (!valid.length) return null;
  const sorted = valid
    .map((date) => new Date(date))
    .sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  const firstLabel = first.toLocaleDateString("ja-JP");
  const lastLabel = last.toLocaleDateString("ja-JP");
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
}

export function resolveJobVariant(status: string | null): JobVariant {
  if (!status) return "info";
  const normalized = status.toLowerCase();
  if (normalized === "succeeded" || normalized === "completed") return "success";
  if (normalized === "failed") return "error";
  if (normalized === "running" || normalized === "queued") return "info";
  return "info";
}

export function buildScenarioMatrix(itinerary: ItineraryFormValues | null): ScenarioMatrixDay[] {
  if (!itinerary || !itinerary.days.length) return [];
  const map = new Map<
    number,
    { date: string; sunny?: ItineraryFormValues["days"][number]; rainy?: ItineraryFormValues["days"][number] }
  >();

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

function hasUpdatedAt(source: ItineraryFormValues | MaybeWithUpdatedAt): source is MaybeWithUpdatedAt {
  return Object.prototype.hasOwnProperty.call(source, "updatedAt");
}

function buildScenarioSlots(
  sunnyActivities: ScenarioMatrixActivity[],
  rainyActivities: ScenarioMatrixActivity[],
): ScenarioMatrixDay["slots"] {
  const grouped = new Map<
    string,
    { label: string; order: number; sunny: ScenarioMatrixActivity[]; rainy: ScenarioMatrixActivity[] }
  >();

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

  const buckets = Array.from(grouped.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const slots: ScenarioMatrixDay["slots"] = [];
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
    const hour = clampNumber(parseInt(match[1], 10), 0, 23);
    const minute = clampNumber(parseInt(match[2], 10), 0, 59);
    const label = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    return { key: label, label, order: hour * 60 + minute };
  }
  return { key: `${time}-${scenario}-${index}`, label: time, order: 24 * 60 + index };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
