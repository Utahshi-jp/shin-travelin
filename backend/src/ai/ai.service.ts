import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
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

  async enqueue(dto: GenerateDto, userId: string) {
    const draft = await this.prisma.draft.findUnique({ where: { id: dto.draftId } });
    if (!draft) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Draft not found' });
    if (draft.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });

    const running = await this.prisma.generationJob.findFirst({
      where: { draftId: dto.draftId, status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.RUNNING] } },
    });
    if (running) {
      throw new ConflictException({ code: ErrorCode.JOB_ALREADY_RUNNING, message: 'Generation already running' });
    }

    const job = await this.prisma.generationJob.create({
      data: {
        draftId: dto.draftId,
        status: GenerationJobStatus.QUEUED,
        targetDays: dto.targetDays ?? [],
        retryCount: 0,
        partialDays: [],
      },
    });

    // Run synchronously for now; future queue can offload (detail-design.md 7 生成ジョブ) .
    const correlationId = randomUUID();
    await this.pipeline.run(job.id, correlationId);

    return { jobId: job.id, status: GenerationJobStatus.QUEUED };
  }

  async getStatus(jobId: string, userId: string) {
    const job = await this.prisma.generationJob.findUnique({ include: { draft: true }, where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Job not found' });
    if (job.draft.userId !== userId) throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' });

    return { status: job.status, retryCount: job.retryCount, partialDays: job.partialDays, error: job.error };
  }
}
