import { GenerationJobStatus } from '@prisma/client';
import { AiPipeline, stripCodeFence } from './ai.pipeline';

describe('AiPipeline helpers', () => {
  it('stripCodeFence removes triple backticks', () => {
    const input = "```json\n{\"ok\":true}\n```";
    expect(stripCodeFence(input)).toBe('{"ok":true}');
  });
});

describe('AiPipeline retry flow', () => {
  const baseDraft = {
    id: 'draft1',
    origin: 'Tokyo',
    destinations: ['Osaka'],
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-01-02'),
    budget: 10000,
    purposes: ['sightseeing'],
    companionDetail: null,
  };

  const mockPrisma = () => {
    const audits: any[] = [];
    return {
      generationJob: {
        update: jest.fn(async () => ({ id: 'job1', draft: baseDraft })),
      },
      aiGenerationAudit: {
        create: jest.fn(async (data: any) => audits.push(data)),
      },
      $transaction: jest.fn(async (ops: any[]) => {
        for (const op of ops) {
          await op;
        }
      }),
      _audits: audits,
    } as any;
  };

  it('succeeds on valid json response', async () => {
    const prisma = mockPrisma();
    const provider = {
      generate: jest.fn(async () => ({
        rawText:
          '```json{"title":"trip","days":[{"dayIndex":0,"date":"2025-01-01","scenario":"SUNNY","activities":[{"time":"09:00","location":"A","content":"B","weather":"SUN","orderIndex":0}]}]} ```',
        rawResponse: {},
        request: {},
      })),
    } as any;

    const pipeline = new AiPipeline(prisma, provider);
    const result = await pipeline.run('job1', 'cid-1', { model: 'gemini-pro', temperature: 0.3, targetDays: [], promptHash: 'hash' });

    expect(result.status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(result.partialDays).toEqual([0]);
    expect(prisma.aiGenerationAudit.create).toHaveBeenCalled();
  });

  it('fails after retries on parse errors', async () => {
    const prisma = mockPrisma();
    const provider = {
      generate: jest.fn(async () => ({ rawText: 'not-json', rawResponse: 'not-json', request: {} })),
    } as any;

    const pipeline = new AiPipeline(prisma, provider);
    const result = await pipeline.run('job1', 'cid-2', { model: 'gemini-pro', temperature: 0.3, targetDays: [], promptHash: 'hash' });

    expect(result.status).toBe(GenerationJobStatus.FAILED);
    // At least one audit per attempt + final failure
    expect((prisma as any)._audits.length).toBeGreaterThanOrEqual(2);
  });
});
