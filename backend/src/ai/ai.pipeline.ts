import { Injectable, Logger } from '@nestjs/common';
import { GenerationJobStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

type RunOptions = {
  model: string;
  temperature: number;
  targetDays: number[];
  promptHash: string;
};

/**
 * Centralized AI pipeline placeholder; Gemini integration is TODO to keep scope manageable while retaining audit hooks.
 */
@Injectable()
export class AiPipeline {
  private readonly logger = new Logger(AiPipeline.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(jobId: string, correlationId: string, options: RunOptions) {
    // Mark running before performing LLM call; this ensures status is accurate even if downstream fails.
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.RUNNING,
        startedAt: new Date(),
        model: options.model,
        temperature: options.temperature,
        targetDays: options.targetDays,
        promptHash: options.promptHash,
      },
    });

    try {
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
            model: options.model,
            temperature: options.temperature,
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
      return { status: GenerationJobStatus.SUCCEEDED, parsed, partialDays: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.$transaction([
        this.prisma.aiGenerationAudit.create({
          data: {
            id: randomUUID(),
            jobId,
            correlationId,
            prompt: 'TODO: promptBuilder output',
            request: {},
            rawResponse: 'TODO: Gemini response',
            parsed: null,
            status: GenerationJobStatus.FAILED,
            retryCount: 0,
            model: options.model,
            temperature: options.temperature,
            errorMessage: message,
          },
        }),
        this.prisma.generationJob.update({
          where: { id: jobId },
          data: {
            status: GenerationJobStatus.FAILED,
            error: message,
            finishedAt: new Date(),
          },
        }),
      ]);

      this.logger.error({ jobId, correlationId, error: message });
      return { status: GenerationJobStatus.FAILED, error: message };
    }
  }
}
