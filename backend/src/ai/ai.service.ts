import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GenerationJobStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { GenerateDto } from './dto/generate.dto';
import { AiPipeline } from './ai.pipeline';
import type { NormalizedItineraryPayload } from './ai.pipeline';
import {
  PersistActivityInput,
  PersistDayInput,
  persistItineraryGraph,
  replaceItineraryDays,
} from '../itineraries/itinerary.persistence';

type JobWithDraft = Prisma.GenerationJobGetPayload<{
  include: { draft: true };
}>;

/**
 * Coordinates GenerationJob lifecycle and prevents concurrent execution for a Draft (AR-6/AR-7).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: AiPipeline,
  ) {}

  /**
   * Draft/Itinerary の所有権を検証しつつジョブをキューイングする。
   * targetDays を Draft の日数で正規化し、同一入力は promptHash で再利用する。
   */
  async enqueue(dto: GenerateDto, userId: string, correlationId: string) {
    const draft = await this.prisma.draft.findUnique({
      where: { id: dto.draftId },
    });
    if (!draft)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Draft not found',
      });
    if (draft.userId !== userId)
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Forbidden',
      });

    if (dto.itineraryId) {
      const itinerary = await this.prisma.itinerary.findUnique({
        where: { id: dto.itineraryId },
        select: { id: true, userId: true, draftId: true },
      });
      if (!itinerary)
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'Itinerary not found',
        });
      if (itinerary.userId !== userId || itinerary.draftId !== draft.id)
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN,
          message: 'Forbidden',
        });
    }

    const targetDays = this.normalizeTargetDays(dto.targetDays, draft);
    const model = process.env.AI_MODEL ?? 'gemini-pro';
    const envTemp = process.env.AI_TEMPERATURE
      ? parseFloat(process.env.AI_TEMPERATURE)
      : 0.3;
    const temperature = Number.isFinite(envTemp) ? envTemp : 0.3;
    const destinationHints = this.normalizeDestinationHints(
      dto.overrideDestinations,
    );
    // Stable hash enables idempotent job reuse for identical inputs.
    const promptHash = createHash('sha256')
      .update(
        JSON.stringify({
          draftId: dto.draftId,
          model,
          temperature,
          targetDays,
          destinationHints,
        }),
      )
      .digest('hex');

    const running = await this.prisma.generationJob.findFirst({
      where: {
        draftId: dto.draftId,
        status: {
          in: [GenerationJobStatus.QUEUED, GenerationJobStatus.RUNNING],
        },
      },
    });
    if (running) {
      throw new ConflictException({
        code: ErrorCode.JOB_CONFLICT,
        message: 'Generation already running',
      });
    }

    const existing = await this.prisma.generationJob.findFirst({
      where: { draftId: dto.draftId, model, temperature, promptHash },
      orderBy: { createdAt: 'desc' },
    });

    const canReuseJob =
      !dto.itineraryId &&
      existing &&
      existing.status === GenerationJobStatus.SUCCEEDED;
    if (canReuseJob) {
      return {
        jobId: existing.id,
        status: existing.status,
        itineraryId: existing.itineraryId,
        error: existing.error,
      };
    }

    const job = existing
      ? await this.prisma.generationJob.update({
          where: { id: existing.id },
          data: {
            status: GenerationJobStatus.QUEUED,
            targetDays,
            promptHash,
            model,
            temperature,
            partialDays: [],
            error: null,
            startedAt: null,
            finishedAt: null,
            retryCount: existing.retryCount + 1,
            itineraryId: dto.itineraryId ?? existing.itineraryId ?? null,
          },
        })
      : await this.prisma.generationJob.create({
          data: {
            draftId: dto.draftId,
            status: GenerationJobStatus.QUEUED,
            targetDays,
            retryCount: 0,
            partialDays: [],
            model,
            temperature,
            promptHash,
            itineraryId: dto.itineraryId ?? null,
          },
        });

    // Run synchronously for now; queue-backed execution is TODO per detail-design ﾂｧ7.
    const result = await this.pipeline.run(job.id, correlationId, {
      model,
      temperature,
      targetDays,
      promptHash,
      overrideDestinations: destinationHints,
    });

    if (result.status === GenerationJobStatus.SUCCEEDED && result.parsed) {
      await this.persistJobResult(job.id, result.parsed, destinationHints);
    }

    const latestJob = await this.prisma.generationJob.findUnique({
      where: { id: job.id },
    });
    return {
      jobId: job.id,
      status: latestJob?.status ?? result.status,
      itineraryId: latestJob?.itineraryId,
      error: latestJob?.error ?? result.error,
    };
  }

  async getStatus(jobId: string, userId: string) {
    const job = await this.prisma.generationJob.findUnique({
      include: { draft: true },
      where: { id: jobId },
    });
    if (!job)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Job not found',
      });
    if (job.draft.userId !== userId)
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Forbidden',
      });

    return {
      status: job.status,
      retryCount: job.retryCount,
      partialDays: job.partialDays,
      error: job.error,
      itineraryId: job.itineraryId,
    };
  }

  /**
   * Draft の開始/終了日から日数を算出し、0-based dayIndex のみを許容する。
   * 範囲外が含まれる場合は invalidIndexes を details に含めて返す。
   */
  private normalizeTargetDays(
    input: number[] | undefined,
    draft: Pick<JobWithDraft['draft'], 'startDate' | 'endDate'>,
  ) {
    if (!Array.isArray(input) || input.length === 0) return [];
    const dayCount = this.countDraftDays(draft);
    if (dayCount <= 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Draft has no schedulable day range',
      });
    }

    const unique = Array.from(new Set(input.map((value) => Math.trunc(value))));
    const invalid = unique.filter((value) => value < 0 || value >= dayCount);
    if (invalid.length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'targetDays must be within the draft date range',
        details: {
          invalidIndexes: invalid,
          allowedRange: [0, dayCount - 1],
          dayCount,
        },
      });
    }

    return unique.sort((a, b) => a - b);
  }

  private countDraftDays(
    draft: Pick<JobWithDraft['draft'], 'startDate' | 'endDate'>,
  ) {
    const start = this.toUtcMidnight(draft.startDate);
    const end = this.toUtcMidnight(draft.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    if (end < start) return 0;
    const diff = Math.floor((end - start) / 86400000);
    return diff + 1;
  }

  private toUtcMidnight(date?: Date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return NaN;
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
  }

  private normalizeDestinationHints(input?: string[]) {
    if (!Array.isArray(input)) return [];
    const trimmed = input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value): value is string => Boolean(value));
    const unique: string[] = [];
    trimmed.forEach((value) => {
      if (!unique.includes(value)) unique.push(value);
    });
    return unique.slice(0, 5);
  }

  /**
   * 正規化済みの旅程を Itinerary+Days+Activities へ保存する。
   * 既存 itineraryId がある場合は対象日だけ差し替える。
   */
  private async persistJobResult(
    jobId: string,
    parsed: NormalizedItineraryPayload,
    destinationHints: string[] = [],
  ) {
    const dayArray = parsed.days;
    if (!dayArray.length) return;

    const normalizedDays = dayArray
      .map((day) => this.toPersistDay(day))
      .filter((day): day is PersistDayInput => Boolean(day));

    if (!normalizedDays.length) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        const job = await tx.generationJob.findUnique({
          where: { id: jobId },
          include: { draft: true },
        });
        if (!job) return;

        if (job.itineraryId) {
          await this.updateExistingItinerary(tx, job, normalizedDays);
          return;
        }

        const destinationLabel = destinationHints.length
          ? destinationHints.slice(0, 3)
          : (job.draft.destinations?.slice(0, 3) ?? []);
        const fallbackTitle = destinationLabel.length
          ? `${destinationLabel.join(', ')} Trip`
          : 'Generated Trip';
        const trimmedTitle = parsed.title.trim();
        const title = trimmedTitle.length ? trimmedTitle : fallbackTitle;

        await persistItineraryGraph(tx, {
          userId: job.draft.userId,
          draftId: job.draftId,
          title,
          days: normalizedDays,
          rawJson: parsed as Prisma.JsonObject,
          promptHash: job.promptHash,
          model: job.model,
          jobId: job.id,
        });
      });
    } catch (err) {
      this.logger.error({
        jobId,
        message: 'Failed to persist generated itinerary',
        error: (err as Error).message,
      });
      throw err;
    }
  }

  private toPersistDay(input: unknown): PersistDayInput | null {
    if (!this.isRecord(input)) return null;
    if (typeof input.dayIndex !== 'number' || typeof input.date !== 'string') {
      return null;
    }
    return {
      dayIndex: input.dayIndex,
      date: input.date,
      scenario: typeof input.scenario === 'string' ? input.scenario : undefined,
      activities: this.normalizePersistActivities(input.activities),
    };
  }

  private normalizePersistActivities(input: unknown): PersistActivityInput[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((activity) => this.toPersistActivity(activity))
      .filter((activity): activity is PersistActivityInput =>
        Boolean(activity),
      );
  }

  private toPersistActivity(input: unknown): PersistActivityInput | null {
    if (!this.isRecord(input)) return null;
    const time = this.coerceString(input.time);
    const area = this.coerceString(input.area);
    const category = this.coerceString(input.category);
    const description = this.coerceString(input.description);
    if (!time || !area || !category || !description) {
      return null;
    }
    return {
      time,
      area,
      category,
      description,
      placeName: this.coerceOptionalString(input.placeName),
      stayMinutes: this.coerceOptionalNumber(input.stayMinutes),
      weather: this.coerceOptionalString(input.weather),
      orderIndex: this.coerceOptionalNumber(input.orderIndex),
    };
  }

  private coerceString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private coerceOptionalString(value: unknown): string | undefined {
    return this.coerceString(value);
  }

  private coerceOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * 既存旅程に対する部分再生成適用。対象日のみ差し替え、version/raw を同期する。
   */
  private async updateExistingItinerary(
    tx: Prisma.TransactionClient,
    job: JobWithDraft,
    days: PersistDayInput[],
  ) {
    if (!job.itineraryId || !days.length) return;
    await replaceItineraryDays(tx, job.itineraryId, days);
    await tx.itinerary.update({
      where: { id: job.itineraryId },
      data: { version: { increment: 1 } },
    });
    await this.refreshItineraryRaw(tx, job.itineraryId, job);
  }

  private async refreshItineraryRaw(
    tx: Prisma.TransactionClient,
    itineraryId: string,
    job: JobWithDraft,
  ) {
    const itinerary = await tx.itinerary.findUnique({
      where: { id: itineraryId },
      include: {
        days: {
          orderBy: [{ dayIndex: 'asc' }, { scenario: 'asc' }],
          include: {
            activities: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });
    if (!itinerary) return;

    const serializedDays = itinerary.days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date.toISOString(),
      scenario: day.scenario,
      activities: day.activities.map((activity) => ({
        time: activity.time,
        area: activity.area,
        placeName: activity.placeName ?? undefined,
        category: activity.category,
        description: activity.description,
        stayMinutes: activity.stayMinutes ?? undefined,
        weather: activity.weather,
        orderIndex: activity.orderIndex,
      })),
    }));

    const rawPayload: Prisma.InputJsonValue = {
      title: itinerary.title,
      days: serializedDays,
    };

    const updateData: Prisma.ItineraryRawUpdateInput = {
      rawJson: rawPayload,
    };
    if (job.promptHash) updateData.promptHash = job.promptHash;
    if (job.model) updateData.model = job.model;

    await tx.itineraryRaw.upsert({
      where: { itineraryId },
      update: updateData,
      create: {
        itineraryId,
        rawJson: rawPayload,
        promptHash: job.promptHash ?? 'pending-hash',
        model: job.model ?? 'gemini-pro',
      },
    });
  }
}
