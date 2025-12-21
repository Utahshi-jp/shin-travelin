// 部分再生成時の targetDays バリデーションをユーザーに伝えるためのユーティリティ群。
export type TargetDayErrorDetails = {
  invalidIndexes?: number[];
  allowedRange?: [number, number];
  dayCount?: number;
};

// API から返る details を安全にパースし、`unknown` をそのまま UI へ渡さないようにする。
export function parseTargetDayErrorDetails(raw: unknown): TargetDayErrorDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  const invalidIndexes = Array.isArray(candidate.invalidIndexes)
    ? candidate.invalidIndexes.filter((value): value is number => typeof value === "number")
    : undefined;

  let allowedRange: [number, number] | undefined;
  if (Array.isArray(candidate.allowedRange) && candidate.allowedRange.length === 2) {
    const [start, end] = candidate.allowedRange;
    if (typeof start === "number" && typeof end === "number") {
      allowedRange = [start, end];
    }
  }

  const dayCount = typeof candidate.dayCount === "number" ? candidate.dayCount : undefined;

  if (!invalidIndexes && !allowedRange && dayCount === undefined) return null;
  return { invalidIndexes, allowedRange, dayCount };
}

// dayCount だけでなく API details の内容を加味し、具体的な案内文に変換する。
export function describeTargetDayError(
  dayCount: number,
  details: TargetDayErrorDetails | null,
): { message: string; invalidIndexes?: number[] } {
  const upperBound = details?.allowedRange?.[1] ?? Math.max(0, dayCount - 1);

  if (!details?.invalidIndexes?.length) {
    return {
      message: `旅程の日付は 0 〜 ${upperBound} 日の範囲で指定してください。`,
    };
  }

  const labels = details.invalidIndexes.map((idx) => `${idx + 1} 日目`).join(", ");
  return {
    message: `選択した日 (${labels}) が範囲外です。指定可能な日数は 0 〜 ${upperBound} です。`,
    invalidIndexes: details.invalidIndexes,
  };
}
