import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, GenerationJobStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const datasourceUrl = process.env.DATABASE_URL;
if (!datasourceUrl) {
  throw new Error('DATABASE_URL is required for e2e tests');
}

const pool = new Pool({ connectionString: datasourceUrl });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
export async function connectPrisma() {
  await prisma.$connect();
}
export async function closePrisma() {
  await prisma.$disconnect();
  await pool.end();
}

export async function resetDatabase() {
  // Delete children first to satisfy FK constraints.
  await prisma.activity.deleteMany();
  await prisma.itineraryDay.deleteMany();
  await prisma.itineraryRaw.deleteMany();
  await prisma.aiGenerationAudit.deleteMany();
  await prisma.generationJob.deleteMany();
  await prisma.itinerary.deleteMany();
  await prisma.companionDetail.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedDraft(app: INestApplication, token: string) {
  const draftId = await createDraft(app, token);
  return draftId;
}

export async function createTestUser() {
  const password = 'Password123!';
  const email = `user+${Date.now()}@example.com`;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: 'Test User',
    },
  });
  return { user, password };
}

export async function loginAndGetToken(app: INestApplication, email: string, password: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

export async function createDraft(app: INestApplication, token: string) {
  const payload = {
    origin: 'Tokyo',
    destinations: ['Osaka'],
    startDate: '2025-01-10',
    endDate: '2025-01-12',
    budget: 50000,
    purposes: ['sightseeing'],
    memo: 'test draft',
    companions: {
      adultMale: 1,
      adultFemale: 0,
      boy: 0,
      girl: 0,
      infant: 0,
      pet: 0,
      other: 0,
    },
  };

  const res = await request(app.getHttpServer())
    .post('/drafts')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  if (res.status !== 201) {
    throw new Error(`createDraft failed status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

export async function createSucceededJob(draftId: string) {
  return prisma.generationJob.create({
    data: {
      draftId,
      status: GenerationJobStatus.SUCCEEDED,
      retryCount: 0,
      partialDays: [],
      targetDays: [],
      model: 'gemini-pro',
      temperature: 0.3,
      promptHash: 'hash',
    },
  });
}

export async function createItineraryForUser(userId: string, draftId: string, title: string) {
  return prisma.itinerary.create({
    data: {
      userId,
      draftId,
      title,
    },
  });
}
