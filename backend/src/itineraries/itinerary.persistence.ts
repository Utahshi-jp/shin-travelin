import { DayScenario, Prisma, SpotCategory, Weather } from '@prisma/client';

export type PersistActivityInput = {
  time: string;
  area: string;
  placeName?: string | null;
  category: string;
  description: string;
  stayMinutes?: number | null;
  weather?: string | null;
  orderIndex?: number | null;
};

export type PersistDayInput = {
  dayIndex: number;
  date: string | Date;
  scenario?: string;
  activities: PersistActivityInput[];
};

export type PersistItineraryInput = {
  userId: string;
  draftId: string;
  title: string;
  days: PersistDayInput[];
  rawJson?: Prisma.InputJsonValue;
  promptHash?: string | null;
  model?: string | null;
  jobId?: string;
};

export async function persistItineraryGraph(
  tx: Prisma.TransactionClient,
  input: PersistItineraryInput,
) {
  if (!input.days || input.days.length === 0) {
    throw new Error('Itinerary requires at least one day');
  }

  const sortedDays = sortDays(input.days);
  const itinerary = await tx.itinerary.create({
    data: {
      userId: input.userId,
      draftId: input.draftId,
      title: input.title,
    },
  });

  for (const day of sortedDays) {
    const dayRow = await tx.itineraryDay.create({
      data: {
        itineraryId: itinerary.id,
        dayIndex: day.dayIndex,
        date: typeof day.date === 'string' ? new Date(day.date) : day.date,
        scenario: normalizeScenario(day.scenario),
      },
    });

    if (day.activities && day.activities.length) {
      await tx.activity.createMany({
        data: day.activities.map((activity, idx) => ({
          itineraryDayId: dayRow.id,
          time: activity.time,
          area: activity.area,
          placeName: activity.placeName ?? null,
          category: normalizeCategory(activity.category),
          description: activity.description,
          stayMinutes: activity.stayMinutes ?? null,
          weather: normalizeWeather(activity.weather),
          orderIndex: Number.isFinite(activity.orderIndex)
            ? Number(activity.orderIndex)
            : idx,
        })),
      });
    }
  }

  await tx.itineraryRaw.create({
    data: {
      itineraryId: itinerary.id,
      rawJson:
        input.rawJson ??
        ({
          title: input.title,
          days: sortedDays,
        } as Prisma.InputJsonValue),
      promptHash: input.promptHash ?? 'pending-hash',
      model: input.model ?? 'gemini-pro',
    },
  });

  if (input.jobId) {
    await tx.generationJob.update({
      where: { id: input.jobId },
      data: { itineraryId: itinerary.id },
    });
  }

  return itinerary;
}

function normalizeCategory(value?: string): SpotCategory {
  if (!value) return SpotCategory.SIGHTSEEING;
  const upper = value.trim().toUpperCase();
  if (
    (Object.keys(SpotCategory) as Array<keyof typeof SpotCategory>).includes(
      upper as keyof typeof SpotCategory,
    )
  ) {
    return SpotCategory[upper as keyof typeof SpotCategory];
  }
  switch (upper) {
    case 'FOOD':
      return SpotCategory.FOOD;
    case 'MOVE':
      return SpotCategory.MOVE;
    case 'REST':
      return SpotCategory.REST;
    case 'STAY':
      return SpotCategory.STAY;
    case 'SHOPPING':
      return SpotCategory.SHOPPING;
    case 'SIGHTSEEING':
      return SpotCategory.SIGHTSEEING;
    default:
      return SpotCategory.OTHER;
  }
}

export function sortDays<T extends { dayIndex: number; scenario?: string }>(
  days: T[],
): T[] {
  return [...days].sort((a, b) => {
    if (a.dayIndex === b.dayIndex) {
      const aScenario = normalizeScenario(a.scenario);
      const bScenario = normalizeScenario(b.scenario);
      if (aScenario === bScenario) return 0;
      return aScenario === DayScenario.SUNNY ? -1 : 1;
    }
    return a.dayIndex - b.dayIndex;
  });
}

function normalizeScenario(value?: string): DayScenario {
  if (!value) return DayScenario.SUNNY;
  const upper = value.trim().toUpperCase();
  if (upper.startsWith('RAIN')) return DayScenario.RAINY;
  return DayScenario.SUNNY;
}

function normalizeWeather(value?: string | null): Weather {
  if (!value) return Weather.UNKNOWN;
  const upper = value.trim().toUpperCase();
  if (upper === Weather.SUNNY) return Weather.SUNNY;
  if (upper === Weather.RAINY) return Weather.RAINY;
  if (upper === Weather.CLOUDY) return Weather.CLOUDY;
  if (upper === Weather.UNKNOWN) return Weather.UNKNOWN;
  return Weather.UNKNOWN;
}
