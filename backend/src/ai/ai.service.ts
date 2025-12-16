import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { GenerateDto } from './dto/generate.dto';
import { AiPipeline } from './ai.pipeline';

/**
 * Coordinates GenerationJob lifecycle and prevents concurrent execution for a Draft (AR-6/AR-7).
 */
@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService, private readonly pipeline: AiPipeline) {}

    async enqueue(dto: GenerateDto, userId: string, correlationId: string) {
    const draft = await this.prisma.draft.findUnique({ where: { id: dto.draftId } });
    if (!draft) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Draft not found' });
    if (draft.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });

      const model = process.env.AI_MODEL ?? 'gemini-pro';
      const envTemp = process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : 0.3;
      const temperature = Number.isFinite(envTemp) ? envTemp : 0.3;
      const targetDays = dto.targetDays ? [...dto.targetDays].sort((a, b) => a - b) : [];
      // Stable hash enables idempotent job reuse for identical inputs.
      const promptHash = createHash('sha256')
        .update(JSON.stringify({ draftId: dto.draftId, model, temperature, targetDays }))
        .digest('hex');

    const running = await this.prisma.generationJob.findFirst({
      where: { draftId: dto.draftId, status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.RUNNING] } },
    });
    if (running) {
        throw new ConflictException({ code: ErrorCode.JOB_CONFLICT, message: 'Generation already running' });
    }

      const existing = await this.prisma.generationJob.findFirst({
        where: { draftId: dto.draftId, model, temperature, promptHash },
        orderBy: { createdAt: 'desc' },
      });

      if (existing && existing.status === GenerationJobStatus.SUCCEEDED) {
        return { jobId: existing.id, status: existing.status, itineraryId: existing.itineraryId };
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
            },
          });

      // Run synchronously for now; queue-backed execution is TODO per detail-design §7.
        const result = await this.pipeline.run(job.id, correlationId, { model, temperature, targetDays, promptHash });

        return { jobId: job.id, status: result.status, itineraryId: job.itineraryId };
  }

  async getStatus(jobId: string, userId: string) {
    const job = await this.prisma.generationJob.findUnique({ include: { draft: true }, where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Job not found' });
    if (job.draft.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });

    return { status: job.status, retryCount: job.retryCount, partialDays: job.partialDays, error: job.error, itineraryId: job.itineraryId };
  }
}
