import { ItineraryFormValues } from "@/shared/validation/itinerary.schema";

export function sanitizeItinerary(itinerary: ItineraryFormValues | null): ItineraryFormValues | null {
  if (!itinerary) return null;
  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      date: normalizeDateField(day.date),
      activities: (day.activities ?? []).map((activity) => ({
        ...activity,
        time: normalizeTimeField(activity.time),
        area: activity.area ?? "",
        placeName: activity.placeName ?? "",
        category: activity.category ?? "SIGHTSEEING",
        description: activity.description ?? "",
        stayMinutes: normalizeStayMinutesField(activity.stayMinutes),
        weather: activity.weather ?? "UNKNOWN",
      })),
    })),
  };
}

function normalizeTimeField(value?: string) {
  if (!value) return "09:00";
  const match = value.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const hour = clamp(Number(match[1]), 0, 23);
    const minute = clamp(Number(match[2]), 0, 59);
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length >= 3) {
    const hour = clamp(Number(digits.slice(0, digits.length - 2)), 0, 23);
    const minute = clamp(Number(digits.slice(-2)), 0, 59);
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }
  return "09:00";
}

function normalizeDateField(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function normalizeStayMinutesField(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return undefined;
  const clamped = Math.max(5, Math.min(Number(value), 1440));
  return clamped;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
