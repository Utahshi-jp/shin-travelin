"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, FormProvider, useFieldArray, useForm } from "react-hook-form";
import { api, ApiError } from "@/shared/api/client";
import { draftFormSchema, DraftFormValues } from "@/shared/validation/draft.schema";

export default function Home() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const form = useForm<DraftFormValues>({
    resolver: zodResolver(draftFormSchema),
    defaultValues: {
      origin: "",
      destinations: [""],
      startDate: "",
      endDate: "",
      budget: 50000,
      purposes: [""],
      memo: "",
      companions: { adultMale: 1, adultFemale: 0, boy: 0, girl: 0, infant: 0, pet: 0, other: 0 },
    },
    mode: "onChange",
  });

  const destArray = useFieldArray({ control: form.control, name: "destinations" });
  const purposesArray = useFieldArray({ control: form.control, name: "purposes" });
  const firstErrorRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (form.formState.isSubmitted && Object.keys(form.formState.errors).length > 0) {
      const first = document.querySelector("[data-first-error=true]") as HTMLElement | null;
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus();
    }
  }, [form.formState.errors, form.formState.isSubmitted]);

  const onSubmit = form.handleSubmit(async (values) => {
    setToast(null);
    try {
      const draft = await api.createDraft(values);
      const job = await api.startGeneration({ draftId: draft.id });
      router.push(`/itineraries/${draft.id}?jobId=${job.jobId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setToast(`${err.code}: ${err.message}` + (err.correlationId ? ` (${err.correlationId})` : ""));
      } else {
        setToast("予期せぬエラーが発生しました");
      }
    }
  }, () => {
    const firstName = Object.keys(form.formState.errors)[0];
    if (firstName) {
      firstErrorRef.current = document.querySelector(`[name="${firstName}"]`);
    }
  });

  const disableAddDestination = useMemo(() => destArray.fields.length >= 5, [destArray.fields.length]);
  const disableAddPurpose = useMemo(() => purposesArray.fields.length >= 5, [purposesArray.fields.length]);

  const handleLogin = async (email: string, password: string) => {
    try {
      const res = await api.login({ email, password });
      localStorage.setItem("shin_access_token", res.accessToken);
      document.cookie = `shin_access_token=${res.accessToken}; path=/; SameSite=Lax`;
      setAuthMessage("ログインしました");
    } catch (err) {
      setAuthMessage(err instanceof ApiError ? err.message : "ログインに失敗しました");
    }
  };

  const handleRegister = async (email: string, password: string, displayName: string) => {
    try {
      const res = await api.register({ email, password, displayName });
      localStorage.setItem("shin_access_token", res.accessToken);
      document.cookie = `shin_access_token=${res.accessToken}; path=/; SameSite=Lax`;
      setAuthMessage("登録しました");
    } catch (err) {
      setAuthMessage(err instanceof ApiError ? err.message : "登録に失敗しました");
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">shin-travelin</h1>
      <p className="text-sm text-slate-600">旅行条件を入力して生成を開始します（ログイン必須）。</p>

      <AuthBox onLogin={handleLogin} onRegister={handleRegister} message={authMessage} />

      {toast && <div role="alert" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">{toast}</div>}

      <FormProvider {...form}>
        <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
          <Field label="出発地" name="origin" ariaDescribedBy="originHelp" error={form.formState.errors.origin?.message}>
            <input
              {...form.register("origin")}
              data-first-error={!!form.formState.errors.origin}
              id="origin"
              className="w-full rounded border px-3 py-2"
              aria-describedby="originHelp"
            />
          </Field>
          <p id="originHelp" className="text-xs text-slate-500">3-200文字</p>

          <section aria-label="目的地" className="grid gap-2">
            <div className="flex items-center justify-between">
              <label className="font-medium">目的地 (最大5件)</label>
              <button type="button" onClick={() => destArray.append("")} disabled={disableAddDestination} className="rounded border px-2 py-1">
                追加
              </button>
            </div>
            {destArray.fields.map((field, index) => (
              <Field
                key={field.id}
                label={`目的地 ${index + 1}`}
                name={`destinations.${index}`}
                error={form.formState.errors.destinations?.[index]?.message as string | undefined}
              >
                <div className="flex gap-2">
                  <input
                    {...form.register(`destinations.${index}` as const)}
                    className="w-full rounded border px-3 py-2"
                    data-first-error={!!form.formState.errors.destinations?.[index]}
                  />
                  <button type="button" aria-label="削除" onClick={() => destArray.remove(index)} className="rounded border px-2 py-1">
                    削除
                  </button>
                </div>
              </Field>
            ))}
          </section>

          <div className="grid grid-cols-2 gap-4">
            <Field label="開始日" name="startDate" error={form.formState.errors.startDate?.message}>
              <input type="date" {...form.register("startDate")}
                data-first-error={!!form.formState.errors.startDate}
                className="w-full rounded border px-3 py-2" />
            </Field>
            <Field label="終了日" name="endDate" error={form.formState.errors.endDate?.message}>
              <input type="date" {...form.register("endDate")}
                data-first-error={!!form.formState.errors.endDate}
                className="w-full rounded border px-3 py-2" />
            </Field>
          </div>

          <Field label="予算" name="budget" error={form.formState.errors.budget?.message}>
            <input
              type="number"
              min={5000}
              max={5000000}
              {...form.register("budget", { valueAsNumber: true })}
              data-first-error={!!form.formState.errors.budget}
              className="w-full rounded border px-3 py-2"
            />
          </Field>

          <section aria-label="旅行目的" className="grid gap-2">
            <div className="flex items-center justify-between">
              <label className="font-medium">旅行目的 (最大5件)</label>
              <button type="button" onClick={() => purposesArray.append("")} disabled={disableAddPurpose} className="rounded border px-2 py-1">
                追加
              </button>
            </div>
            {purposesArray.fields.map((field, index) => (
              <Field
                key={field.id}
                label={`目的 ${index + 1}`}
                name={`purposes.${index}`}
                error={form.formState.errors.purposes?.[index]?.message as string | undefined}
              >
                <div className="flex gap-2">
                  <input
                    {...form.register(`purposes.${index}` as const)}
                    className="w-full rounded border px-3 py-2"
                    data-first-error={!!form.formState.errors.purposes?.[index]}
                  />
                  <button type="button" aria-label="削除" onClick={() => purposesArray.remove(index)} className="rounded border px-2 py-1">
                    削除
                  </button>
                </div>
              </Field>
            ))}
          </section>

          <Field label="メモ" name="memo" error={form.formState.errors.memo?.message}>
            <textarea {...form.register("memo")} className="w-full rounded border px-3 py-2" rows={3} />
          </Field>

          <fieldset className="grid gap-2" aria-label="同行者人数">
            <legend className="font-medium">同行者人数 (0-20)</legend>
            {(
              [
                ["adultMale", "成人男性"],
                ["adultFemale", "成人女性"],
                ["boy", "男児"],
                ["girl", "女児"],
                ["infant", "幼児"],
                ["pet", "ペット"],
                ["other", "その他"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label} name={`companions.${key}`} error={(form.formState.errors.companions as any)?.[key]?.message}>
                <input
                  type="number"
                  min={0}
                  max={20}
                  {...form.register(`companions.${key}` as const, { valueAsNumber: true })}
                  className="w-full rounded border px-3 py-2"
                />
              </Field>
            ))}
          </fieldset>

          <button
            type="submit"
            className="mt-2 rounded bg-blue-600 px-4 py-2 text-white disabled:bg-slate-400"
            disabled={form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "送信中..." : "生成を開始"}
          </button>
        </form>
      </FormProvider>
    </main>
  );
}

type FieldProps = {
  label: string;
  name: string;
  children: React.ReactNode;
  error?: string;
  ariaDescribedBy?: string;
};

function Field({ label, name, children, error, ariaDescribedBy }: FieldProps) {
  return (
    <div className="grid gap-1">
      <label htmlFor={name} className="font-medium">
        {label}
      </label>
      {children}
      {error && (
        <span className="text-sm text-red-600" role="alert" aria-live="polite">
          {error}
        </span>
      )}
      {ariaDescribedBy ? <span id={ariaDescribedBy} className="text-xs text-slate-500" /> : null}
    </div>
  );
}

type AuthBoxProps = {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName: string) => Promise<void>;
  message: string | null;
};

function AuthBox({ onLogin, onRegister, message }: AuthBoxProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  return (
    <section className="mt-4 rounded border p-4" aria-label="認証">
      <p className="text-sm text-slate-600">メール/パスワードで簡易ログインできます。トークンは localStorage に保存されます。</p>
      <div className="mt-2 grid gap-2">
        <label className="grid gap-1 text-sm">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Password (≥8)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Display Name (登録時)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded border px-3 py-2" />
        </label>
        <div className="flex gap-2">
          <button type="button" className="rounded bg-slate-700 px-3 py-2 text-white" onClick={() => onLogin(email, password)}>
            ログイン
          </button>
          <button type="button" className="rounded bg-emerald-600 px-3 py-2 text-white" onClick={() => onRegister(email, password, displayName)}>
            新規登録
          </button>
        </div>
        {message && <p className="text-sm text-slate-700">{message}</p>}
      </div>
    </section>
  );
}
