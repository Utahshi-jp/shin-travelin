import { Injectable, Logger } from '@nestjs/common';
import { GenerationJobStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Centralized AI pipeline placeholder; Gemini integration is TODO to keep scope manageable while retaining audit hooks.
 */
@Injectable()
export class AiPipeline {
  private readonly logger = new Logger(AiPipeline.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(jobId: string, correlationId: string) {
    // Mark running before performing LLM call.
    await this.prisma.generationJob.update({ where: { id: jobId }, data: { status: GenerationJobStatus.RUNNING, startedAt: new Date() } });

    // TODO: Implement Gemini call, stripCodeFence, JSON.parse, Zod validation, and repair retries (detail-design.md 5.1/12.3).
    // For now, mark as succeeded with empty partialDays so downstream flows can be wired.
    const parsed = { days: [], title: 'Pending generated title' } as Prisma.JsonObject;
    await this.prisma.$transaction([
      this.prisma.aiGenerationAudit.create({
        data: {
          id: randomUUID(),
          jobId,
          correlationId,
          prompt: 'TODO: promptBuilder output',
          request: {},
          rawResponse: 'TODO: Gemini response',
          parsed,
          status: GenerationJobStatus.SUCCEEDED,
          retryCount: 0,
          model: process.env.AI_MODEL ?? 'gemini-pro',
          temperature: process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : 0.3,
        },
      }),
      this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: GenerationJobStatus.SUCCEEDED,
          partialDays: [],
          retryCount: 0,
          finishedAt: new Date(),
          error: null,
        },
      }),
    ]);

    this.logger.log({ jobId, correlationId, status: GenerationJobStatus.SUCCEEDED });
    return { parsed, partialDays: [] };
  }
}
