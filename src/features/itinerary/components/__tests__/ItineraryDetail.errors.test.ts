import { describe, expect, it } from "vitest";
import { describeTargetDayError, parseTargetDayErrorDetails } from "../ItineraryDetail.errors";

describe("parseTargetDayErrorDetails", () => {
  it("returns null when raw value is not an object", () => {
    expect(parseTargetDayErrorDetails(null)).toBeNull();
    expect(parseTargetDayErrorDetails("oops")).toBeNull();
  });

  it("filters out non-number entries and keeps valid ranges", () => {
    const details = parseTargetDayErrorDetails({
      invalidIndexes: [0, "a", 3],
      allowedRange: [0, 4],
      dayCount: 5,
    });
    expect(details).toEqual({ invalidIndexes: [0, 3], allowedRange: [0, 4], dayCount: 5 });
  });
});

describe("describeTargetDayError", () => {
  it("describes invalid days with 1-based labels", () => {
    const { message } = describeTargetDayError(7, {
      invalidIndexes: [0, 3],
      allowedRange: [0, 6],
    });
    expect(message).toContain("1 日目");
    expect(message).toContain("4 日目");
  });

  it("falls back to generic guidance when indexes are missing", () => {
    const { message } = describeTargetDayError(5, null);
    expect(message).toBe("旅程の日付は 0 〜 4 日の範囲で指定してください。");
  });
});
