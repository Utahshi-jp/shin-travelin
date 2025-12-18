import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DayScenario, GenerationJobStatus, Prisma, SpotCategory, Weather } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { AiService } from '../ai/ai.service';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { RegenerateDto } from './dto/regenerate.dto';
import { ListItinerariesQueryDto } from './dto/list-itineraries.dto';
import { persistItineraryGraph, sortDays } from './itinerary.persistence';

/**
 * Itinerary service manages optimistic locking and normalized persistence (AR-8/AR-9/AR-10).
 */
@Injectable()
export class ItinerariesService {
  constructor(private readonly prisma: PrismaService, private readonly aiService: AiService) {}

  async create() {
    throw new ConflictException({ code: ErrorCode.VERSION_CONFLICT, message: 'Manual creation is disabled in auto-save mode' });
  }

  async list(userId: string, query: ListItinerariesQueryDto, pageSize = 10) {
    const page = query.page ?? 1;
    const where: Prisma.ItineraryWhereInput = { userId };

    if (query.keyword) {
      where.title = { contains: query.keyword, mode: 'insensitive' };
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.NestedDateTimeFilter = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate);
      if (query.endDate) dateFilter.lte = new Date(query.endDate);
      where.days = { some: { date: dateFilter } };
    }

    if (query.purpose) {
      where.draft = { purposes: { has: query.purpose } };
    }

    const [rawItems, total] = await this.prisma.$transaction([
      this.prisma.itinerary.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          version: true,
          createdAt: true,
          draft: { select: { purposes: true } },
          days: {
            select: {
              date: true,
              scenario: true,
              activities: { select: { area: true, description: true }, orderBy: { orderIndex: 'asc' } },
            },
            orderBy: [{ dayIndex: 'asc' }, { scenario: 'asc' }],
          },
        },
      }),
      this.prisma.itinerary.count({ where }),
    ]);

    const items = rawItems.map((itinerary) => {
      const sunnyDays = itinerary.days.filter((day) => day.scenario === DayScenario.SUNNY);
      const primary = sunnyDays.length ? sunnyDays : itinerary.days;
      const firstDate = primary.length ? primary[0].date.toISOString() : null;
      const lastDate = primary.length ? primary[primary.length - 1].date.toISOString() : null;
      const activities = itinerary.days.flatMap((day) => day.activities ?? []);
      const areaRanking = buildAreaRanking(activities.map((activity) => activity.area));
      const summary = buildDescriptionSummary(activities.map((activity) => activity.description));
      return {
        id: itinerary.id,
        title: itinerary.title,
        version: itinerary.version,
        createdAt: itinerary.createdAt,
        firstDate,
        lastDate,
        purposes: itinerary.draft?.purposes ?? [],
        primaryAreas: areaRanking,
        experienceSummary: summary,
      };
    });

    return { items, page, total, pageSize };
  }

  async getById(id: string, userId: string) {
    const itinerary = await this.prisma.itinerary.findUnique({
      include: {
        days: {
          include: { activities: { orderBy: { orderIndex: 'asc' } } },
          orderBy: [{ dayIndex: 'asc' }, { scenario: 'asc' }],
        },
        raw: true,
      },
      where: { id },
    });
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
    await this.prisma.$transaction(async (tx) => {
      await tx.itinerary.update({ where: { id }, data: { title: dto.title ?? itinerary.title, version: nextVersion } });

      if (dto.days) {
        const existingDayIds = itinerary.days.map((day) => day.id);
        if (existingDayIds.length) {
          await tx.activity.deleteMany({ where: { itineraryDayId: { in: existingDayIds } } });
          await tx.itineraryDay.deleteMany({ where: { id: { in: existingDayIds } } });
        }

        const sortedDays = sortDays(dto.days);
        for (const day of sortedDays) {
          const dayRow = await tx.itineraryDay.create({
            data: {
              itineraryId: id,
              dayIndex: day.dayIndex,
              date: new Date(day.date),
              scenario: (day.scenario as DayScenario) ?? DayScenario.SUNNY,
            },
          });

          await tx.activity.createMany({
            data: day.activities.map((activity, idx) => ({
              itineraryDayId: dayRow.id,
              time: activity.time,
              area: activity.area,
              placeName: activity.placeName ?? null,
              category: (activity.category as SpotCategory) ?? SpotCategory.SIGHTSEEING,
              description: activity.description,
              stayMinutes: activity.stayMinutes ?? null,
              weather: (activity.weather ?? 'UNKNOWN') as Weather,
              orderIndex: Number.isFinite(activity.orderIndex) ? activity.orderIndex : idx,
            })),
          });
        }
      }
    });

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

function buildAreaRanking(areas: string[], limit = 3) {
  const counter = new Map<string, number>();
  areas
    .map((area) => area?.trim())
    .filter((area): area is string => Boolean(area))
    .forEach((area) => {
      counter.set(area, (counter.get(area) ?? 0) + 1);
    });
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([area]) => area);
}

function buildDescriptionSummary(descriptions: string[], limit = 2) {
  const filtered = descriptions
    .map((desc) => desc?.trim())
    .filter((desc): desc is string => Boolean(desc));
  if (!filtered.length) return null;
  return filtered.slice(0, limit).join('｜');
}
