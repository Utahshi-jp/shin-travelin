import { z } from "zod";

// FR-1/2 クライアント側で守ることで無駄なリクエストを減らし、422を早期に防ぐ。
export const draftFormSchema = z
  .object({
    origin: z.string().min(3, "3文字以上").max(200, "200文字以下"), // 短すぎる地点名や長すぎる入力を拒否しLLMプロンプト暴走を防ぐ。
    destinations: z.array(z.string().min(3, "3文字以上").max(200, "200文字以下")).min(1, "1件以上").max(5, "5件まで"), // 5件制限はペルソナ設計の負荷上限。
    startDate: z.string().min(1, "開始日を入力してください"),
    endDate: z.string().min(1, "終了日を入力してください"),
    budget: z
      .number()
      .min(5000, "最低5,000円") // 極端に低い予算での生成を防ぐ。
      .max(5_000_000, "上限は5,000,000円"), // 上限はAPI側の計算負荷を抑制。
    purposes: z.array(z.string().min(1, "1文字以上")).min(1, "1件以上").max(5, "5件まで"),
    memo: z.string().max(500, "500文字以内").optional().or(z.literal("")),
    companions: z.object({
      adultMale: z.number().min(0).max(20),
      adultFemale: z.number().min(0).max(20),
      boy: z.number().min(0).max(20),
      girl: z.number().min(0).max(20),
      infant: z.number().min(0).max(20),
      pet: z.number().min(0).max(20),
      other: z.number().min(0).max(20),
    }),
  })
  .refine((v) => new Date(v.startDate) <= new Date(v.endDate), {
    message: "終了日は開始日以降を指定してください",
    path: ["endDate"],
  }); // 日付逆転はFR-1の前提を破るため早期ブロック。

export type DraftFormValues = z.infer<typeof draftFormSchema>;
