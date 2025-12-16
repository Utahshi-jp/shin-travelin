import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus, Prisma, Weather } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { AiService } from '../ai/ai.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { RegenerateDto } from './dto/regenerate.dto';

/**
 * Itinerary service manages optimistic locking and normalized persistence (AR-8/AR-9/AR-10).
 */
@Injectable()
export class ItinerariesService {
  constructor(private readonly prisma: PrismaService, private readonly aiService: AiService) {}

  async create(dto: CreateItineraryDto, userId: string) {
    const job = await this.prisma.generationJob.findUnique({ include: { draft: true }, where: { id: dto.jobId } });
    if (!job) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Job not found' });
    if (job.draft.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });
    if (job.status !== GenerationJobStatus.SUCCEEDED) {
      throw new ConflictException({ code: ErrorCode.JOB_CONFLICT, message: 'Job not finished' });
    }
    if (job.itineraryId) {
      throw new ConflictException({ code: ErrorCode.VERSION_CONFLICT, message: 'Itinerary already exists for this job' });
    }
    if (job.draftId !== dto.draftId) {
      throw new ConflictException({ code: ErrorCode.VERSION_CONFLICT, message: 'Draft mismatch for job' });
    }

    const itinerary = await this.prisma.$transaction(async (tx) => {
      const created = await tx.itinerary.create({
        data: {
          userId,
          draftId: dto.draftId,
          title: dto.title,
        },
      });

      for (const [dayIndex, day] of dto.days.entries()) {
        const dayRow = await tx.itineraryDay.create({
          data: {
            itineraryId: created.id,
            dayIndex,
            date: new Date(day.date),
          },
        });

        await tx.activity.createMany({
          data: day.activities.map((activity) => ({
            itineraryDayId: dayRow.id,
            time: activity.time,
            location: activity.location,
            content: activity.content,
            url: activity.url,
            weather: (activity.weather ?? 'UNKNOWN') as Weather,
            orderIndex: activity.orderIndex,
          })),
        });
      }

      await tx.itineraryRaw.create({
        data: {
          itineraryId: created.id,
          rawJson: dto.rawJson ?? (dto as unknown as Prisma.JsonObject),
          promptHash: job.promptHash ?? 'pending-hash',
          model: job.model ?? 'gemini-pro',
        },
      });

      await tx.generationJob.update({ where: { id: dto.jobId }, data: { itineraryId: created.id } });

      return created;
    });
    return { id: itinerary.id, version: itinerary.version };
  }

  async list(userId: string, page = 1, pageSize = 10) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.itinerary.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { days: { include: { activities: true } } },
      }),
      this.prisma.itinerary.count({ where: { userId } }),
    ]);
    return { items, page, total };
  }

  async getById(id: string, userId: string) {
    const itinerary = await this.prisma.itinerary.findUnique({ include: { days: { include: { activities: true } }, raw: true }, where: { id } });
    if (!itinerary) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Itinerary not found' });
    if (itinerary.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });
    return itinerary;
  }

  async update(id: string, dto: UpdateItineraryDto, userId: string) {
    const itinerary = await this.prisma.itinerary.findUnique({ where: { id }, include: { days: true } });
    if (!itinerary) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Itinerary not found' });
    if (itinerary.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });
    if (itinerary.version !== dto.version) {
      throw new ConflictException({ code: ErrorCode.VERSION_CONFLICT, message: 'Version mismatch', details: { currentVersion: itinerary.version } });
    }

    const nextVersion = itinerary.version + 1;
    await this.prisma.itinerary.update({ where: { id }, data: { title: dto.title ?? itinerary.title, version: nextVersion } });

    return { version: nextVersion };
  }

  async regenerate(id: string, dto: RegenerateDto, userId: string, correlationId: string) {
    const itinerary = await this.prisma.itinerary.findUnique({ where: { id }, include: { draft: true } });
    if (!itinerary) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Itinerary not found' });
    if (itinerary.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });

    const running = await this.prisma.generationJob.findFirst({
      where: { itineraryId: id, status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.RUNNING] } },
    });
    if (running) throw new ConflictException({ code: ErrorCode.JOB_CONFLICT, message: 'Regeneration already running' });

    const { jobId } = await this.aiService.enqueue({ draftId: itinerary.draftId, targetDays: dto.days }, userId, correlationId);
    await this.prisma.generationJob.update({ where: { id: jobId }, data: { itineraryId: id } });

    const model = process.env.AI_MODEL ?? 'gemini-pro';
    const envTemp = process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : 0.3;
    const temperature = Number.isFinite(envTemp) ? envTemp : 0.3;

    await this.prisma.aiGenerationAudit.create({
      data: {
        id: randomUUID(),
        jobId,
        correlationId,
        prompt: 'regenerate requested',
        request: { itineraryId: id, targetDays: dto.days },
        rawResponse: 'TODO: enqueue to AI pipeline',
        parsed: Prisma.JsonNull,
        status: GenerationJobStatus.QUEUED,
        retryCount: 0,
        model,
        temperature,
      },
    });

    return { jobId };
  }

  async getPrint(id: string, userId: string) {
    const itinerary = await this.getById(id, userId);
    return {
      id: itinerary.id,
      title: itinerary.title,
      days: itinerary.days,
      createdAt: itinerary.createdAt,
    };
  }
}
