import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerationJobStatus } from '@prisma/client';

describe('AiService.enqueue', () => {
  const draft = {
    id: 'draft-1',
    userId: 'user-1',
    origin: 'Tokyo',
    destinations: ['Kyoto'],
    startDate: new Date('2025-01-10'),
    endDate: new Date('2025-01-12'),
    budget: 100000,
    purposes: ['culture'],
    memo: null,
  };

  const makePrisma = () => {
    const prisma = {
      draft: {
        findUnique: jest.fn(),
      },
      generationJob: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
    } as any;
    prisma.draft.findUnique.mockResolvedValue(draft);
    prisma.generationJob.create.mockResolvedValue({
      id: 'job-1',
      itineraryId: null,
    });
    prisma.generationJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: GenerationJobStatus.SUCCEEDED,
      itineraryId: null,
      error: null,
    });
    return prisma;
  };

  it('creates a job and runs pipeline when no running job exists', async () => {
    const prisma = makePrisma();
    prisma.generationJob.findFirst
      .mockResolvedValueOnce(null) // running check
      .mockResolvedValueOnce(null); // existing reuse check

    const pipeline = {
      run: jest.fn().mockResolvedValue({
        status: GenerationJobStatus.SUCCEEDED,
        partialDays: [0],
        parsed: {},
      }),
    } as any;

    const service = new AiService(prisma, pipeline);
    const result = await service.enqueue(
      { draftId: draft.id, targetDays: [] } as any,
      draft.userId,
      'corr-1',
    );

    expect(prisma.generationJob.create).toHaveBeenCalledTimes(1);
    expect(pipeline.run).toHaveBeenCalledWith(
      'job-1',
      'corr-1',
      expect.objectContaining({
        model: expect.any(String),
        overrideDestinations: [],
      }),
    );
    expect(result.status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(result.itineraryId).toBeNull();
  });

  it('normalizes and deduplicates targetDays before invoking pipeline', async () => {
    const prisma = makePrisma();
    prisma.generationJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const pipeline = {
      run: jest.fn().mockResolvedValue({
        status: GenerationJobStatus.SUCCEEDED,
        partialDays: [],
        parsed: { days: [] },
      }),
    } as any;

    const service = new AiService(prisma, pipeline);
    await service.enqueue(
      { draftId: draft.id, targetDays: [2, 0, 2] } as any,
      draft.userId,
      'corr-sort',
    );

    expect(pipeline.run).toHaveBeenCalledWith(
      'job-1',
      'corr-sort',
      expect.objectContaining({ targetDays: [0, 2] }),
    );
  });

  it('throws Conflict when a job is already queued/running', async () => {
    const prisma = makePrisma();
    prisma.generationJob.findFirst.mockResolvedValueOnce({ id: 'running-job' });
    const pipeline = { run: jest.fn() } as any;
    const service = new AiService(prisma, pipeline);

    await expect(
      service.enqueue({ draftId: draft.id } as any, draft.userId, 'corr-2'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(pipeline.run).not.toHaveBeenCalled();
  });

  it('throws Forbidden when draft owner mismatches', async () => {
    const prisma = makePrisma();
    prisma.draft.findUnique.mockResolvedValue({
      ...draft,
      userId: 'other-user',
    });
    const pipeline = { run: jest.fn() } as any;
    const service = new AiService(prisma, pipeline);

    await expect(
      service.enqueue({ draftId: draft.id } as any, 'user-x', 'corr-3'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound when draft is missing', async () => {
    const prisma = makePrisma();
    prisma.draft.findUnique.mockResolvedValue(null);
    const pipeline = { run: jest.fn() } as any;
    const service = new AiService(prisma, pipeline);

    await expect(
      service.enqueue({ draftId: 'missing' } as any, draft.userId, 'corr-4'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequest when targetDays exceed draft range', async () => {
    const prisma = makePrisma();
    const pipeline = { run: jest.fn() } as any;
    const service = new AiService(prisma, pipeline);

    await expect(
      service.enqueue(
        { draftId: draft.id, targetDays: [99] } as any,
        draft.userId,
        'corr-5',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pipeline.run).not.toHaveBeenCalled();
  });
});
