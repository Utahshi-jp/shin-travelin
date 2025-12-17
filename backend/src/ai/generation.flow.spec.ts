import { GenerationJobStatus } from '@prisma/client';
import { AiPipeline } from './ai.pipeline';
import { AiService } from './ai.service';
import { GeminiProviderError } from './providers/gemini.provider';

/**
 * Covers end-to-end flow of enqueue + pipeline with mocked Prisma and Gemini.
 * Ensures schedule generation writes audit and updates job status/partialDays.
 */
describe('AI schedule generation flow', () => {
  const draft = {
    id: 'draft-1',
    userId: 'user-1',
    origin: 'Tokyo',
    destinations: ['Kyoto'],
    startDate: new Date('2025-01-10'),
    endDate: new Date('2025-01-10'),
    budget: 50000,
    purposes: ['culture'],
    companionDetail: null,
  };

  const makePrisma = () => {
    const audits: any[] = [];
    const prisma: any = {
      draft: {
        findUnique: jest.fn().mockResolvedValue(draft),
      },
      generationJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'job-1', itineraryId: null }),
        update: jest.fn().mockImplementation(async (args: any) => ({ id: args.where.id, draft })),
        findUnique: jest.fn().mockResolvedValue({ id: 'job-1', status: GenerationJobStatus.SUCCEEDED, itineraryId: null, error: null }),
      },
      aiGenerationAudit: {
        create: jest.fn(async (data: any) => {
          audits.push(data?.data ?? data);
          return data;
        }),
        _audits: audits,
      },
      $transaction: jest.fn(async (ops: any[]) => {
        for (const op of ops) await op;
      }),
      _audits: audits,
    };
    return prisma;
  };

  const geminiMock = {
    generate: jest.fn(async () => ({
      rawText:
        '{"title":"Trip","days":[{"dayIndex":0,"date":"2025-01-10","scenario":"SUNNY","activities":[{"time":"09:00","location":"Kiyomizu","content":"Visit temple","weather":"SUNNY","orderIndex":0}]}]}',
      rawResponse: {},
      request: { mock: true },
    })),
  } as any;

  it('succeeds and records audit + partialDays', async () => {
    const prisma = makePrisma();
    const pipeline = new AiPipeline(prisma, geminiMock);
    const service = new AiService(prisma, pipeline as any);
    jest.spyOn<any, any>(service as any, 'persistJobResult').mockResolvedValue(undefined);

    const result = await service.enqueue({ draftId: draft.id, targetDays: [] } as any, draft.userId, 'corr-flow');

    expect(result.status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(prisma.aiGenerationAudit.create).toHaveBeenCalled();
    expect(prisma.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: GenerationJobStatus.SUCCEEDED, partialDays: [0] }),
    });
  });

  it('repairs malformed JSON and still succeeds', async () => {
    const prisma = makePrisma();
    const brokenGemini = {
      generate: jest.fn(async () => ({
        // Missing closing brackets; jsonrepair should fix.
        rawText:
          '{"title":"Trip","days":[{"dayIndex":0,"date":"2025-01-10","scenario":"SUNNY","activities":[{"time":"09:00","location":"Kiyomizu","content":"Visit temple","weather":"SUNNY","orderIndex":0}]',
        rawResponse: {},
        request: { mock: true },
      })),
    } as any;

    const pipeline = new AiPipeline(prisma, brokenGemini);
    const service = new AiService(prisma, pipeline as any);
    jest.spyOn<any, any>(service as any, 'persistJobResult').mockResolvedValue(undefined);

    const result = await service.enqueue({ draftId: draft.id, targetDays: [] } as any, draft.userId, 'corr-broken');

    expect(result.status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(prisma.aiGenerationAudit.create).toHaveBeenCalled();
    expect(prisma.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: GenerationJobStatus.SUCCEEDED, partialDays: [0] }),
    });
  });

  it('fails after retryable provider errors (e.g., 503)', async () => {
    const prisma = makePrisma();
    prisma.generationJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: GenerationJobStatus.FAILED,
      itineraryId: null,
      error: 'provider_error_503',
    });
    const failingGemini = {
      generate: jest.fn(async () => {
        throw new GeminiProviderError(503, 'unavailable');
      }),
    } as any;

    const pipeline = new AiPipeline(prisma, failingGemini);
    const service = new AiService(prisma, pipeline as any);
    jest.spyOn<any, any>(service as any, 'persistJobResult').mockResolvedValue(undefined);

    const result = await service.enqueue({ draftId: draft.id, targetDays: [] } as any, draft.userId, 'corr-503');

    expect(result.status).toBe(GenerationJobStatus.FAILED);
    expect(prisma.aiGenerationAudit._audits.some((a: any) => a.errorMessage === 'provider_error_503')).toBe(true);
  });
});
