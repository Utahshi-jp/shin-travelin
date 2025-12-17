"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import {
  Control,
  FieldArrayWithId,
  FieldErrors,
  UseFormRegister,
  UseFormReturn,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { api, ApiError } from "@/shared/api/client";
import { itinerarySchema, ItineraryFormValues } from "@/shared/validation/itinerary.schema";

type DayScenario = "SUNNY" | "RAINY";
type JobHighlights = { pending: number[]; completed: number[]; failed: number[] };

type Props = {
  itinerary: ItineraryFormValues;
  onReloadLatest?: () => Promise<ItineraryFormValues | null>;
  highlights?: JobHighlights | null;
};

type DayGroup = {
  dayIndex: number;
  date: string;
  entries: { scenario: DayScenario; formIndex: number; fieldId: string }[];
};

type DiffResult = { titleChanged: boolean; changedDayLabels: string[] };

const SCENARIO_LABEL: Record<DayScenario, string> = {
  SUNNY: "晴天プラン",
  RAINY: "悪天候プラン",
};

export function ItineraryEditor({ itinerary, onReloadLatest, highlights }: Props) {
  const form = useForm<ItineraryFormValues>({ resolver: zodResolver(itinerarySchema), defaultValues: itinerary, mode: "onBlur" });
  const daysArray = useFieldArray({ control: form.control, name: "days" });
  const watchedDays = form.watch("days") ?? [];
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: number; latest?: number } | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  useEffect(() => {
    form.reset(itinerary);
    setDiff(null);
    setConflict(null);
    setMessage(null);
  }, [itinerary, form]);

  const groupedDays = useMemo<DayGroup[]>(() => groupDays(watchedDays, daysArray.fields), [watchedDays, daysArray.fields]);
  const comparisonDays = useMemo(() => buildComparisonByDay(watchedDays), [watchedDays]);

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    setDiff(null);
    try {
      const payload = {
        title: values.title,
        version: values.version,
        days: values.days.map((day) => ({
          dayIndex: day.dayIndex,
          date: day.date,
          scenario: day.scenario,
          activities: day.activities.map((activity, idx) => ({
            ...activity,
            orderIndex: idx,
          })),
        })),
      };
      const res = await api.updateItinerary(values.id, payload);
      form.setValue("version", res.version, { shouldValidate: false, shouldDirty: false });
      setMessage("保存しました");
      setConflict(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict({ current: values.version });
        if (onReloadLatest) {
          const latest = await onReloadLatest();
          if (latest) {
            setDiff(computeDiff(values, latest));
            form.reset(latest);
            setConflict({ current: values.version, latest: latest.version });
            setMessage("最新データを読み込みました。差分を確認して再度保存してください。");
            return;
          }
        }
        setMessage("別の更新がありました。最新データを再取得してください。");
      } else {
        setMessage(err instanceof Error ? err.message : "更新に失敗しました");
      }
    }
  });

  const versionText = useMemo(() => {
    if (!conflict) return `version: ${form.watch("version")}`;
    if (conflict.latest) return `あなたのversion ${conflict.current} / 最新 ${conflict.latest}`;
    return `あなたのversion ${conflict.current}`;
  }, [conflict, form]);

  const newDayDate = useMemo(() => {
    const last = groupedDays[groupedDays.length - 1];
    if (!last) return new Date().toISOString().slice(0, 10);
    const next = incrementDate(last.date);
    return next.toISOString().slice(0, 10);
  }, [groupedDays]);

  const addDayPair = () => {
    const nextIndex = groupedDays.length ? groupedDays[groupedDays.length - 1].dayIndex + 1 : 0;
    (["SUNNY", "RAINY"] as DayScenario[]).forEach((scenario) => {
      daysArray.append({
        dayIndex: nextIndex,
        date: newDayDate,
        scenario,
        activities: [createDefaultActivity(scenario)],
      });
    });
  };

  const removeDay = (dayIndex: number) => {
    const group = groupedDays.find((day) => day.dayIndex === dayIndex);
    if (!group) return;
    const indexes = [...group.entries.map((entry) => entry.formIndex)].sort((a, b) => b - a);
    indexes.forEach((idx) => daysArray.remove(idx));
    renumberDayIndexes(form, form.getValues("days"));
  };

  const moveDay = (source: number, direction: -1 | 1) => {
    const target = source + direction;
    if (target < 0 || target >= groupedDays.length) return;
    const reordered = [...groupedDays];
    const [moved] = reordered.splice(source, 1);
    reordered.splice(target, 0, moved);
    reordered.forEach((day, idx) => {
      day.entries.forEach(({ formIndex }) => {
        form.setValue(`days.${formIndex}.dayIndex`, idx, { shouldDirty: true, shouldValidate: false });
      });
    });
  };

  const handleDayDateChange = (dayIndex: number, nextDate: string) => {
    form.getValues("days").forEach((day, idx) => {
      if (day.dayIndex === dayIndex) {
        form.setValue(`days.${idx}.date`, nextDate, { shouldDirty: true });
      }
    });
  };

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">旅程編集</h2>
        <p className="text-xs text-slate-500">{versionText}</p>
      </div>
      <form className="mt-4 space-y-4" onSubmit={onSubmit}>
        <label className="grid gap-1">
          <span className="text-sm font-medium">タイトル</span>
          <input className="rounded border px-3 py-2" {...form.register("title")} aria-invalid={!!form.formState.errors.title} />
          {form.formState.errors.title && <span className="text-xs text-red-600">{form.formState.errors.title.message}</span>}
        </label>

        {diff && (
          <DiffSummary diff={diff} />
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addDayPair} className="rounded border px-3 py-1 text-sm">
            日を追加（晴天/悪天候ペア）
          </button>
        </div>

        {groupedDays.map((day, groupIndex) => {
          const comparisonSlots = comparisonDays.get(day.dayIndex) ?? [];
          return (
            <article
              key={`day-${day.dayIndex}`}
              id={`day-${day.dayIndex}`}
              data-itinerary-day={day.dayIndex}
              className={`space-y-3 rounded border p-4 ${highlightClass(day.dayIndex, highlights)}`}
            >
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Day {day.dayIndex + 1}</p>
                  <input
                    type="date"
                    className="mt-1 rounded border px-3 py-1 text-sm"
                    value={day.date}
                    onChange={(event) => handleDayDateChange(day.dayIndex, event.target.value)}
                  />
                </div>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => moveDay(groupIndex, -1)} disabled={groupIndex === 0} className="rounded border px-2 py-1 disabled:opacity-40">
                    上へ
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDay(groupIndex, 1)}
                    disabled={groupIndex === groupedDays.length - 1}
                    className="rounded border px-2 py-1 disabled:opacity-40"
                  >
                    下へ
                  </button>
                  <button type="button" onClick={() => removeDay(day.dayIndex)} className="rounded border px-2 py-1 text-red-600">
                    削除
                  </button>
                </div>
              </header>

              {comparisonSlots.length > 0 && <DayComparisonGrid slots={comparisonSlots} />}

              <div className="grid gap-4 lg:grid-cols-2">
                {day.entries.map((entry) => (
                  <ScenarioSection
                    key={entry.fieldId}
                    control={form.control}
                    path={`days.${entry.formIndex}`}
                    scenario={entry.scenario}
                    register={form.register}
                    errors={form.formState.errors}
                  />
                ))}
              </div>
            </article>
          );
        })}

        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-slate-400" disabled={form.formState.isSubmitting}>
          保存
        </button>
        {message && <p className="text-sm text-slate-700" role="status">{message}</p>}
      </form>
    </section>
  );
}

function ScenarioSection({
  control,
  path,
  scenario,
  register,
  errors,
}: {
  control: Control<ItineraryFormValues>;
  path: `days.${number}`;
  scenario: DayScenario;
  register: UseFormRegister<ItineraryFormValues>;
  errors: FieldErrors<ItineraryFormValues>;
}) {
  const activitiesArray = useFieldArray({ control, name: `${path}.activities` as const });
  const dayIndex = Number(path.split(".")[1]);
  const dayErrors = errors.days?.[dayIndex] as any;
  const activityErrors = dayErrors?.activities ?? [];

  const addActivity = () => {
    activitiesArray.append(createDefaultActivity(scenario));
  };

  return (
    <section className="rounded border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{SCENARIO_LABEL[scenario]}</h3>
        <button type="button" onClick={addActivity} className="rounded border px-2 py-1 text-xs">
          行を追加
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {activitiesArray.fields.map((field, index) => (
          <div key={field.id} className="rounded border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium">
                時刻
                <input className="mt-1 w-full rounded border px-2 py-1" {...register(`${path}.activities.${index}.time` as const)} />
                {activityErrors?.[index]?.time && <span className="text-[11px] text-red-600">{activityErrors[index].time.message}</span>}
              </label>
              <label className="text-xs font-medium">
                場所
                <input className="mt-1 w-full rounded border px-2 py-1" {...register(`${path}.activities.${index}.location` as const)} />
                {activityErrors?.[index]?.location && <span className="text-[11px] text-red-600">{activityErrors[index].location.message}</span>}
              </label>
            </div>
              <label className="mt-2 block text-xs font-medium">
                内容
                <textarea className="mt-1 w-full rounded border px-2 py-1" rows={2} {...register(`${path}.activities.${index}.content` as const)} />
              {activityErrors?.[index]?.content && <span className="text-[11px] text-red-600">{activityErrors[index].content.message}</span>}
            </label>
              <label className="mt-2 block text-xs font-medium">
                URL
                <input className="mt-1 w-full rounded border px-2 py-1" {...register(`${path}.activities.${index}.url` as const)} />
              {activityErrors?.[index]?.url && <span className="text-[11px] text-red-600">{activityErrors[index].url.message}</span>}
            </label>
              <label className="mt-2 block text-xs font-medium">
                天気
                <input className="mt-1 w-full rounded border px-2 py-1 uppercase" {...register(`${path}.activities.${index}.weather` as const)} />
              {activityErrors?.[index]?.weather && <span className="text-[11px] text-red-600">{activityErrors[index].weather.message}</span>}
            </label>
            <div className="mt-2 flex gap-2 text-xs">
              <button type="button" onClick={() => activitiesArray.move(index, index - 1)} disabled={index === 0} className="rounded border px-2 py-1 disabled:opacity-40">
                上へ
              </button>
              <button
                type="button"
                onClick={() => activitiesArray.move(index, index + 1)}
                disabled={index === activitiesArray.fields.length - 1}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                下へ
              </button>
              <button type="button" onClick={() => activitiesArray.remove(index)} className="rounded border px-2 py-1 text-red-600">
                削除
              </button>
            </div>
          </div>
        ))}
        {!activitiesArray.fields.length && <p className="text-xs text-slate-500">活動がありません。行を追加してください。</p>}
      </div>
    </section>
  );
}

function createDefaultActivity(scenario: DayScenario) {
  return {
    time: "09:00",
    location: "",
    content: "",
    url: "",
    weather: scenario,
    orderIndex: 0,
  };
}

function groupDays(days: ItineraryFormValues["days"], fields: FieldArrayWithId<ItineraryFormValues, "days", "id">[]): DayGroup[] {
  const map = new Map<number, DayGroup>();
  days.forEach((day, idx) => {
    const entry = map.get(day.dayIndex) ?? { dayIndex: day.dayIndex, date: day.date, entries: [] };
    entry.date = day.date;
    entry.entries.push({ scenario: day.scenario as DayScenario, formIndex: idx, fieldId: fields[idx]?.id ?? `${day.dayIndex}-${idx}` });
    map.set(day.dayIndex, entry);
  });
  return Array.from(map.values()).sort((a, b) => a.dayIndex - b.dayIndex);
}

function incrementDate(base: string) {
  const next = new Date(base);
  if (Number.isNaN(next.getTime())) return new Date();
  next.setDate(next.getDate() + 1);
  return next;
}

function renumberDayIndexes(form: UseFormReturn<ItineraryFormValues>, days: ItineraryFormValues["days"]) {
  const ordered = Array.from(new Set(days.map((day) => day.dayIndex))).sort((a, b) => a - b);
  const mapping = new Map(ordered.map((value, idx) => [value, idx] as const));
  days.forEach((day, idx) => {
    const target = mapping.get(day.dayIndex);
    if (typeof target === "number") {
      form.setValue(`days.${idx}.dayIndex`, target, { shouldDirty: true, shouldValidate: false });
    }
  });
}

function highlightClass(dayIndex: number, highlights?: JobHighlights | null) {
  if (!highlights) return "";
  if (highlights.completed.includes(dayIndex)) return "border-emerald-300 bg-emerald-50";
  if (highlights.pending.includes(dayIndex)) return "border-amber-300 bg-amber-50";
  if (highlights.failed.includes(dayIndex)) return "border-yellow-300 bg-yellow-50";
  return "";
}

function computeDiff(prev: ItineraryFormValues, next: ItineraryFormValues): DiffResult {
  const labels = new Set<string>();
  const labelOf = (dayIndex: number, scenario: DayScenario) => `Day ${dayIndex + 1} ${SCENARIO_LABEL[scenario]}`;
  const nextMap = new Map<string, (typeof next.days)[number]>();
  next.days.forEach((day) => nextMap.set(`${day.dayIndex}-${day.scenario}`, day));

  prev.days.forEach((day) => {
    const key = `${day.dayIndex}-${day.scenario}`;
    const latest = nextMap.get(key);
    if (!latest) {
      labels.add(labelOf(day.dayIndex, day.scenario as DayScenario));
      return;
    }
    if (latest.date !== day.date) labels.add(labelOf(day.dayIndex, day.scenario as DayScenario));
    if (JSON.stringify(latest.activities) !== JSON.stringify(day.activities)) {
      labels.add(labelOf(day.dayIndex, day.scenario as DayScenario));
    }
  });

  next.days.forEach((day) => {
    const key = `${day.dayIndex}-${day.scenario}`;
    if (!prev.days.some((prevDay) => `${prevDay.dayIndex}-${prevDay.scenario}` === key)) {
      labels.add(labelOf(day.dayIndex, day.scenario as DayScenario));
    }
  });

  return { titleChanged: prev.title !== next.title, changedDayLabels: Array.from(labels) };
}

function DiffSummary({ diff }: { diff: DiffResult }) {
  if (!diff.titleChanged && diff.changedDayLabels.length === 0) return null;
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium">サーバー版と競合しました。</p>
      <ul className="mt-2 list-disc pl-4 text-xs text-amber-900">
        {diff.titleChanged && <li>タイトルが更新されました</li>}
        {diff.changedDayLabels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}

type EditorActivity = ItineraryFormValues["days"][number]["activities"][number];
type ComparisonSlot = { time: string; sunny?: EditorActivity; rainy?: EditorActivity };

function DayComparisonGrid({ slots }: { slots: ComparisonSlot[] }) {
  if (!slots.length) return null;
  return (
    <section className="rounded border border-dashed border-slate-200 bg-slate-50 p-3 text-xs">
      <p className="font-semibold text-slate-600">天候別タイムライン</p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th className="w-20 px-2 py-1 font-medium">時間</th>
              <th className="px-2 py-1 font-medium">晴天</th>
              <th className="px-2 py-1 font-medium">悪天候</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, idx) => (
              <tr key={`${slot.time}-${idx}`} className="border-t border-slate-100 align-top">
                <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{slot.time}</td>
                <td className="px-2 py-2"><ComparisonCell activity={slot.sunny} variant="SUNNY" /></td>
                <td className="px-2 py-2"><ComparisonCell activity={slot.rainy} variant="RAINY" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonCell({ activity, variant }: { activity?: EditorActivity; variant: DayScenario }) {
  if (!activity) {
    return (
      <div className="rounded border border-dashed border-slate-300 p-2 text-[11px] text-slate-400">
        {variant === "SUNNY" ? "晴天プラン未設定" : "悪天候プラン未設定"}
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded border border-slate-200 bg-white/70 p-2">
      <p className="text-[11px] font-semibold text-slate-700">{activity.location || "場所未設定"}</p>
      <p className="text-[11px] text-slate-600">{activity.content || "内容未設定"}</p>
    </div>
  );
}

function buildComparisonByDay(days: ItineraryFormValues["days"]): Map<number, ComparisonSlot[]> {
  const grouped = new Map<number, { sunny?: EditorActivity[]; rainy?: EditorActivity[] }>();
  days.forEach((day) => {
    const bucket = grouped.get(day.dayIndex) ?? {};
    if (day.scenario === "SUNNY") bucket.sunny = day.activities ?? [];
    if (day.scenario === "RAINY") bucket.rainy = day.activities ?? [];
    grouped.set(day.dayIndex, bucket);
  });

  const result = new Map<number, ComparisonSlot[]>();
  grouped.forEach((bucket, dayIndex) => {
    const slots = buildComparisonSlots(bucket.sunny ?? [], bucket.rainy ?? []);
    if (slots.length) {
      result.set(dayIndex, slots);
    }
  });
  return result;
}

function buildComparisonSlots(sunnyActivities: EditorActivity[], rainyActivities: EditorActivity[]): ComparisonSlot[] {
  const grouped = new Map<string, { label: string; order: number; sunny: EditorActivity[]; rainy: EditorActivity[] }>();
  const register = (activity: EditorActivity | undefined, scenario: "sunny" | "rainy", index: number) => {
    if (!activity) return;
    const { key, label, order } = normalizeSlotTime(activity.time, index, scenario);
    const bucket = grouped.get(key) ?? { label, order, sunny: [], rainy: [] };
    bucket.label = label;
    bucket.order = order;
    bucket[scenario].push(activity);
    grouped.set(key, bucket);
  };

  sunnyActivities.forEach((activity, idx) => register(activity, "sunny", idx));
  rainyActivities.forEach((activity, idx) => register(activity, "rainy", idx));

  const buckets = Array.from(grouped.values()).sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
  const slots: ComparisonSlot[] = [];
  buckets.forEach((bucket) => {
    const count = Math.max(bucket.sunny.length, bucket.rainy.length, 1);
    for (let idx = 0; idx < count; idx += 1) {
      slots.push({ time: bucket.label, sunny: bucket.sunny[idx], rainy: bucket.rainy[idx] });
    }
  });
  return slots;
}

function normalizeSlotTime(time: string | undefined, index: number, scenario: "sunny" | "rainy") {
  if (!time) {
    return { key: `blank-${scenario}-${index}`, label: "--:--", order: 24 * 60 + index };
  }
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = clampToRange(parseInt(match[1], 10), 0, 23);
    const minute = clampToRange(parseInt(match[2], 10), 0, 59);
    const label = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    return { key: label, label, order: hour * 60 + minute };
  }
  return { key: `${time}-${scenario}-${index}`, label: time, order: 24 * 60 + index };
}

function clampToRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
