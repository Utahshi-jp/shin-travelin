import { Injectable, Logger } from '@nestjs/common';
import { DayScenario, GenerationJobStatus, Prisma, Weather } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { GeminiProvider, GeminiProviderError } from './providers/gemini.provider';
import { jsonrepair } from 'jsonrepair';

type DraftWithCompanion = Prisma.DraftGetPayload<{ include: { companionDetail: true } }>;

type RunOptions = {
  model: string;
  temperature: number;
  targetDays: number[];
  promptHash: string;
};

type NormalizedActivity = {
  time: string;
  location: string;
  content: string;
  url?: string;
  weather: Weather;
  orderIndex: number;
};

type NormalizedDay = {
  dayIndex: number;
  date: string;
  scenario: DayScenario;
  activities: NormalizedActivity[];
};

type NormalizedDayResult = {
  days: NormalizedDay[];
  llmDayCount: number;
  llmDayIndexes: number[];
};

const activitySchema = z.object({
  time: z.string().min(1),
  location: z.string().optional(),
  content: z.string().optional(),
  url: z.string().url().max(500).optional().or(z.literal('')),
  weather: z.string().optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
});

const daySchema = z.object({
  // Why: LLM 出力では dayIndex が文字列で返るケースがあるため number coercion を許可。
  dayIndex: z.coerce.number().int().min(0),
  date: z.string(),
  // Why: Gemini sometimes omits scenario even though prompt enforces it; allow fallback to SUNNY during normalization。
  scenario: z.string().min(3).max(10).optional(),
  // Why: activities 内の欠落値は後段で個別検証し、不正項目のみ除去する。
  activities: z.array(z.any()).default([]),
});

const itinerarySchema = z.object({
  title: z.string().min(1).max(120),
  days: z.array(daySchema).min(1),
});

// Why: detail-design §4.2/AI-3 expects partial success to be reflected explicitly; we keep enum as SUCCEEDED but surface partialDays via error code.
const PARTIAL_SUCCESS_STATUS = GenerationJobStatus.SUCCEEDED;

const BACKOFF = [1000, 3000, 7000, 15000]; // Why: 503/429 を吸収するため試行を増やし、後半は長めに待つ。
const MIN_ACTIVITIES_PER_SCENARIO = 4;
const DEFAULT_TIME_SLOTS = ['09:00', '11:30', '14:30', '18:00', '20:00'];

function sleep(ms: number) {
  if (process.env.NODE_ENV === 'test') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preview(value: unknown, limit = 1500) {
  try {
    if (typeof value === 'string') {
      return value.length > limit ? `${value.slice(0, limit)}…` : value;
    }
    const serialized = JSON.stringify(value);
    return serialized.length > limit ? `${serialized.slice(0, limit)}…` : serialized;
  } catch {
    return '[unserializable]';
  }
}

// Why: Gemini はしばしば ```json ... ``` を付けるため、前後のフェンス/余計な文章を除去してパーサを安定化する。
export function stripCodeFence(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();

  // Fallback: handle missing closing fence or leading fence without closing by stripping first fence line.
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split(/\r?\n/);
    // drop first line (``` or ```json)
    const withoutHead = lines.slice(1).join('\n');
    const withoutTail = withoutHead.replace(/```\s*$/, '');
    const candidate = withoutTail.trim();
    if (candidate.startsWith('{') || candidate.startsWith('[')) return candidate;
  }

  // As a last resort, try to extract from first '{' to last '}' to recover partial JSON.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }

  return trimmed;
}

@Injectable()
export class AiPipeline {
  private readonly logger = new Logger(AiPipeline.name);

  constructor(private readonly prisma: PrismaService, private readonly gemini: GeminiProvider) {}

  private buildPrompt(draft: DraftWithCompanion, targetDays: number[], totalDates: string[]): string {
    const daysText = targetDays.length ? targetDays.map((d) => totalDates[d]).filter(Boolean) : totalDates;

    const schemaDescription = `JSON schema:
{
  "title": string (1-120 chars),
  "days": [
    {
      "dayIndex": number (0-based),
      "date": ISO-8601 date string,
      "scenario": "SUNNY" | "RAINY",
      "activities": [
        { "time": "HH:mm", "location": string(1-200), "content": string(1-500), "url"?: string, "weather": string, "orderIndex": number }
      ]
    }
  ]
}`;

    return [
      'You are a travel planner. Generate concise itinerary JSON only.',
      `Origin: ${draft.origin}`,
      `Destinations: ${draft.destinations.join(', ')}`,
      `Date range: ${draft.startDate.toISOString().slice(0, 10)} to ${draft.endDate.toISOString().slice(0, 10)}`,
      `Budget: ${draft.budget}`,
      `Purposes: ${draft.purposes.join(', ')}`,
      `Companions: ${JSON.stringify(draft.companionDetail ?? {})}`,
      `Target days: ${targetDays.length ? targetDays.join(',') : 'all'}`,
      'Output rules:',
      '- すべての項目（title, activities.location, activities.content, weather）は自然な日本語で書く。',
      '- 各日・各シナリオで朝/昼/午後/夜の少なくとも4アクティビティを時系列で用意する。',
      '- time は 24時間表記 HH:mm (例: 09:30) でゼロ埋めする。',
      '- location は具体的なスポット名を200文字以内で書く。',
      '- content は1文で体験内容を説明し、雨天シナリオでは屋内プランにする。',
      '- weather は日本語または SUNNY/RAINY のいずれかを指定し、orderIndex は0から昇順。',
      '- 同じ日付の "SUNNY" と "RAINY" は同じ時間帯セット (例: 09:00/11:30/14:30/18:00) を共有し、切り替え比較しやすくする。',
      'For each date you MUST output two entries: scenario SUN=outdoor focus ("scenario":"SUNNY") and scenario RAIN=indoor focus ("scenario":"RAINY") sharing the same dayIndex/date.',
      'Keep SUNNY/RAINY scenarios for the same day within short travel distance to allow quick weather-based switching.',
      schemaDescription,
      'Respond with pure JSON. No code fences, no explanations.',
      'Ensure dayIndex matches the chronological order of date values.',
      daysText.length ? `Dates: ${daysText.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildRepairPrompt(basePrompt: string, lastError: string, expectedSchema: string) {
    return `${basePrompt}\nPrevious output failed because: ${lastError}. Please regenerate valid JSON that matches: ${expectedSchema}`;
  }

  private parseJsonWithRepair(text: string) {
    // First try strict JSON; if it fails, attempt a light repair (common: unterminated string, trailing commas).
    try {
      return JSON.parse(text);
    } catch (_) {
      try {
        return JSON.parse(jsonrepair(text));
      } catch (err) {
        throw err;
      }
    }
  }

  private expandDates(start: Date, end: Date): string[] {
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private normalizeDays(
    days: unknown[],
    context: { draft: DraftWithCompanion; totalDates: string[]; expectedDayIndexes: number[] },
  ): NormalizedDayResult {
    const dayMap = new Map<string, NormalizedDay>();
    let llmDayCount = 0;
    const llmDayIndexes = new Set<number>();
    for (const day of days) {
      const result = daySchema.safeParse(day);
      if (!result.success) continue;

      const scenario = this.normalizeScenario(result.data.scenario);
      if (!scenario) continue;

      const resolvedDate = this.normalizeDate(result.data.date, result.data.dayIndex, context.totalDates);
      const normalizedActivities = this.normalizeActivities(result.data.activities, {
        scenario,
        dayIndex: result.data.dayIndex,
        draft: context.draft,
      });
      const hydrated = this.ensureMinimumActivities(normalizedActivities, {
        scenario,
        dayIndex: result.data.dayIndex,
        date: resolvedDate,
        draft: context.draft,
      });

      const key = `${result.data.dayIndex}-${scenario}`;
      dayMap.set(key, { dayIndex: result.data.dayIndex, date: resolvedDate, scenario, activities: hydrated });
      llmDayCount += 1;
      llmDayIndexes.add(result.data.dayIndex);
    }

    context.expectedDayIndexes.forEach((dayIndex) => {
      const date = this.normalizeDate(undefined, dayIndex, context.totalDates);
      (['SUNNY', 'RAINY'] as DayScenario[]).forEach((scenario) => {
        const key = `${dayIndex}-${scenario}`;
        if (dayMap.has(key)) return;
        const fallback = this.ensureMinimumActivities([], {
          scenario,
          dayIndex,
          date,
          draft: context.draft,
        });
        dayMap.set(key, { dayIndex, date, scenario, activities: fallback });
      });
    });

    return {
      days: Array.from(dayMap.values()).sort((a, b) => {
      if (a.dayIndex === b.dayIndex) {
        if (a.scenario === b.scenario) return 0;
        return a.scenario === DayScenario.SUNNY ? -1 : 1;
      }
      return a.dayIndex - b.dayIndex;
      }),
      llmDayCount,
      llmDayIndexes: Array.from(llmDayIndexes),
    };
  }

  private normalizeActivities(
    activities: unknown[],
    context: { scenario: DayScenario; dayIndex: number; draft: DraftWithCompanion },
  ) {
    const normalized: NormalizedActivity[] = [];
    activities.forEach((activity, idx) => {
      if (!activity || typeof activity !== 'object') return;
      const candidate = activitySchema.safeParse(activity);
      if (!candidate.success) return;

      const data = candidate.data;
      const time = this.normalizeTime(data.time, idx);
      const location = this.normalizeLocation(data.location, context, idx);
      const content = this.normalizeContent(data.content, context, idx);
      const url = data.url && data.url.trim().length ? data.url.trim() : undefined;
      const weather = this.normalizeWeatherField(data.weather, context.scenario);
      const orderIndex = Number.isFinite(data.orderIndex) ? Number(data.orderIndex) : normalized.length;

      normalized.push({ time, location, content, url, weather, orderIndex });
    });
    return normalized;
  }

  private normalizeScenario(value?: string): DayScenario | null {
    if (!value) return DayScenario.SUNNY;
    const upper = value.trim().toUpperCase();
    if (upper.startsWith('RAIN')) return DayScenario.RAINY;
    if (upper.startsWith('SUN')) return DayScenario.SUNNY;
    return DayScenario.SUNNY;
  }

  private normalizeDate(value: string | undefined, dayIndex: number, totalDates: string[]) {
    const fallback = totalDates[dayIndex] ?? totalDates[totalDates.length - 1] ?? new Date().toISOString().slice(0, 10);
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      return fallback;
    }
    return parsed.toISOString().slice(0, 10);
  }

  private ensureMinimumActivities(
    activities: NormalizedActivity[],
    context: { scenario: DayScenario; dayIndex: number; date: string; draft: DraftWithCompanion },
  ) {
    const sorted = [...activities].sort((a, b) => a.orderIndex - b.orderIndex);
    sorted.forEach((activity, idx) => {
      activity.orderIndex = idx;
    });

    if (sorted.length >= MIN_ACTIVITIES_PER_SCENARIO) return sorted;

    const usedTimes = new Set(sorted.map((activity) => activity.time));
    const fallbacks = this.buildFallbackActivities(context);
    for (const fallback of fallbacks) {
      if (sorted.length >= MIN_ACTIVITIES_PER_SCENARIO) break;
      let time = fallback.time;
      let attempt = 1;
      while (usedTimes.has(time) && attempt < 6) {
        time = this.shiftTime(fallback.time, attempt * 15);
        attempt += 1;
      }
      usedTimes.add(time);
      sorted.push({ ...fallback, time, orderIndex: sorted.length });
    }
    return sorted;
  }

  private buildFallbackActivities(context: { scenario: DayScenario; dayIndex: number; date: string; draft: DraftWithCompanion }) {
    const baseDestination = this.resolvePrimaryDestination(context.draft, context.dayIndex);
    const dayLabel = `Day ${context.dayIndex + 1}`;
    const scenarioLabel = context.scenario === DayScenario.SUNNY ? '屋外' : '屋内';
    const weather = context.scenario === DayScenario.SUNNY ? Weather.SUNNY : Weather.RAINY;
    const templates = [
      {
        time: DEFAULT_TIME_SLOTS[0],
        location: `${baseDestination} 朝の散策`,
        content: `${dayLabel}は${scenarioLabel}でゆったりスタート。街歩きで雰囲気を感じます。`,
      },
      {
        time: DEFAULT_TIME_SLOTS[1],
        location: `${baseDestination} ローカルカフェ`,
        content: `${baseDestination}の名物を味わいながら昼食と休憩を取ります。`,
      },
      {
        time: DEFAULT_TIME_SLOTS[2],
        location: `${baseDestination} 文化体験`,
        content: `${scenarioLabel}プランで午後の観光スポットを訪れ、歴史や文化を学びます。`,
      },
      {
        time: DEFAULT_TIME_SLOTS[3],
        location: `${baseDestination} ディナー`,
        content: `${baseDestination}のおすすめ料理と夜の雰囲気を楽しみ、1日を締めくくります。`,
      },
    ];

    return templates.map((template, idx) => ({
      ...template,
      weather,
      orderIndex: idx,
    }));
  }

  private normalizeTime(value: string | undefined, slotIndex: number) {
    const fallback = DEFAULT_TIME_SLOTS[Math.min(slotIndex, DEFAULT_TIME_SLOTS.length - 1)];
    if (!value) return fallback;

    const colonMatch = value.match(/(\d{1,2})[:：](\d{1,2})/);
    if (colonMatch) {
      const hour = this.clampHour(parseInt(colonMatch[1], 10));
      const minute = this.clampMinute(parseInt(colonMatch[2], 10));
      return this.formatTime(hour, minute);
    }

    const digitsOnly = value.replace(/[^\d]/g, '');
    if (digitsOnly.length >= 3) {
      const hourDigits = digitsOnly.slice(0, digitsOnly.length - 2);
      const minuteDigits = digitsOnly.slice(-2);
      const hour = this.clampHour(parseInt(hourDigits, 10));
      const minute = this.clampMinute(parseInt(minuteDigits, 10));
      return this.formatTime(hour, minute);
    }

    const hourMatch = value.match(/\d{1,2}/);
    if (hourMatch) {
      const hour = this.clampHour(parseInt(hourMatch[0], 10));
      return this.formatTime(hour, 0);
    }

    return fallback;
  }

  private normalizeLocation(value: string | undefined, context: { scenario: DayScenario; dayIndex: number; draft: DraftWithCompanion }, idx: number) {
    if (value && value.trim().length) {
      return value.trim().slice(0, 200);
    }
    const base = this.resolvePrimaryDestination(context.draft, context.dayIndex);
    const suffix = context.scenario === DayScenario.SUNNY ? '屋外スポット' : '屋内スポット';
    return `${base}の${suffix}${idx + 1}`;
  }

  private normalizeContent(value: string | undefined, context: { scenario: DayScenario; dayIndex: number; draft: DraftWithCompanion }, idx: number) {
    if (value && value.trim().length) {
      return value.trim().slice(0, 500);
    }
    const base = this.resolvePrimaryDestination(context.draft, context.dayIndex);
    const scenarioText = context.scenario === DayScenario.SUNNY ? '屋外で' : '屋内で';
    const templates = [
      `${base}で${scenarioText}朝の空気を楽しみながらウォームアップします。`,
      `${base}の名物ランチをゆっくり味わいます。`,
      `${base}ならではの文化・体験スポットを巡って午後を過ごします。`,
      `${base}の夜景や食体験で1日を締めくくります。`,
    ];
    return templates[Math.min(idx, templates.length - 1)];
  }

  private normalizeWeatherField(value: string | undefined, scenario: DayScenario): Weather {
    if (!value) return scenario === DayScenario.SUNNY ? Weather.SUNNY : Weather.RAINY;
    const upper = value.trim().toUpperCase();
    if (upper.includes('RAIN') || upper.includes('RAINY') || upper.includes('雨')) return Weather.RAINY;
    if (upper.includes('SUN') || upper.includes('晴')) return Weather.SUNNY;
    if (upper.includes('CLOUD')) return Weather.CLOUDY;
    return scenario === DayScenario.SUNNY ? Weather.SUNNY : Weather.RAINY;
  }

  private resolvePrimaryDestination(draft: DraftWithCompanion, dayIndex: number) {
    if (Array.isArray(draft.destinations) && draft.destinations.length) {
      const withinRange = draft.destinations[dayIndex];
      if (withinRange && withinRange.trim().length) return withinRange.trim();
      const first = draft.destinations.find((dest) => dest && dest.trim().length);
      if (first) return first.trim();
    }
    return draft.origin;
  }

  private shiftTime(base: string, minutes: number) {
    const totalMinutes = this.timeToMinutes(base) + minutes;
    const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return this.formatTime(hour, minute);
  }

  private timeToMinutes(time: string) {
    const [hourStr, minuteStr] = time.split(':');
    const hour = this.clampHour(parseInt(hourStr ?? '0', 10));
    const minute = this.clampMinute(parseInt(minuteStr ?? '0', 10));
    return hour * 60 + minute;
  }

  private formatTime(hour: number, minute: number) {
    const h = this.clampHour(hour).toString().padStart(2, '0');
    const m = this.clampMinute(minute).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private clampHour(value: number) {
    if (!Number.isFinite(value)) return 9;
    if (value < 0) return 0;
    if (value > 23) return 23;
    return value;
  }

  private clampMinute(value: number) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 59) return 59;
    return value;
  }

  async run(jobId: string, correlationId: string, options: RunOptions) {
    // Mark running before performing LLM call; this ensures status is accurate even if downstream fails。
    const job = await this.prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.RUNNING,
        startedAt: new Date(),
        model: options.model,
        temperature: options.temperature,
        targetDays: options.targetDays,
        promptHash: options.promptHash,
      },
      include: { draft: { include: { companionDetail: true } } },
    });

    const draft = job.draft as DraftWithCompanion;
    const totalDates = this.expandDates(draft.startDate, draft.endDate);
    const expectedDayIndexes = (options.targetDays.length ? options.targetDays : totalDates.map((_, idx) => idx)).filter(
      (idx) => Number.isFinite(idx) && idx >= 0,
    );
    const expectedDaySet = new Set(expectedDayIndexes);
    const expectedSchema = itinerarySchema.toString();
    const basePrompt = this.buildPrompt(draft, options.targetDays ?? [], totalDates);

    let lastError = '';
    let attempt = 0;
    const maxAttempts = BACKOFF.length + 1;

    for (attempt = 0; attempt < maxAttempts; attempt++) {
      const prompt = attempt === 0 ? basePrompt : this.buildRepairPrompt(basePrompt, lastError, expectedSchema);

      try {
        const providerResult = await this.gemini.generate(prompt, options.model, options.temperature);
        const cleaned = stripCodeFence(providerResult.rawText);

        let parsedJson: any;
        try {
          parsedJson = this.parseJsonWithRepair(cleaned);
        } catch (parseErr) {
          lastError = `parse_error: ${(parseErr as Error).message}`;
          await this.writeAudit(jobId, correlationId, {
            prompt,
            request: providerResult.request as Prisma.InputJsonValue,
            rawResponse: typeof providerResult.rawResponse === 'string' ? providerResult.rawResponse : JSON.stringify(providerResult.rawResponse),
            parsed: undefined,
            status: GenerationJobStatus.RUNNING,
            retryCount: attempt,
            model: options.model,
            temperature: options.temperature,
            errorMessage: lastError,
          });
          if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
          continue;
        }

        const baseResult = itinerarySchema.safeParse(parsedJson);
        const dayCandidates = this.extractDayCandidates(parsedJson?.days);
        const normalization = this.normalizeDays(dayCandidates, {
          draft,
          totalDates,
          expectedDayIndexes,
        });
        const validDays = normalization.days;
        if (normalization.llmDayCount === 0) {
          lastError = 'schema_error: no valid llm days';
          this.logger.warn({
            jobId,
            correlationId,
            event: 'LLM_SCHEMA_DEBUG',
            reason: 'no_llm_days',
            preview: preview(cleaned),
            sampleDays: preview(dayCandidates.slice(0, 2)),
          });
          await this.writeAudit(jobId, correlationId, {
            prompt,
            request: providerResult.request as Prisma.InputJsonValue,
            rawResponse: typeof providerResult.rawResponse === 'string' ? providerResult.rawResponse : JSON.stringify(providerResult.rawResponse),
            parsed: undefined,
            status: GenerationJobStatus.RUNNING,
            retryCount: attempt,
            model: options.model,
            temperature: options.temperature,
            errorMessage: lastError,
          });
          if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
          continue;
        }

        const requiredScenarioCount = expectedDayIndexes.length * 2;
        const allDaysValid = baseResult.success && normalization.llmDayCount === requiredScenarioCount;

        const partialDays = Array.from(
          new Set(normalization.llmDayIndexes.filter((dayIndex) => expectedDaySet.has(dayIndex))),
        ).sort((a, b) => a - b);
        const parsed: Prisma.JsonObject = {
          title: baseResult.success ? baseResult.data.title : parsedJson.title ?? 'untitled',
          days: validDays,
        } as Prisma.JsonObject;

        const status = allDaysValid ? GenerationJobStatus.SUCCEEDED : PARTIAL_SUCCESS_STATUS;
        const errorMessage = allDaysValid ? null : ErrorCode.AI_PARTIAL_SUCCESS;

        await this.prisma.$transaction([
          this.prisma.aiGenerationAudit.create({
            data: {
              id: randomUUID(),
              jobId,
              correlationId,
              prompt,
              request: providerResult.request as Prisma.InputJsonValue,
              rawResponse: typeof providerResult.rawResponse === 'string' ? providerResult.rawResponse : JSON.stringify(providerResult.rawResponse),
              parsed,
              status,
              retryCount: attempt,
              model: options.model,
              temperature: options.temperature,
              errorMessage,
            },
          }),
          this.prisma.generationJob.update({
            where: { id: jobId },
            data: {
              status,
              partialDays,
              retryCount: attempt,
              finishedAt: new Date(),
              error: errorMessage,
            },
          }),
        ]);

        this.logger.log({ jobId, correlationId, status, partialDays });
        return { status, partialDays, parsed, error: errorMessage ?? undefined };
      } catch (err) {
        const providerErr = err as GeminiProviderError | Error;
        const isRetryable =
          (providerErr instanceof GeminiProviderError && [408, 429, 500, 502, 503, 504].includes(providerErr.status)) ||
          (providerErr instanceof Error && /ECONNRESET|ETIMEDOUT|fetch failed|ENOTFOUND/i.test(providerErr.message));

        lastError = providerErr instanceof GeminiProviderError ? `provider_error_${providerErr.status}` : providerErr.message ?? 'provider_error';
        await this.writeAudit(jobId, correlationId, {
          prompt,
          request: undefined,
          rawResponse: providerErr instanceof GeminiProviderError ? providerErr.body : undefined,
          parsed: undefined,
          status: GenerationJobStatus.RUNNING,
          retryCount: attempt,
          model: options.model,
          temperature: options.temperature,
          errorMessage: lastError,
        });
        if (isRetryable && attempt < maxAttempts - 1) {
          await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
          continue;
        }
        break;
      }
    }

    const finalError = lastError || ErrorCode.AI_RETRY_EXHAUSTED;
    await this.prisma.$transaction([
      this.prisma.aiGenerationAudit.create({
        data: {
          id: randomUUID(),
          jobId,
          correlationId,
          prompt: basePrompt,
          request: undefined,
          rawResponse: undefined,
          parsed: undefined,
          status: GenerationJobStatus.FAILED,
          retryCount: attempt,
          model: options.model,
          temperature: options.temperature,
          errorMessage: finalError,
        },
      }),
      this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: GenerationJobStatus.FAILED,
          error: finalError,
          retryCount: attempt,
          finishedAt: new Date(),
        },
      }),
    ]);

    this.logger.error({ jobId, correlationId, error: finalError });
    return { status: GenerationJobStatus.FAILED, error: finalError };
  }

  private extractDayCandidates(input: unknown): unknown[] {
    if (Array.isArray(input)) return input;
    if (input && typeof input === 'object') {
      // Why: Gemini が { "day0": {...}, "day1": {...} } のような連想オブジェクトを返すことがあり得るため値を配列化する。
      return Object.values(input as Record<string, unknown>);
    }
    return [];
  }

  private async writeAudit(jobId: string, correlationId: string, data: {
    prompt: string;
    request?: Prisma.InputJsonValue;
    rawResponse?: string;
    parsed?: Prisma.JsonObject;
    status: GenerationJobStatus;
    retryCount: number;
    model: string;
    temperature: number;
    errorMessage?: string | null;
  }) {
    await this.prisma.aiGenerationAudit.create({
      data: {
        id: randomUUID(),
        jobId,
        correlationId,
        prompt: data.prompt,
        request: data.request,
        rawResponse: data.rawResponse,
        parsed: data.parsed,
        status: data.status,
        retryCount: data.retryCount,
        model: data.model,
        temperature: data.temperature,
        errorMessage: data.errorMessage ?? undefined,
      },
    });
  }
}
