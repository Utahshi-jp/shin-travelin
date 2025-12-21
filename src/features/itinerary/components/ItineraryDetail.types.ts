import type { ItineraryFormValues } from "@/shared/validation/itinerary.schema";

// 生成ジョブの現在状態。status と attempts を持たせることで UI が進捗を正しく表示できる。
export type JobState = {
  status: string;
  jobId: string;
  attempts: number;
  message?: string | null;
  partialDays: number[];
};

// 旅程の日別ハイライト。pending/completed/failed を明示してカード上の色分けに使う。
export type Highlights = {
  pending: number[];
  completed: number[];
  failed: number[];
};

// 1アクティビティの構造。ItineraryFormValues に合わせることで型安全な参照が可能になる。
export type ScenarioMatrixActivity = ItineraryFormValues["days"][number]["activities"][number];

// 時間スロット単位で晴天/雨天シナリオをペア表示するための構造。
export type ScenarioMatrixSlot = {
  time: string;
  sunny?: ScenarioMatrixActivity;
  rainy?: ScenarioMatrixActivity;
};

// 1日分のマトリクス。view 層では slots を描画するだけで比較 UI が成立する。
export type ScenarioMatrixDay = {
  dayIndex: number;
  date: string;
  slots: ScenarioMatrixSlot[];
};

// 旅程サマリー。null を許容し、まだデータがない場合でも呼び出し元の分岐を簡単にする。
export type ItinerarySummary = {
  title: string;
  items: Array<{ label: string; value: string; hint?: string }>;
} | null;
