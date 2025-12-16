"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { api, ApiError } from "@/shared/api/client";
import { itinerarySchema, ItineraryFormValues } from "@/shared/validation/itinerary.schema";

type Props = {
  itinerary: ItineraryFormValues;
  onReloadLatest?: () => Promise<ItineraryFormValues | null>;
};

/**
 * Simple editor focused on title + optimistic version lock to surface 409 conflicts (FR-4, AR-9).
 */
export function ItineraryEditor({ itinerary, onReloadLatest }: Props) {
  const form = useForm<ItineraryFormValues>({ resolver: zodResolver(itinerarySchema), defaultValues: itinerary });
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: number; latest?: number } | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      const res = await api.updateItinerary(values.id, { title: values.title, version: values.version });
      form.setValue("version", res.version, { shouldValidate: false });
      setMessage("保存しました");
      setConflict(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Why: version衝突はユーザーに最新データを提示し再編集を促すため、即時に再取得を試みる。
        setConflict({ current: values.version });
        if (onReloadLatest) {
          const latest = await onReloadLatest();
          if (latest) {
            form.reset(latest);
            setConflict({ current: values.version, latest: latest.version });
            setMessage("最新を読み込みました。再度保存してください。");
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

  return (
    <section className="mt-4 rounded border p-4">
      <h2 className="text-lg font-semibold">旅程編集</h2>
      <form className="mt-3 grid gap-3" onSubmit={onSubmit}>
        <label className="grid gap-1">
          <span className="text-sm font-medium">タイトル</span>
          <input className="rounded border px-3 py-2" {...form.register("title")} />
        </label>
        <p className="text-xs text-slate-500">{versionText}</p>
        <button type="submit" className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:bg-slate-400" disabled={form.formState.isSubmitting}>
          保存
        </button>
        {message && <p className="text-sm text-slate-700">{message}</p>}
      </form>
    </section>
  );
}
