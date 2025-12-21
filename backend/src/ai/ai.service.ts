import {
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
import {
  PersistDayInput,
  persistItineraryGraph,
  replaceItineraryDays,
} from '../itineraries/itinerary.persistence';

type JobWithDraft = Prisma.GenerationJobGetPayload<{ include: { draft: true } }>;

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

    const model = process.env.AI_MODEL ?? 'gemini-pro';
    const envTemp = process.env.AI_TEMPERATURE
      ? parseFloat(process.env.AI_TEMPERATURE)
      : 0.3;
    const temperature = Number.isFinite(envTemp) ? envTemp : 0.3;
    const targetDays = dto.targetDays
      ? [...dto.targetDays].sort((a, b) => a - b)
      : [];
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

    // Run synchronously for now; queue-backed execution is TODO per detail-design §7.
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

  private async persistJobResult(
    jobId: string,
    parsed: Prisma.JsonObject,
    destinationHints: string[] = [],
  ) {
    const payload = parsed as { title?: unknown; days?: unknown };
    const dayArray = Array.isArray(payload.days) ? payload.days : [];
    if (!dayArray.length) return;

    const normalizedDays: PersistDayInput[] = dayArray
      .filter(
        (day: any) =>
          typeof day?.dayIndex === 'number' && typeof day?.date === 'string',
      )
      .map((day: any) => ({
        dayIndex: day.dayIndex,
        date: day.date,
        scenario: day.scenario,
        activities: Array.isArray(day.activities) ? day.activities : [],
      }));

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
          : job.draft.destinations?.slice(0, 3) ?? [];
        const fallbackTitle = destinationLabel.length
          ? `${destinationLabel.join(', ')} Trip`
          : 'Generated Trip';
        const title =
          typeof payload.title === 'string' && payload.title.trim().length
            ? payload.title.trim()
            : fallbackTitle;

        await persistItineraryGraph(tx, {
          userId: job.draft.userId,
          draftId: job.draftId,
          title,
          days: normalizedDays,
          rawJson: parsed,
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
          orderBy: [
            { dayIndex: 'asc' },
            { scenario: 'asc' },
          ],
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
