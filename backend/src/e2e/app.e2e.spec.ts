import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../shared/http-exception.filter';
import { LoggingInterceptor } from '../shared/logging.interceptor';
import { CorrelationIdMiddleware } from '../shared/correlation.middleware';
import { ErrorCode } from '../shared/error-codes';
import { prisma, resetDatabase, createTestUser, loginAndGetToken, createDraft, createSucceededJob, createItineraryForUser, closePrisma, connectPrisma } from './test-helpers';
import { GenerationJobStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

jest.setTimeout(20000); // Why: e2e tests hit real DB + pipeline mock and regularly exceed default 5s.
process.env.USE_MOCK_GEMINI = 'true'; // Why: prevent real Gemini calls during e2e while preserving prod behavior.

// e2e tests focus on brittle behaviors to replace manual curl checks.
describe('Backend e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await connectPrisma();
    app = moduleFixture.createNestApplication();
    // Mirror main.ts bootstrap for realistic behavior.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());
    app.use((req, res, next) => new CorrelationIdMiddleware().use(req, res, next));

    await app.init();
  });

  afterAll(async () => {
    await resetDatabase();
    await closePrisma();
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('Auth', () => {
    it('register -> login -> me succeeds', async () => {
      // Why: replaces manual smoke (FR auth baseline) and ensures login pipeline works end-to-end.
      const email = `user+${Date.now()}@example.com`;
      const password = 'Password123!';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, displayName: 'Tester' })
        .expect(201);

      expect(registerRes.body.accessToken).toBeDefined();

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const token = loginRes.body.accessToken as string;
      const meRes = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(meRes.body.email).toBe(email);
    });

    it('auth/me without token returns UNAUTHORIZED', async () => {
      // Why: verifies guard + unified error envelope when JWT is missing.
      const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
      expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(res.body.correlationId).toBeDefined();
    });
  });

  describe('Drafts', () => {
    it('startDate > endDate yields 400 with error envelope', async () => {
      // Why: Prisma cannot enforce CHECK; service must guard per design note.
      const { user, password } = await createTestUser();
      const token = await loginAndGetToken(app, user.email, password);

      const res = await request(app.getHttpServer())
        .post('/drafts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          origin: 'Tokyo',
          destinations: ['Osaka'],
          startDate: '2025-01-12',
          endDate: '2025-01-10',
          budget: 50000,
          purposes: ['sightseeing'],
          companions: {
            adultMale: 1,
            adultFemale: 0,
            boy: 0,
            girl: 0,
            infant: 0,
            pet: 0,
            other: 0,
          },
        });

      if (res.status !== 400) {
        throw new Error(`unexpected draft status=${res.status} body=${JSON.stringify(res.body)}`);
      }
      expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(res.body.correlationId).toBeDefined();
    });
  });

  describe('AI jobs', () => {
    it('reuses job for identical inputs', async () => {
      // Why: Idempotency prevents duplicate AI runs (AR-6/AI-5) replacing manual curl checks.
      const { user, password } = await createTestUser();
      const token = await loginAndGetToken(app, user.email, password);
      const draftId = await createDraft(app, token);

      const first = await request(app.getHttpServer())
        .post('/ai/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ draftId, targetDays: [0, 1] })
        .expect(202);

      const second = await request(app.getHttpServer())
        .post('/ai/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ draftId, targetDays: [1, 0] })
        .expect(202);

      expect(first.body.jobId).toBeDefined();
      expect(second.body.jobId).toBe(first.body.jobId);
      expect(second.body.status).toBeDefined();
    });

    it('conflicts when job is running for same draft', async () => {
      // Why: Guards against concurrent generation (ER-3) and should respond with JOB_CONFLICT.
      const { user, password } = await createTestUser();
      const token = await loginAndGetToken(app, user.email, password);
      const draftId = await createDraft(app, token);

      const job = await prisma.generationJob.create({
        data: {
          draftId,
          status: GenerationJobStatus.RUNNING,
          partialDays: [],
          targetDays: [],
          retryCount: 0,
          model: 'gemini-pro',
          temperature: 0.3,
          promptHash: randomUUID(),
        },
      });

      await request(app.getHttpServer())
        .post('/ai/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ draftId })
        .expect(409)
        .expect(({ body }) => {
          expect(body.code).toBe(ErrorCode.JOB_CONFLICT);
          expect(body.message).toContain('Generation already running');
        });

      // Clean up job to avoid cross-test interference.
      await prisma.generationJob.delete({ where: { id: job.id } });
    });
  });

  describe('Itineraries', () => {
    it('PATCH conflicts when version mismatches', async () => {
      // Why: Optimistic locking regression guard (AR-9/ER-3) replacing manual curl check.
      const { user, password } = await createTestUser();
      const token = await loginAndGetToken(app, user.email, password);
      const draft = await prisma.draft.create({
        data: {
          userId: user.id,
          origin: 'Tokyo',
          destinations: ['Kyoto'],
          startDate: new Date('2025-01-10'),
          endDate: new Date('2025-01-12'),
          budget: 40000,
          purposes: ['sightseeing'],
          status: 'ACTIVE',
        },
      });
      const itinerary = await createItineraryForUser(user.id, draft.id, 'My Trip');

      const res = await request(app.getHttpServer())
        .patch(`/itineraries/${itinerary.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated', version: itinerary.version + 1 })
        .expect(409);

      expect(res.body.code).toBe(ErrorCode.VERSION_CONFLICT);
      expect(res.body.details.currentVersion).toBe(itinerary.version);
    });

    it('forbids access to other user itinerary', async () => {
      // Why: Enforces userId scoping (ER-2) so users cannot read others' plans.
      const { user: owner, password: ownerPassword } = await createTestUser();
      const ownerToken = await loginAndGetToken(app, owner.email, ownerPassword);
      const draft = await prisma.draft.create({
        data: {
          userId: owner.id,
          origin: 'Tokyo',
          destinations: ['Kyoto'],
          startDate: new Date('2025-01-10'),
          endDate: new Date('2025-01-12'),
          budget: 40000,
          purposes: ['sightseeing'],
          status: 'ACTIVE',
        },
      });
      const itinerary = await createItineraryForUser(owner.id, draft.id, 'Owner Trip');

      const { user: intruder, password: intruderPassword } = await createTestUser();
      const intruderToken = await loginAndGetToken(app, intruder.email, intruderPassword);

      const res = await request(app.getHttpServer())
        .get(`/itineraries/${itinerary.id}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(403);

      expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    });
  });
});
