"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import { api, ApiError } from "@/shared/api/client";
import { draftFormSchema, DraftFormValues } from "@/shared/validation/draft.schema";
import { scrollToFirstError } from "@/shared/validation/scrollToFirstError";
import { Loading } from "@/shared/ui/Loading";
import { SectionCard } from "@/shared/ui/SectionCard";
import { StateCallout } from "@/shared/ui/StateCallout";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { useToast } from "@/shared/ui/ToastProvider";

type AuthFeedback = { message: string; variant: "success" | "error" };

const HERO_STEPS = [
  { title: "ログイン / 新規登録", detail: "保存や再編集のために一度だけ認証します。" },
  { title: "旅の条件を入力", detail: "行き先・日程・目的・予算を入力すると AI が期待値を理解します。" },
  { title: "結果を確認・編集", detail: "生成後は一覧で比較し、詳細画面で日別に微調整できます。" },
];

const INPUT_TIPS = [
  "地名は「東京駅」「福岡空港」など検索しやすいキーワードで入力してください。",
  "目的は「家族旅行」「美食」「ワーケーション」など行動が想像できる言葉が有効です。",
  "予算は交通費 + 宿泊費 + 体験費を含めた合計を目安にすると精度が安定します。",
  "同行者がいない項目は 0 のままで構いません。",
];

const COMPANION_FIELDS: Array<[keyof DraftFormValues["companions"], string]> = [
  ["adultMale", "成人男性"],
  ["adultFemale", "成人女性"],
  ["boy", "男児"],
  ["girl", "女児"],
  ["infant", "幼児"],
  ["pet", "ペット"],
  ["other", "その他"],
];

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";

export default function Home() {
  const router = useRouter();
  const { push } = useToast();
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback | null>(null);
  const [hasSavedToken, setHasSavedToken] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHasSavedToken(Boolean(localStorage.getItem("shin_access_token")));
  }, []);

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
    mode: "onBlur",
  });

  const destinations = form.watch("destinations") ?? [];
  const purposes = form.watch("purposes") ?? [];

  const appendDestination = () => {
    form.setValue("destinations", [...destinations, ""], { shouldDirty: true });
  };
  const removeDestination = (index: number) => {
    form.setValue(
      "destinations",
      destinations.filter((_, idx) => idx !== index),
      { shouldDirty: true },
    );
  };
  const appendPurpose = () => {
    form.setValue("purposes", [...purposes, ""], { shouldDirty: true });
  };
  const removePurpose = (index: number) => {
    form.setValue(
      "purposes",
      purposes.filter((_, idx) => idx !== index),
      { shouldDirty: true },
    );
  };
  const isSubmitting = form.formState.isSubmitting;

  const onSubmit = form.handleSubmit(async (values) => {
    // Why: サーバー到達前に正しいエラーメッセージを返し、ユーザーの待ち時間を減らす。
    try {
      const draft = await api.createDraft(values);
      const job = await api.startGeneration({ draftId: draft.id });
      if (job.itineraryId) {
        router.push(`/itineraries/${job.itineraryId}`);
      } else {
        router.push(`/itineraries/${draft.id}?jobId=${job.jobId}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        push({ message: `${err.code}: ${err.message}`, variant: "error", correlationId: err.correlationId });
      } else {
        push({ message: "予期せぬエラーが発生しました", variant: "error" });
      }
    }
  }, () => {
    scrollToFirstError(form.formState.errors);
  });

  const disableAddDestination = useMemo(() => destinations.length >= 5, [destinations.length]);
  const disableAddPurpose = useMemo(() => purposes.length >= 5, [purposes.length]);

  const persistToken = (token: string) => {
    // Why: CSRではlocalStorage、SSRの一覧ではCookie経由で同じトークンを参照するため両方に保存。
    localStorage.setItem("shin_access_token", token);
    document.cookie = `shin_access_token=${token}; path=/; SameSite=Lax`;
    setHasSavedToken(true);
  };

  const handleLogin = async (email: string, password: string) => {
    try {
      const res = await api.login({ email, password });
      persistToken(res.accessToken);
      setAuthFeedback({ message: "ログインしました", variant: "success" });
    } catch (err) {
      setAuthFeedback({ message: err instanceof ApiError ? err.message : "ログインに失敗しました", variant: "error" });
    }
  };

  const handleRegister = async (email: string, password: string, displayName: string) => {
    try {
      const res = await api.register({ email, password, displayName });
      persistToken(res.accessToken);
      setAuthFeedback({ message: "登録しました", variant: "success" });
    } catch (err) {
      setAuthFeedback({ message: err instanceof ApiError ? err.message : "登録に失敗しました", variant: "error" });
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <SectionCard tone="brand" title="shin-travelin" description="AI旅程を3ステップで作成。初めての方でも迷わず入力できるようガイドを用意しました。">
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {HERO_STEPS.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-white/60 bg-white/80 p-4 text-sm text-slate-700 shadow-sm backdrop-blur">
              <StatusBadge tone="neutral">STEP {index + 1}</StatusBadge>
              <p className="mt-2 text-base font-semibold text-slate-900">{step.title}</p>
              <p className="text-sm text-slate-700">{step.detail}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/itineraries"
            prefetch={false}
            className={`rounded-full px-5 py-2 font-semibold shadow-sm transition ${hasSavedToken ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            保存した旅程を見る
          </Link>
          <p className="text-xs text-slate-700">
            {hasSavedToken ? "最後に生成した旅程からすぐ再編集できます" : "ログインしておくと生成結果が自動保存されます"}
          </p>
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)]">
        <SectionCard title="旅程生成フォーム" description="入力内容は保存後いつでも修正できます。未入力の欄にはヒントを表示し、不安なく進められるようにしています。">
          <FormProvider {...form}>
            <form className="space-y-5" onSubmit={onSubmit} aria-describedby="form-next-step">
              <FormSection
                title="旅の基本情報"
                description="誰とどこへ向かうのかを伝えると、AIが文脈を理解しやすくなります。"
              >
                <Field
                  label="出発地"
                  name="origin"
                  helperId="originHelp"
                  description="集合場所や出発空港など、3-200文字で具体的に入力してください。"
                  error={form.formState.errors.origin?.message}
                  formPath="origin"
                >
                  <input
                    {...form.register("origin")}
                    id="origin"
                    placeholder="例: 羽田空港 第2ターミナル"
                    className={inputClass}
                    aria-describedby="originHelp"
                    aria-invalid={!!form.formState.errors.origin}
                  />
                </Field>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">目的地（最大5件）</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge tone={disableAddDestination ? "warning" : "neutral"}>
                        残り {Math.max(0, 5 - destinations.length)} 件
                      </StatusBadge>
                      <button
                        type="button"
                        onClick={appendDestination}
                        disabled={disableAddDestination}
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        目的地を追加
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-red-700">
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold">必須</span>
                    <span>最低 1 件の目的地を登録してください。</span>
                  </div>
                  <p className="text-xs text-slate-500">主要な都市や立ち寄りたいエリアを優先順で入力してください。</p>
                  <div className="space-y-3">
                    {destinations.map((_, index) => (
                      <Field
                        key={`destination-${index}`}
                        label={`目的地 ${index + 1}`}
                        name={`destination-${index}`}
                        description={index === 0 ? "最初の目的地を入力してください。具体的なスポット名でも構いません。" : undefined}
                        error={form.formState.errors.destinations?.[index]?.message as string | undefined}
                        formPath={`destinations.${index}` as const}
                      >
                        <div className="flex gap-3">
                          <input
                            {...form.register(`destinations.${index}` as const)}
                            placeholder={index === 0 ? "例: 札幌駅" : "例: 小樽運河"}
                            id={`destination-${index}`}
                            className={inputClass}
                            aria-invalid={!!form.formState.errors.destinations?.[index]}
                          />
                          <button
                            type="button"
                            aria-label={`目的地 ${index + 1}を削除`}
                            onClick={() => removeDestination(index)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-red-200 hover:text-red-600"
                          >
                            削除
                          </button>
                        </div>
                      </Field>
                    ))}
                  </div>
                </div>
              </FormSection>

              <FormSection title="日程と予算" description="日付が確定していない場合は目安でも構いません。後で一覧から再生成できます。">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="開始日"
                    name="startDate"
                    description="出発予定日を選択します。"
                    error={form.formState.errors.startDate?.message}
                    formPath="startDate"
                  >
                    <input
                      type="date"
                      {...form.register("startDate")}
                      id="startDate"
                      className={inputClass}
                      aria-invalid={!!form.formState.errors.startDate}
                    />
                  </Field>
                  <Field
                    label="終了日"
                    name="endDate"
                    description="最終日を選択すると日数を自動で算出します。"
                    error={form.formState.errors.endDate?.message}
                    formPath="endDate"
                  >
                    <input
                      type="date"
                      {...form.register("endDate")}
                      id="endDate"
                      className={inputClass}
                      aria-invalid={!!form.formState.errors.endDate}
                    />
                  </Field>
                </div>
                <Field
                  label="予算（円）"
                  name="budget"
                  description="5,000〜5,000,000円の範囲で入力。おおよその合計金額で問題ありません。"
                  error={form.formState.errors.budget?.message}
                  formPath="budget"
                >
                  <input
                    type="number"
                    min={5000}
                    max={5000000}
                    step={1000}
                    {...form.register("budget", { valueAsNumber: true })}
                      id="budget"
                    className={inputClass}
                    aria-invalid={!!form.formState.errors.budget}
                  />
                </Field>
              </FormSection>

              <FormSection title="旅の目的" description="旅の背景を伝えると、提案されるスポットやアクティビティが最適化されます。">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">旅行目的（最大5件）</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge tone={disableAddPurpose ? "warning" : "neutral"}>
                        残り {Math.max(0, 5 - purposes.length)} 件
                      </StatusBadge>
                      <button
                        type="button"
                        onClick={appendPurpose}
                        disabled={disableAddPurpose}
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        目的を追加
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-red-700">
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold">必須</span>
                    <span>最低 1 件の目的を登録してください。</span>
                  </div>
                  <p className="text-xs text-slate-500">例: 家族旅行 / グルメ / リモートワーク / アクティビティ重視 など</p>
                  <div className="space-y-3">
                    {purposes.map((_, index) => (
                      <Field
                        key={`purpose-${index}`}
                        label={`目的 ${index + 1}`}
                        name={`purpose-${index}`}
                        error={form.formState.errors.purposes?.[index]?.message as string | undefined}
                        formPath={`purposes.${index}` as const}
                      >
                        <div className="flex gap-3">
                          <input
                            {...form.register(`purposes.${index}` as const)}
                            placeholder={index === 0 ? "例: グルメ" : "例: 温泉でリラックス"}
                            id={`purpose-${index}`}
                            className={inputClass}
                            aria-invalid={!!form.formState.errors.purposes?.[index]}
                          />
                          <button
                            type="button"
                            aria-label={`目的 ${index + 1}を削除`}
                            onClick={() => removePurpose(index)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-red-200 hover:text-red-600"
                          >
                            削除
                          </button>
                        </div>
                      </Field>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">同行者人数 (0-20)</p>
                  <p className="text-xs text-slate-500">人数に応じて宿泊プランが変わるため、概数でも入力しておくと安心です。</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {COMPANION_FIELDS.map(([key, label]) => {
                      const errorMap = form.formState.errors.companions as Partial<Record<typeof key, { message?: string }>> | undefined;
                      const errorText = errorMap?.[key]?.message;
                      return (
                        <Field
                          key={key}
                          label={label}
                          name={`companions-${key}`}
                          required={false}
                          error={errorText}
                          formPath={`companions.${key}` as const}
                        >
                          <input
                            type="number"
                            min={0}
                            max={20}
                            {...form.register(`companions.${key}` as const, { valueAsNumber: true })}
                            id={`companions-${key}`}
                            className={inputClass}
                            aria-invalid={!!errorText}
                          />
                        </Field>
                      );
                    })}
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="共有メモ"
                description="特別な制約（例: アレルギー、車いす利用など）があれば記載してください。"
                tone="muted"
              >
                <Field label="備考" name="memo" required={false} error={form.formState.errors.memo?.message} formPath="memo">
                  <textarea
                    {...form.register("memo")}
                    rows={3}
                    placeholder="例: 2日目は午後から合流予定、夜は海鮮を食べたい"
                    id="memo"
                    className={`${inputClass} resize-none`}
                  />
                </Field>
              </FormSection>

              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600" id="form-next-step">
                <p className="text-sm font-semibold text-slate-900">送信前にご確認ください</p>
                <ul className="mt-2 list-disc pl-4 space-y-1">
                  <li>ログイン済みであれば自動的に旅程が保存されます。</li>
                  <li>生成には最大 2 分ほどかかります。完了まで画面を閉じないでください。</li>
                  <li>旅程は必要なときにすぐ見直したり更新できます。</li>
                </ul>
              </div>

              {isSubmitting && (
                <StateCallout
                  variant="info"
                  title="生成ジョブを起動しています"
                  description={(
                    <div className="space-y-2 text-xs text-slate-600">
                      <Loading label="AI がルートとスポットを組み立てています" />
                      <p>完了すると自動的に旅程詳細へ遷移します。画面を開いたまま少々お待ちください。</p>
                      <p>タブを閉じてもジョブはクラウド上で継続します。</p>
                    </div>
                  )}
                />
              )}

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? "生成ジョブを起動中..." : "AIに旅程を生成してもらう"}
                </button>
                <p className="text-xs text-slate-600">送信後は進捗カードが表示され、どの画面へ進めば良いか常に案内します。</p>
              </div>
            </form>
          </FormProvider>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="ログイン / 新規登録" description="メールとパスワードだけで開始できます。表示名は後から変更可能です。">
            <AuthBox onLogin={handleLogin} onRegister={handleRegister} feedback={authFeedback} />
          </SectionCard>

          <SectionCard
            tone="muted"
            title="生成後にできること"
            description="旅程完成後に開ける主な画面です。"
          >
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="rounded-xl border border-slate-200 bg-white/70 p-3">
                <p className="font-semibold">旅程一覧</p>
                <p className="text-xs text-slate-500">作成済みの旅程をまとめて確認し、目的やステータスでサッと絞り込めます。</p>
              </li>
              <li className="rounded-xl border border-slate-200 bg-white/70 p-3">
                <p className="font-semibold">旅程の詳細</p>
                <p className="text-xs text-slate-500">日ごとの予定を追いながら、気になる部分だけ再生成・編集できます。</p>
              </li>
              <li className="rounded-xl border border-slate-200 bg-white/70 p-3">
                <p className="font-semibold">共有・印刷ビュー</p>
                <p className="text-xs text-slate-500">読みやすい紙面でそのまま共有・印刷できます。</p>
              </li>
            </ul>
          </SectionCard>

          <SectionCard title="入力のヒント" description="初回利用の方が迷いやすいポイントをまとめました。">
            <ul className="space-y-2 text-sm text-slate-700">
              {INPUT_TIPS.map((tip) => (
                <li key={tip} className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-3">
                  {tip}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}

type FieldProps = {
  label: string;
  name: string;
  children: React.ReactNode;
  error?: string;
  description?: string;
  helperId?: string;
  required?: boolean;
  formPath?: FieldPath<DraftFormValues>;
};

function Field({ label, name, children, error, description, helperId, required = true, formPath }: FieldProps) {
  const formContext = useFormContext<DraftFormValues>();
  const watchedValue = formPath ? formContext.watch(formPath) : undefined;
  const isFilled = (() => {
    if (!formPath) return false;
    if (watchedValue === undefined || watchedValue === null) return false;
    if (typeof watchedValue === "string") return watchedValue.trim().length > 0;
    if (typeof watchedValue === "number") return true;
    if (typeof watchedValue === "boolean") return watchedValue;
    if (Array.isArray(watchedValue)) return watchedValue.length > 0;
    if (typeof watchedValue === "object") return Object.keys(watchedValue).length > 0;
    return false;
  })();
  const showRequired = required && (!formPath || !isFilled);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <label htmlFor={name} className="font-semibold text-slate-900">
          {label}
        </label>
        {showRequired ? <StatusBadge tone="critical">必須</StatusBadge> : !required ? <StatusBadge tone="neutral">任意</StatusBadge> : null}
      </div>
      {description && (
        <p id={helperId} className="text-xs text-slate-500">
          {description}
        </p>
      )}
      {children}
      {error && (
        <p className="text-xs text-red-600" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

type FormSectionProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  tone?: "default" | "muted";
};

function FormSection({ title, description, children, tone = "default" }: FormSectionProps) {
  return (
    <SectionCard
      as="fieldset"
      title={title}
      description={description}
      tone={tone === "muted" ? "muted" : "default"}
      className="border-dashed border-slate-200"
    >
      <div className="space-y-4">{children}</div>
    </SectionCard>
  );
}

type AuthBoxProps = {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, displayName: string) => Promise<void>;
  feedback: AuthFeedback | null;
};

function AuthBox({ onLogin, onRegister, feedback }: AuthBoxProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const actionButtonClass = "rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition";

  return (
    <section aria-label="認証フォーム" className="space-y-4 text-sm text-slate-700">
      <p className="text-xs text-slate-500">メール / パスワードは社内検証用。取得したトークンはブラウザにのみ保存します。</p>
      <div className="grid gap-3">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">メールアドレス</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
            type="email"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">パスワード (8文字以上)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">表示名（登録時のみ）</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
            placeholder="例: 旅のしおり作成チーム"
          />
          <p className="text-[11px] text-slate-500">旅程の作成者名としてサーバーに保存され、共有ログなどで参照されます。</p>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${actionButtonClass} bg-slate-900 hover:bg-black`} onClick={() => onLogin(email, password)}>
          ログイン
        </button>
        <button type="button" className={`${actionButtonClass} bg-emerald-600 hover:bg-emerald-700`} onClick={() => onRegister(email, password, displayName)}>
          新規登録
        </button>
      </div>
      {feedback && (
        <StateCallout
          variant={feedback.variant === "success" ? "success" : "error"}
          title={feedback.variant === "success" ? "操作が完了しました" : "処理に失敗しました"}
          description={feedback.message}
        />
      )}
    </section>
  );
}
