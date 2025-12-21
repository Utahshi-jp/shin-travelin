import { describe, expect, it } from "vitest";
import { buildScenarioMatrix, buildSummary, resolveJobVariant } from "../ItineraryDetail.helpers";
import type { ScenarioMatrixActivity } from "../ItineraryDetail.types";
import type { ItineraryFormValues } from "@/shared/validation/itinerary.schema";

const baseItinerary: ItineraryFormValues = {
  id: "iti-001",
  title: "北海道サンプル旅程",
  version: 2,
  days: [
    {
      id: "day-0-sunny",
      dayIndex: 0,
      date: "2024-03-01",
      scenario: "SUNNY",
      activities: [
        createActivity({
          time: "09:00",
          area: "札幌駅",
          placeName: "集合と朝食",
          description: "駅ナカで朝食",
          category: "FOOD",
          stayMinutes: 45,
        }),
        createActivity({
          time: "12:30",
          area: "すすきの",
          placeName: "すすきのラーメン",
          description: "味噌ラーメン",
          category: "FOOD",
          stayMinutes: 90,
          orderIndex: 1,
        }),
      ],
    },
    {
      id: "day-0-rainy",
      dayIndex: 0,
      date: "2024-03-01",
      scenario: "RAINY",
      activities: [
        createActivity({
          time: "10:00",
          area: "道立美術館",
          placeName: "屋内観光",
          description: "美術館で鑑賞",
          category: "SIGHTSEEING",
          weather: "RAINY",
        }),
        createActivity({
          time: "12:30",
          area: "二条市場",
          placeName: "市場ランチ",
          description: "屋内で海鮮丼",
          category: "FOOD",
          weather: "RAINY",
          orderIndex: 1,
        }),
      ],
    },
    {
      id: "day-1-sunny",
      dayIndex: 1,
      date: "2024-03-02",
      scenario: "SUNNY",
      activities: [
        createActivity({
          time: "08:00",
          area: "小樽",
          placeName: "小樽運河散策",
          description: "朝の散歩",
        }),
      ],
    },
  ],
};

const itineraryWithUpdatedAt = {
  ...baseItinerary,
  updatedAt: "2025-01-15T03:00:00.000Z",
};

describe("buildSummary", () => {
  it("returns null when itinerary is missing", () => {
    expect(buildSummary(null)).toBeNull();
  });

  it("summarizes day count, version, and last updated info", () => {
    const summary = buildSummary(itineraryWithUpdatedAt as ItineraryFormValues & { updatedAt: string });
    expect(summary?.title).toBe("北海道サンプル旅程");
    const dayItem = summary?.items.find((item) => item.label === "日数");
    expect(dayItem?.value).toBe("2 日");
    const versionItem = summary?.items.find((item) => item.label === "バージョン");
    expect(versionItem?.value).toBe("v2");
    const updatedItem = summary?.items.find((item) => item.label === "最終更新");
    expect(updatedItem?.value).toBeDefined();
    expect(updatedItem?.value).not.toBe("未取得");
  });
});

describe("buildScenarioMatrix", () => {
  it("combines sunny and rainy activities per day and orders slots", () => {
    const matrix = buildScenarioMatrix(baseItinerary);
    expect(matrix).toHaveLength(2);

    const firstDay = matrix[0];
    expect(firstDay.dayIndex).toBe(0);
    expect(firstDay.slots.map((slot) => slot.time)).toEqual(["09:00", "10:00", "12:30"]);
    const noonSlot = firstDay.slots.find((slot) => slot.time === "12:30");
    expect(noonSlot?.sunny?.placeName).toBe("すすきのラーメン");
    expect(noonSlot?.rainy?.placeName).toBe("市場ランチ");

    const secondDay = matrix[1];
    expect(secondDay.dayIndex).toBe(1);
    expect(secondDay.slots).toHaveLength(1);
    expect(secondDay.slots[0].sunny?.placeName).toBe("小樽運河散策");
    expect(secondDay.slots[0].rainy).toBeUndefined();
  });

  it("returns empty array when itinerary is null", () => {
    expect(buildScenarioMatrix(null)).toEqual([]);
  });
});

describe("resolveJobVariant", () => {
  it("maps server statuses to UI variants", () => {
    expect(resolveJobVariant("succeeded")).toBe("success");
    expect(resolveJobVariant("FAILED")).toBe("error");
    expect(resolveJobVariant("running")).toBe("info");
    expect(resolveJobVariant(null)).toBe("info");
  });
});

function createActivity(overrides: Partial<ScenarioMatrixActivity> & { time: string }): ScenarioMatrixActivity {
  return {
    time: overrides.time,
    area: overrides.area ?? "札幌",
    placeName: overrides.placeName ?? "スポット",
    category: overrides.category ?? "SIGHTSEEING",
    description: overrides.description ?? "観光",
    stayMinutes: overrides.stayMinutes ?? 60,
    weather: overrides.weather ?? "SUNNY",
    orderIndex: overrides.orderIndex ?? 0,
  };
}
