import { DayScenario, GenerationJobStatus, Weather } from '@prisma/client';
import { AiPipeline, stripCodeFence } from './ai.pipeline';

describe('AiPipeline helpers', () => {
  it('stripCodeFence removes triple backticks', () => {
    const input = '```json\n{"ok":true}\n```';
    expect(stripCodeFence(input)).toBe('{"ok":true}');
  });

  it('buildPrompt embeds destination handling rules', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = {
      origin: 'Tokyo',
      destinations: ['清水寺'],
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-01-02'),
      budget: 100000,
      purposes: ['sightseeing'],
      companionDetail: null,
    };
    const prompt = pipeline.buildPrompt(
      draft,
      [],
      ['2025-01-01', '2025-01-02'],
    );
    expect(prompt).toContain('ランドマーク');
    expect(prompt).toContain('placeName');
    expect(prompt).toContain('Reality guardrails');
    expect(prompt).toContain('確実に存在するスポット例');
  });

  it('validateAndSanitizeActivities enforces catalog-backed names', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = { origin: '京都', destinations: ['清水寺'] };
    const context = { scenario: DayScenario.SUNNY, dayIndex: 0, draft };
    const normalized = pipeline.normalizeActivities(
      [
        {
          time: '09:00',
          area: '東山',
          placeName: '清水寺周辺のカフェ',
          category: 'FOOD',
          description: 'invalid',
          orderIndex: 0,
        },
        {
          time: '11:30',
          area: '祇園',
          placeName: '産寧坂',
          category: 'SIGHTSEEING',
          description: 'alias',
          orderIndex: 1,
        },
        {
          time: '15:00',
          area: '東山',
          placeName: '高台寺',
          category: 'SIGHTSEEING',
          description: 'valid',
          orderIndex: 2,
        },
      ],
      context,
    );
    const sanitized = pipeline.validateAndSanitizeActivities(
      normalized,
      context,
    );
    expect(sanitized).toHaveLength(3);
    expect(sanitized[0].placeName).toBeUndefined();
    expect(sanitized[1].placeName).toBe('二年坂・三年坂');
    expect(sanitized[2].placeName).toBe('高台寺');
  });

  it('validateAndSanitizeActivities keeps concrete non-catalog names', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = { origin: '京都', destinations: ['京都駅'] };
    const context = { scenario: DayScenario.RAINY, dayIndex: 0, draft };
    const sanitized = pipeline.validateAndSanitizeActivities(
      [
        {
          time: '10:00',
          area: '四条',
          placeName: '喫茶ソワレ',
          category: 'FOOD',
          description: '老舗カフェでスイーツを楽しむ',
          orderIndex: 0,
        },
      ],
      context,
    );
    expect(sanitized[0].placeName).toBe('喫茶ソワレ');
  });

  it('validateAndSanitizeActivities removes duplicate catalog names', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = { origin: '東京', destinations: ['浅草寺'] };
    const context = { scenario: DayScenario.SUNNY, dayIndex: 0, draft };
    const sanitized = pipeline.validateAndSanitizeActivities(
      [
        {
          time: '09:00',
          area: '浅草',
          placeName: '浅草寺',
          category: 'SIGHTSEEING',
          description: 'first',
          weather: Weather.SUNNY,
          orderIndex: 0,
        },
        {
          time: '11:30',
          area: '浅草',
          placeName: '浅草寺',
          category: 'SIGHTSEEING',
          description: 'duplicate',
          weather: Weather.SUNNY,
          orderIndex: 1,
        },
      ],
      context,
    );
    expect(sanitized[0].placeName).toBe('浅草寺');
    expect(sanitized[1].placeName).toBeUndefined();
  });

  it('buildFallbackActivities supplies curated nearby spots', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = { origin: '京都', destinations: ['清水寺'] };
    const activities = pipeline.buildFallbackActivities({
      scenario: DayScenario.SUNNY,
      dayIndex: 0,
      date: '2025-01-01',
      draft,
    });
    const placeNames = activities.map((activity: any) => activity.placeName);
    expect(placeNames).toContain('清水寺');
    expect(new Set(placeNames).size).toBe(placeNames.length);
  });

  it('buildFallbackActivities emits area-only entries when catalog is missing', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = { origin: '東京', destinations: ['架空都市'] };
    const activities = pipeline.buildFallbackActivities({
      scenario: DayScenario.SUNNY,
      dayIndex: 0,
      date: '2025-02-01',
      draft,
    });
    expect(activities.length).toBeGreaterThan(0);
    expect(
      activities.every((activity: any) => activity.placeName === undefined),
    ).toBe(true);
    expect(activities[0].area).toMatch(/(都|道|府|県|市|区|町|村|郡|市街地)/);
  });

  it('normalizeDays enforces paired time slots for sunny/rainy scenarios', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = {
      origin: '京都',
      destinations: ['清水寺'],
    };
    const normalization = pipeline.normalizeDays(
      [
        {
          dayIndex: 0,
          date: '2025-01-01',
          scenario: 'SUNNY',
          activities: [
            {
              time: '08:30',
              area: '東山',
              placeName: '八坂神社',
              category: 'SIGHTSEEING',
              description: '境内を参拝する',
              orderIndex: 0,
            },
            {
              time: '12:15',
              area: '四条',
              placeName: '喫茶ソワレ',
              category: 'FOOD',
              description: 'クリームソーダで休憩',
              orderIndex: 1,
            },
            {
              time: '18:00',
              area: '祇園',
              placeName: '祇園花見小路',
              category: 'SIGHTSEEING',
              description: '夜の花街を散策',
              orderIndex: 2,
            },
          ],
        },
        {
          dayIndex: 0,
          date: '2025-01-01',
          scenario: 'RAINY',
          activities: [
            {
              time: '09:45',
              area: '七条',
              placeName: '京都国立博物館',
              category: 'OTHER',
              description: '屋内展示を鑑賞',
              orderIndex: 0,
            },
            {
              time: '13:30',
              area: '四条',
              placeName: 'イノダコーヒ 本店',
              category: 'FOOD',
              description: '雨でも安心の老舗喫茶でランチ',
              orderIndex: 1,
            },
          ],
        },
      ],
      { draft, totalDates: ['2025-01-01'], expectedDayIndexes: [0] },
    );
    const sunnyDay = normalization.days.find(
      (day: any) => day.scenario === DayScenario.SUNNY,
    );
    const rainyDay = normalization.days.find(
      (day: any) => day.scenario === DayScenario.RAINY,
    );
    expect(sunnyDay.activities).toHaveLength(rainyDay.activities.length);
    expect(sunnyDay.activities.map((a: any) => a.time)).toEqual(
      rainyDay.activities.map((a: any) => a.time),
    );
  });

  it('normalizeDays injects missing landmark activities', () => {
    const pipeline = new AiPipeline({} as any, {} as any) as any;
    const draft = {
      origin: '京都',
      destinations: ['清水寺'],
    };
    const normalization = pipeline.normalizeDays(
      [
        {
          dayIndex: 0,
          date: '2025-01-01',
          scenario: 'SUNNY',
          activities: [
            {
              time: '10:00',
              area: '東山',
              placeName: '祇園花見小路',
              category: 'SIGHTSEEING',
              description: '町歩き',
              orderIndex: 0,
            },
          ],
        },
        {
          dayIndex: 0,
          date: '2025-01-01',
          scenario: 'RAINY',
          activities: [
            {
              time: '11:00',
              area: '七条',
              placeName: '京都国立博物館',
              category: 'OTHER',
              description: '展示を鑑賞',
              orderIndex: 0,
            },
          ],
        },
      ],
      { draft, totalDates: ['2025-01-01'], expectedDayIndexes: [0] },
    );
    const hasLandmark = normalization.days.some((day: any) =>
      day.activities.some((activity: any) => activity.placeName === '清水寺'),
    );
    expect(hasLandmark).toBe(true);
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
        update: jest.fn(() =>
          Promise.resolve({ id: 'job1', draft: baseDraft }),
        ),
      },
      aiGenerationAudit: {
        create: jest.fn((data: any) => {
          audits.push(data);
          return Promise.resolve(data);
        }),
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
      generate: jest.fn(() =>
        Promise.resolve({
          rawText:
            '```json{"title":"trip","days":[{"dayIndex":0,"date":"2025-01-01","scenario":"SUNNY","activities":[{"time":"09:00","area":"名古屋駅周辺","placeName":"A","category":"FOOD","description":"B","stayMinutes":60,"weather":"SUN","orderIndex":0}]}]} ```',
          rawResponse: {},
          request: {},
        }),
      ),
    } as any;

    const pipeline = new AiPipeline(prisma, provider);
    const result = await pipeline.run('job1', 'cid-1', {
      model: 'gemini-pro',
      temperature: 0.3,
      targetDays: [],
      promptHash: 'hash',
    });

    expect(result.status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(result.partialDays).toEqual([0]);
    expect(prisma.aiGenerationAudit.create).toHaveBeenCalled();
  });

  it('fails after retries on parse errors', async () => {
    const prisma = mockPrisma();
    const provider = {
      generate: jest.fn(() =>
        Promise.resolve({
          rawText: 'not-json',
          rawResponse: 'not-json',
          request: {},
        }),
      ),
    } as any;

    const pipeline = new AiPipeline(prisma, provider);
    const result = await pipeline.run('job1', 'cid-2', {
      model: 'gemini-pro',
      temperature: 0.3,
      targetDays: [],
      promptHash: 'hash',
    });

    expect(result.status).toBe(GenerationJobStatus.FAILED);
    // At least one audit per attempt + final failure
    expect(prisma._audits.length).toBeGreaterThanOrEqual(2);
  });
});
