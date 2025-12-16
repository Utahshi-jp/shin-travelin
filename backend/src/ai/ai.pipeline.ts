import { Injectable, Logger } from '@nestjs/common';
import { GenerationJobStatus, Prisma, Weather } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { GeminiProvider, GeminiProviderError } from './providers/gemini.provider';
import { jsonrepair } from 'jsonrepair';

type RunOptions = {
  model: string;
  temperature: number;
  targetDays: number[];
  promptHash: string;
};

const activitySchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().min(1).max(200),
  content: z.string().min(1).max(500),
  url: z.string().url().max(500).optional().or(z.literal('')),
  weather: z.string().min(3).max(20).optional(),
  orderIndex: z.number().int().min(0),
});

const daySchema = z.object({
  dayIndex: z.number().int().min(0),
  date: z.string(),
  activities: z.array(activitySchema),
});

const itinerarySchema = z.object({
  title: z.string().min(1).max(120),
  days: z.array(daySchema).min(1),
});

const BACKOFF = [1000, 3000, 7000, 15000]; // Why: 503/429 を吸収するため試行を増やし、後半は長めに待つ。

function sleep(ms: number) {
  if (process.env.NODE_ENV === 'test') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  private buildPrompt(draft: any, targetDays: number[]): string {
    const totalDays = this.expandDates(draft.startDate, draft.endDate);
    const daysText = targetDays.length ? targetDays.map((d) => totalDays[d]).filter(Boolean) : totalDays;

    const schemaDescription = `JSON schema:
{
  "title": string (1-120 chars),
  "days": [
    {
      "dayIndex": number (0-based),
      "date": ISO-8601 date string,
      "activities": [
        { "time": "HH:mm", "location": string(1-200), "content": string(1-500), "url"?: string, "weather": string, "orderIndex": number }
      ]
    }
  ]
}`;

    // Why: promptは detail-design に沿って schema を明示し、dayIndex/date の対応を固定化する。
    return [
      'You are a travel planner. Generate concise itinerary JSON only.',
      `Origin: ${draft.origin}`,
      `Destinations: ${draft.destinations.join(', ')}`,
      `Date range: ${draft.startDate.toISOString().slice(0, 10)} to ${draft.endDate.toISOString().slice(0, 10)}`,
      `Budget: ${draft.budget}`,
      `Purposes: ${draft.purposes.join(', ')}`,
      `Companions: ${JSON.stringify(draft.companionDetail ?? {})}`,
      `Target days: ${targetDays.length ? targetDays.join(',') : 'all'}`,
      'Output rules: maintain chronological order; start time >=09:00; include breaks; provide weather as text; orderIndex ascending.',
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

  private normalizeDays(days: unknown[]) {
    const validDays: { dayIndex: number; date: string; activities: any[] }[] = [];
    for (const day of days) {
      const result = daySchema.safeParse(day);
      if (result.success) {
        const normalizedActivities = result.data.activities.map((a, idx) => ({
          ...a,
          url: a.url || undefined,
          weather: (a.weather ?? 'UNKNOWN') as Weather,
          orderIndex: Number.isFinite(a.orderIndex) ? a.orderIndex : idx,
        }));
        validDays.push({ ...result.data, activities: normalizedActivities });
      }
    }
    return validDays;
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

    const draft = job.draft;
    const expectedSchema = itinerarySchema.toString();
    const basePrompt = this.buildPrompt(draft, options.targetDays ?? []);

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
        const validDays = Array.isArray(parsedJson?.days) ? this.normalizeDays(parsedJson.days) : [];
        if (validDays.length === 0) {
          lastError = 'schema_error: no valid days';
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

        const allDaysValid = baseResult.success && validDays.length === parsedJson.days?.length;

        const partialDays = validDays.map((d) => d.dayIndex).sort((a, b) => a - b);
        const parsed: Prisma.JsonObject = {
          title: baseResult.success ? baseResult.data.title : parsedJson.title ?? 'untitled',
          days: validDays,
        } as Prisma.JsonObject;

        const status = allDaysValid ? GenerationJobStatus.SUCCEEDED : GenerationJobStatus.SUCCEEDED; // TODO: PARTIAL status is not modeled in DB enum; partialDays conveys partial success.
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
        return { status, partialDays, parsed };
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
