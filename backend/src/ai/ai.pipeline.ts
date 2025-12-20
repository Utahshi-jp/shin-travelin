import { Injectable, Logger } from '@nestjs/common';
import {
  DayScenario,
  GenerationJobStatus,
  Prisma,
  SpotCategory,
  Weather,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import {
  GeminiProvider,
  GeminiProviderError,
} from './providers/gemini.provider';
import { jsonrepair } from 'jsonrepair';
import {
  DESTINATION_FALLBACK_LIBRARY,
  DESTINATION_PLACE_ALIAS,
  DestinationFallbackSpot,
} from './destination-library';

type DraftWithCompanion = Prisma.DraftGetPayload<{
  include: { companionDetail: true };
}>;

type RunOptions = {
  model: string;
  temperature: number;
  targetDays: number[];
  promptHash: string;
};

type NormalizedActivity = {
  time: string;
  area: string;
  placeName?: string;
  category: SpotCategory;
  description: string;
  stayMinutes?: number;
  weather: Weather;
  orderIndex: number;
};

type NormalizedDay = {
  dayIndex: number;
  date: string;
  scenario: DayScenario;
  activities: NormalizedActivity[];
};

type NormalizedDayResult = {
  days: NormalizedDay[];
  llmDayCount: number;
  llmDayIndexes: number[];
};

type DestinationKind = 'ADMIN_AREA' | 'LANDMARK';

type DestinationInsight = {
  raw: string;
  normalized: string;
  kind: DestinationKind;
};

const activitySchema = z.object({
  time: z.string().min(1),
  area: z.string().optional(),
  placeName: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  stayMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  weather: z.string().optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
});

const daySchema = z.object({
  // Why: LLM 出力では dayIndex が文字列で返るケースがあるため number coercion を許可。
  dayIndex: z.coerce.number().int().min(0),
  date: z.string(),
  // Why: Gemini sometimes omits scenario even though prompt enforces it; allow fallback to SUNNY during normalization。
  scenario: z.string().min(3).max(10).optional(),
  // Why: activities 内の欠落値は後段で個別検証し、不正項目のみ除去する。
  activities: z.array(z.any()).default([]),
});

const itinerarySchema = z.object({
  title: z.string().min(1).max(120),
  days: z.array(daySchema).min(1),
});

const ITINERARY_SCHEMA_TEXT = `JSON schema:
{
  "title": string (1-120 chars),
  "days": [
    {
      "dayIndex": number (0-based),
      "date": ISO-8601 date string,
      "scenario": "SUNNY" | "RAINY",
      "activities": [
        {
          "time": "HH:mm",
          "area": string(1-200),
          "placeName"?: string(1-200),
          "category": "FOOD"|"SIGHTSEEING"|"MOVE"|"REST"|"STAY"|"SHOPPING"|"OTHER",
          "description": string(1-500),
          "stayMinutes"?: number,
          "weather": string,
          "orderIndex": number
        }
      ]
    }
  ]
}`;

// Why: detail-design §4.2/AI-3 expects partial success to be reflected explicitly; we keep enum as SUCCEEDED but surface partialDays via error code.
const PARTIAL_SUCCESS_STATUS = GenerationJobStatus.SUCCEEDED;

const BACKOFF = [1000, 3000, 7000, 15000]; // Why: 503/429 を吸収するため試行を増やし、後半は長めに待つ。
const MIN_ACTIVITIES_PER_SCENARIO = 4;
const DEFAULT_TIME_SLOTS = ['09:00', '11:30', '14:30', '18:00', '20:00'];
const MAX_ACTIVITIES_PER_SCENARIO = DEFAULT_TIME_SLOTS.length;
const AREA_SLOT_LABELS = [
  'モーニング',
  'ランチ',
  'アフタヌーン',
  'イブニング',
  'ナイト',
];
const CONCRETE_PLACE_SUFFIX_RE =
  /(寺|神社|城|塔|タワー|天守|庭園|庭|園|公園|市場|商店街|通り|坂|橋|港|桟橋|温泉|湯|浴場|茶屋|酒造|蔵|美術館|博物館|資料館|館|ホール|劇場|スタジアム|アリーナ|ドーム|モール|百貨店|ビル|ミュージアム|ギャラリー|ホテル|旅館|カフェ|レストラン|ダイナー|バー|食堂|神殿|廟|展望台|ロープウェイ|ケーブルカー|岬|滝|渓谷|砂丘|海岸|ビーチ)$/u;
const REAL_PLACE_COMPLEXITY_RE =
  /([\p{Script=Han}]{2,})|([\p{Script=Katakana}ー]{3,})|([A-Za-z][A-Za-z &'-]{2,})/u;
const ADMIN_SUFFIXES = ['都', '道', '府', '県', '市', '区', '町', '村', '郡'];
const ADMIN_KEYWORDS = [
  'prefecture',
  'city',
  'ward',
  'town',
  'village',
  'district',
];
const ABSTRACT_PLACEHOLDER_RE =
  /^(の)?(朝|昼|夜)?(散策|周辺|周遊|散歩|散策プラン|ウォーク|ハイキング|ツアー|体験|文化体験|カフェ|ティータイム|ランチ|ディナー|グルメ|食事|ごはん|ブレックファスト|モーニング|イブニング|ショッピング|マーケット)$/i;
const GENERIC_PLACEHOLDER_PATTERNS = [
  /周辺の?(?:カフェ|喫茶|レストラン)/,
  /周辺散策/,
  /(?:朝|昼|夜)散策/,
  /文化体験/,
  /フードツアー/,
  /人気スポット/,
];

const MUNICIPAL_SUFFIX_RE = /(都|道|府|県|市|区|町|村|郡)$/u;
const MUNICIPAL_EN_SUFFIX_RE = /(prefecture|city|ward|district|town|village)$/i;
const ROMAJI_MUNICIPAL_MAP: Record<string, string> = {
  tokyo: '東京都',
  osaka: '大阪市',
  kyoto: '京都市',
  sapporo: '札幌市',
  nagoya: '名古屋市',
  yokohama: '横浜市',
  fukuoka: '福岡市',
  sendai: '仙台市',
  kobe: '神戸市',
  naha: '那覇市',
  hiroshima: '広島市',
  kumamoto: '熊本市',
  kanazawa: '金沢市',
  chiba: '千葉市',
  saitama: 'さいたま市',
  kawasaki: '川崎市',
  niigata: '新潟市',
  okayama: '岡山市',
  shizuoka: '静岡市',
  nara: '奈良市',
  kagoshima: '鹿児島市',
};

const KANJI_MUNICIPAL_OVERRIDES: Record<string, string> = {
  東京: '東京都',
  大阪: '大阪市',
  京都: '京都市',
  札幌: '札幌市',
  名古屋: '名古屋市',
  横浜: '横浜市',
  仙台: '仙台市',
  神戸: '神戸市',
  福岡: '福岡市',
  広島: '広島市',
  熊本: '熊本市',
  那覇: '那覇市',
  金沢: '金沢市',
  静岡: '静岡市',
  岡山: '岡山市',
  奈良: '奈良市',
};

type ScenarioPair = {
  sunny?: NormalizedDay;
  rainy?: NormalizedDay;
};

const CATALOG_NAME_INDEX = buildCatalogNameIndex();
const CATALOG_ALIAS_INDEX = buildCatalogAliasIndex();

function normalizePlaceKey(value?: string | null) {
  if (!value) return '';
  return value.replace(/[-\s・‐]/g, '').toLowerCase();
}

function buildCatalogNameIndex() {
  const index = new Map<string, string>();
  DESTINATION_FALLBACK_LIBRARY.forEach((entry) => {
    entry.spots.forEach((spot) => {
      if (!spot.placeName) return;
      index.set(normalizePlaceKey(spot.placeName), spot.placeName);
    });
  });
  return index;
}

function buildCatalogAliasIndex() {
  const index = new Map<string, string>();
  Object.entries(DESTINATION_PLACE_ALIAS).forEach(([alias, canonical]) => {
    const canonicalKey = normalizePlaceKey(canonical);
    if (!CATALOG_NAME_INDEX.has(canonicalKey)) return;
    index.set(normalizePlaceKey(alias), CATALOG_NAME_INDEX.get(canonicalKey)!);
  });
  return index;
}

function sleep(ms: number) {
  if (process.env.NODE_ENV === 'test') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preview(value: unknown, limit = 1500) {
  try {
    if (typeof value === 'string') {
      return value.length > limit ? `${value.slice(0, limit)}…` : value;
    }
    const serialized = JSON.stringify(value);
    return serialized.length > limit
      ? `${serialized.slice(0, limit)}…`
      : serialized;
  } catch {
    return '[unserializable]';
  }
}

// Why: Gemini はしばしば ```json ... ``` を付けるため、前後のフェンス/余計な文章を除去してパーサを安定化する。
export function stripCodeFence(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();

  // Fallback: handle missing closing fence or leading fence without closing by stripping first fence line.
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split(/\r?\n/);
    // drop first line (``` or ```json)
    const withoutHead = lines.slice(1).join('\n');
    const withoutTail = withoutHead.replace(/```\s*$/, '');
    const candidate = withoutTail.trim();
    if (candidate.startsWith('{') || candidate.startsWith('['))
      return candidate;
  }

  // As a last resort, try to extract from first '{' to last '}' to recover partial JSON.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }

  return trimmed;
}

@Injectable()
export class AiPipeline {
  private readonly logger = new Logger(AiPipeline.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiProvider,
  ) {}

  private buildPrompt(
    draft: DraftWithCompanion,
    targetDays: number[],
    totalDates: string[],
  ): string {
    const daysText = targetDays.length
      ? targetDays.map((d) => totalDates[d]).filter(Boolean)
      : totalDates;
    const destinations = draft.destinations ?? [];
    const destinationGuidelines = this.buildDestinationGuidelines(destinations);
    const destinationExamples = this.buildDestinationExamples(destinations);

    return [
      'You are a travel planner. Generate concise itinerary JSON only.',
      `Origin: ${draft.origin}`,
      `Destinations: ${draft.destinations.join(', ')}`,
      `Date range: ${draft.startDate.toISOString().slice(0, 10)} to ${draft.endDate.toISOString().slice(0, 10)}`,
      `Budget: ${draft.budget}`,
      `Purposes: ${draft.purposes.join(', ')}`,
      `Companions: ${JSON.stringify(draft.companionDetail ?? {})}`,
      `Target days: ${targetDays.length ? targetDays.join(',') : 'all'}`,
      'Output rules:',
      '- すべての項目（title, activities.area, activities.description, weather）は自然な日本語で書く。',
      '- 各日・各シナリオで朝/昼/午後/夜の少なくとも4アクティビティを時系列で用意する。',
      '- time は 24時間表記 HH:mm (例: 09:30) でゼロ埋めする。',
      '- area は必ず「京都市東山区」「札幌市中央区」のように市区町村（必要に応じて区・町・村まで）で書き、必要なら後ろに簡潔な地区ラベルを付ける。placeName は必ず実在する施設・店舗・寺社など固有名詞で記載する。',
      '- category は FOOD / SIGHTSEEING / MOVE / REST / STAY / SHOPPING / OTHER のいずれかを選ぶ。',
      '- description は体験内容を1文で説明し、雨天シナリオでは屋内プランにする。',
      '- stayMinutes は分単位で推定を入れる（例: 60）。不明な場合は省略できる。',
      '- weather は日本語または SUNNY/RAINY のいずれかを指定し、orderIndex は0から昇順。',
      '- 同じ日付の "SUNNY" と "RAINY" は同じ時間帯セット (例: 09:00/11:30/14:30/18:00) を共有し、切り替え比較しやすくする。',
      'Reality guardrails:',
      '- すべての placeName は観光ガイドや地図に掲載されている実在スポットのみを使用し、推測で新しい名称を作らない。',
      '- 存在が曖昧な場合は別の確実に存在するスポットに置き換え、名称+エリアの組み合わせが現実の情報と矛盾しないようにする。',
      '- 実在が確実でない場合は placeName を出さず area のみを出力する。',
      '- 「<都市名><一般名詞>」のような合成名称（例: 京都文化ギャラリー）は禁止する。',
      '- 提供された Real POI list は検証済みスポット群。ここから必要数を選び、名称は旅程全体で重複させない。リスト外の固有名詞を使う場合も実在性が確認できるものに限る。',
      'For each date you MUST output two entries: scenario SUN=outdoor focus ("scenario":"SUNNY") and scenario RAIN=indoor focus ("scenario":"RAINY") sharing the same dayIndex/date.',
      'Keep SUNNY/RAINY scenarios for the same day within short travel distance to allow quick weather-based switching.',
      'Destination interpretation rules:',
      '- 県・市区町村など行政区域が目的地の場合は、その区域内にある実在スポットのみを組み合わせ、同日の placeName を重複させない。',
      '- 特定のランドマーク（寺社・タワー等）が目的地の場合は、そのスポットを1枠だけ使い、残りは徒歩または公共交通で30分以内に現実的に移動できる周辺エリアの実在スポットを配置する。',
      '- placeName に「◯◯周辺のカフェ」「◯◯散策」のような抽象表現を使わない。常に具体的な店名・施設名・名所を使う。',
      '- area には「祇園」「河原町」「清水寺周辺」のように土地勘が伝わる名称を入れる。',
      'Diversity requirements:',
      '- 同じ day 内で placeName を重複させない。連泊でも日を跨いで同じ placeName を再利用してはならず、旅程全体で1回のみ使用する。',
      '- 観光/食事/体験が連続しすぎないよう交互に配置し、移動時間を考慮した現実的な順序にする。',
      ...destinationGuidelines,
      ...destinationExamples,
      ITINERARY_SCHEMA_TEXT,
      'Respond with pure JSON. No code fences, no explanations.',
      'Ensure dayIndex matches the chronological order of date values.',
      daysText.length ? `Dates: ${daysText.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildRepairPrompt(
    basePrompt: string,
    lastError: string,
    expectedSchema: string,
  ) {
    return `${basePrompt}\nPrevious output failed because: ${lastError}. Please regenerate valid JSON that matches: ${expectedSchema}`;
  }

  private parseJsonWithRepair(text: string) {
    // First try strict JSON; if it fails, attempt a light repair (common: unterminated string, trailing commas).
    try {
      return JSON.parse(text);
    } catch {
      return JSON.parse(jsonrepair(text));
    }
  }

  private expandDates(start: Date, end: Date): string[] {
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private normalizeDays(
    days: unknown[],
    context: {
      draft: DraftWithCompanion;
      totalDates: string[];
      expectedDayIndexes: number[];
    },
  ): NormalizedDayResult {
    const dayMap = new Map<string, NormalizedDay>();
    let llmDayCount = 0;
    const llmDayIndexes = new Set<number>();

    for (const day of days) {
      const result = daySchema.safeParse(day);
      if (!result.success) continue;

      const scenario = this.normalizeScenario(result.data.scenario);
      if (!scenario) continue;

      const resolvedDate = this.normalizeDate(
        result.data.date,
        result.data.dayIndex,
        context.totalDates,
      );
      const normalizedActivities = this.normalizeActivities(
        result.data.activities,
        {
          scenario,
          dayIndex: result.data.dayIndex,
          draft: context.draft,
        },
      );
      const hydrated = this.ensureMinimumActivities(normalizedActivities, {
        scenario,
        dayIndex: result.data.dayIndex,
        date: resolvedDate,
        draft: context.draft,
      });
      const sanitized = this.validateAndSanitizeActivities(hydrated, {
        scenario,
        dayIndex: result.data.dayIndex,
        draft: context.draft,
      });

      const key = `${result.data.dayIndex}-${scenario}`;
      dayMap.set(key, {
        dayIndex: result.data.dayIndex,
        date: resolvedDate,
        scenario,
        activities: sanitized,
      });
      llmDayCount += 1;
      llmDayIndexes.add(result.data.dayIndex);
    }

    const fallbackIndexes =
      context.expectedDayIndexes.length > 0
        ? context.expectedDayIndexes
        : Array.from(llmDayIndexes).sort((a, b) => a - b);
    const lastKnownDate =
      context.totalDates[context.totalDates.length - 1] ??
      new Date().toISOString().slice(0, 10);
    const normalizedDays: NormalizedDay[] = [];

    fallbackIndexes.forEach((dayIndex) => {
      const date = context.totalDates[dayIndex] ?? lastKnownDate;
      [DayScenario.SUNNY, DayScenario.RAINY].forEach((scenario) => {
        const key = `${dayIndex}-${scenario}`;
        const existing = dayMap.get(key);
        if (existing) {
          normalizedDays.push(existing);
          return;
        }
        const fallbackActivities = this.ensureMinimumActivities([], {
          scenario,
          dayIndex,
          date,
          draft: context.draft,
        });
        const sanitizedFallback = this.validateAndSanitizeActivities(
          fallbackActivities,
          {
            scenario,
            dayIndex,
            draft: context.draft,
          },
        );
        normalizedDays.push({
          dayIndex,
          date,
          scenario,
          activities: sanitizedFallback,
        });
      });
    });

    const withLandmarks = this.ensureLandmarkAnchors(normalizedDays, {
      draft: context.draft,
      totalDates: context.totalDates,
    });
    const synchronizedDays = this.alignScenarioPairs(withLandmarks, {
      draft: context.draft,
    });
    const localizedDays = this.enforceScenarioProximity(synchronizedDays, {
      draft: context.draft,
    });
    const diversifiedDays = this.preventCrossDayPlaceReuse(localizedDays, {
      draft: context.draft,
    });

    return {
      days: diversifiedDays,
      llmDayCount,
      llmDayIndexes: Array.from(llmDayIndexes),
    };
  }

  private normalizeArea(
    value: string | undefined,
    context: {
      scenario: DayScenario;
      dayIndex: number;
      draft: DraftWithCompanion;
    },
    idx: number,
  ) {
    if (value && value.trim().length) {
      return value.trim().slice(0, 200);
    }
    const base = this.resolvePrimaryDestination(
      context.draft,
      context.dayIndex,
    );
    return this.buildFallbackAreaLabel(
      base,
      context.scenario,
      idx,
      context.draft,
    );
  }

  private buildFallbackAreaLabel(
    anchor: string,
    scenario: DayScenario,
    slotIndex: number,
    draft: DraftWithCompanion,
  ) {
    const municipality = this.deriveMunicipalityLabel(anchor, draft);
    const descriptor = scenario === DayScenario.SUNNY ? '屋外' : '屋内';
    const slotLabel =
      AREA_SLOT_LABELS[slotIndex % AREA_SLOT_LABELS.length] ?? 'プラン';
    return `${municipality}（${descriptor}/${slotLabel}）`;
  }

  private normalizePlaceName(
    value: string | undefined,
    context: { draft: DraftWithCompanion; dayIndex: number },
  ) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed.length) return undefined;
    const anchor = this.resolvePrimaryDestination(
      context.draft,
      context.dayIndex,
    );
    if (this.isAbstractPlaceName(trimmed, anchor)) return undefined;
    return trimmed.slice(0, 200);
  }

  private normalizeCategoryField(value?: string) {
    if (!value) return SpotCategory.SIGHTSEEING;
    const upper = value.trim().toUpperCase();
    if (
      (Object.keys(SpotCategory) as Array<keyof typeof SpotCategory>).includes(
        upper as keyof typeof SpotCategory,
      )
    ) {
      return SpotCategory[upper as keyof typeof SpotCategory];
    }
    switch (upper) {
      case 'EAT':
      case 'FOODS':
      case 'DINING':
        return SpotCategory.FOOD;
      case 'MOVE':
      case 'TRANSIT':
        return SpotCategory.MOVE;
      case 'REST':
      case 'BREAK':
        return SpotCategory.REST;
      case 'STAY':
      case 'HOTEL':
        return SpotCategory.STAY;
      case 'SHOP':
      case 'SHOPPING':
        return SpotCategory.SHOPPING;
      case 'SIGHT':
      case 'SIGHTSEEING':
        return SpotCategory.SIGHTSEEING;
      default:
        return SpotCategory.OTHER;
    }
  }

  private normalizeDescription(
    value: string | undefined,
    context: {
      scenario: DayScenario;
      dayIndex: number;
      draft: DraftWithCompanion;
    },
    idx: number,
  ) {
    if (value && value.trim().length) {
      return value.trim().slice(0, 500);
    }
    const scenarioLabel =
      context.scenario === DayScenario.SUNNY ? '屋外' : '屋内';
    return `${this.resolvePrimaryDestination(context.draft, context.dayIndex)}で${scenarioLabel}の体験を楽しみます (${idx + 1}件目)`;
  }

  private normalizeStayMinutes(value?: number) {
    if (!Number.isFinite(value)) return undefined;
    const clamped = Math.max(5, Math.min(Number(value), 1440));
    return clamped;
  }

  private normalizeActivities(
    activities: unknown[],
    context: {
      scenario: DayScenario;
      dayIndex: number;
      draft: DraftWithCompanion;
    },
  ) {
    const normalized: NormalizedActivity[] = [];
    const usedNames = new Set<string>();
    activities.forEach((activity, idx) => {
      if (!activity || typeof activity !== 'object') return;
      const candidate = activitySchema.safeParse(activity);
      if (!candidate.success) return;

      const data = candidate.data;
      const time = this.normalizeTime(data.time, idx);
      const area = this.normalizeArea(data.area, context, idx);
      const placeName = this.normalizePlaceName(data.placeName, context);
      if (placeName) {
        const placeKey = normalizePlaceKey(placeName);
        if (usedNames.has(placeKey)) return;
        usedNames.add(placeKey);
      }
      const category = this.normalizeCategoryField(data.category);
      const description = this.normalizeDescription(
        data.description,
        context,
        idx,
      );
      const stayMinutes = this.normalizeStayMinutes(data.stayMinutes);
      const weather = this.normalizeWeatherField(
        data.weather,
        context.scenario,
      );
      const orderIndex = Number.isFinite(data.orderIndex)
        ? Number(data.orderIndex)
        : normalized.length;

      normalized.push({
        time,
        area,
        placeName,
        category,
        description,
        stayMinutes,
        weather,
        orderIndex,
      });
    });
    return normalized;
  }

  private normalizeScenario(value?: string): DayScenario | null {
    if (!value) return DayScenario.SUNNY;
    const upper = value.trim().toUpperCase();
    if (upper.startsWith('RAIN')) return DayScenario.RAINY;
    if (upper.startsWith('SUN')) return DayScenario.SUNNY;
    return DayScenario.SUNNY;
  }

  private normalizeDate(
    value: string | undefined,
    dayIndex: number,
    totalDates: string[],
  ) {
    const fallback =
      totalDates[dayIndex] ??
      totalDates[totalDates.length - 1] ??
      new Date().toISOString().slice(0, 10);
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      return fallback;
    }
    return parsed.toISOString().slice(0, 10);
  }

  private ensureMinimumActivities(
    activities: NormalizedActivity[],
    context: {
      scenario: DayScenario;
      dayIndex: number;
      date: string;
      draft: DraftWithCompanion;
    },
  ) {
    const sorted = [...activities].sort((a, b) => a.orderIndex - b.orderIndex);
    sorted.forEach((activity, idx) => {
      activity.orderIndex = idx;
    });

    if (sorted.length >= MIN_ACTIVITIES_PER_SCENARIO) return sorted;

    const usedTimes = new Set(sorted.map((activity) => activity.time));
    const fallbacks = this.buildFallbackActivities(context);
    for (const fallback of fallbacks) {
      if (sorted.length >= MIN_ACTIVITIES_PER_SCENARIO) break;
      let time = fallback.time;
      let attempt = 1;
      while (usedTimes.has(time) && attempt < 6) {
        time = this.shiftTime(fallback.time, attempt * 15);
        attempt += 1;
      }
      usedTimes.add(time);
      sorted.push({ ...fallback, time, orderIndex: sorted.length });
    }
    return sorted;
  }

  private validateAndSanitizeActivities(
    activities: NormalizedActivity[],
    context: {
      scenario: DayScenario;
      dayIndex: number;
      draft: DraftWithCompanion;
    },
  ) {
    const seen = new Set<string>();
    return activities.map((activity, idx) => {
      const area = this.normalizeArea(activity.area, context, idx);
      let placeName = activity.placeName;
      if (!this.isVerifiablyRealPlace(placeName)) {
        placeName = undefined;
      } else if (placeName) {
        placeName = this.resolveRealPlaceName(placeName);
        if (placeName) {
          const key = normalizePlaceKey(placeName);
          if (seen.has(key)) {
            placeName = undefined;
          } else {
            seen.add(key);
          }
        }
      }
      return { ...activity, area, placeName };
    });
  }

  private buildFallbackActivities(
    context: {
      scenario: DayScenario;
      dayIndex: number;
      date: string;
      draft: DraftWithCompanion;
    },
    desiredCount = DEFAULT_TIME_SLOTS.length,
  ) {
    const baseDestination = this.resolvePrimaryDestination(
      context.draft,
      context.dayIndex,
    );
    const insight = this.interpretDestination(baseDestination);
    const weather =
      context.scenario === DayScenario.SUNNY ? Weather.SUNNY : Weather.RAINY;
    const scenarioLabel =
      context.scenario === DayScenario.SUNNY ? '屋外' : '屋内';
    const curated = this.findFallbackSpotPresets(baseDestination) ?? [];
    const deduped: DestinationFallbackSpot[] = [];
    const seen = new Set<string>();

    const registerSpot = (spot: DestinationFallbackSpot) => {
      const key = spot.placeName
        ? `poi:${normalizePlaceKey(spot.placeName)}`
        : `area:${spot.area}:${spot.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      deduped.push(spot);
      return true;
    };

    curated.forEach(registerSpot);

    if (deduped.length < MIN_ACTIVITIES_PER_SCENARIO) {
      const generic = this.buildGenericFallbackSpots(insight, context.draft);
      for (const spot of generic) {
        registerSpot(spot);
        if (deduped.length >= MIN_ACTIVITIES_PER_SCENARIO) break;
      }
    }

    const slotLimit = Math.max(deduped.length, MIN_ACTIVITIES_PER_SCENARIO);
    const desired = Math.max(desiredCount, MIN_ACTIVITIES_PER_SCENARIO);
    const slotCount = Math.min(desired, slotLimit, MAX_ACTIVITIES_PER_SCENARIO);
    const selected = deduped.slice(0, slotCount);
    return selected.map((spot, idx) => ({
      time: this.deriveFallbackTime(idx),
      area: spot.area,
      placeName: spot.placeName ?? undefined,
      category: spot.category,
      description: this.decorateFallbackDescription(
        spot.description,
        scenarioLabel,
        context.scenario,
      ),
      stayMinutes: spot.stayMinutes,
      weather,
      orderIndex: idx,
    }));
  }

  private decorateFallbackDescription(
    base: string,
    scenarioLabel: string,
    scenario: DayScenario,
  ) {
    const trimmed = (base ?? '').trim();
    if (!trimmed.length) {
      return `${scenarioLabel}で過ごしながら地域の空気を感じます。`;
    }
    if (scenario === DayScenario.RAINY && !/(雨|屋内|室内)/.test(trimmed)) {
      return `${trimmed}（屋内中心で雨の日も快適）`;
    }
    return trimmed;
  }

  private findFallbackSpotPresets(
    anchor: string,
  ): DestinationFallbackSpot[] | null {
    if (!anchor) return null;
    const matched = DESTINATION_FALLBACK_LIBRARY.find((entry) =>
      entry.matchers.some((matcher) => matcher.test(anchor)),
    );
    return matched ? matched.spots : null;
  }

  private buildGenericFallbackSpots(
    insight: DestinationInsight,
    draft: DraftWithCompanion,
  ): DestinationFallbackSpot[] {
    const baseMunicipality = this.deriveMunicipalityLabel(
      insight.normalized || insight.raw,
      draft,
    );
    const scenicArea = `${baseMunicipality}（歴史散策）`;
    const marketArea = `${baseMunicipality}（マーケット）`;
    const cultureArea = `${baseMunicipality}（文化施設）`;
    const shoppingArea = `${baseMunicipality}（中心商店街）`;
    const relaxationArea = `${baseMunicipality}（リラクゼーション）`;
    return [
      {
        area: scenicArea,
        category: SpotCategory.SIGHTSEEING,
        description: `${baseMunicipality}の代表的な史跡エリアを散策し、ランドマークを外観から楽しみます。`,
        stayMinutes: 60,
      },
      {
        area: marketArea,
        category: SpotCategory.FOOD,
        description: `${baseMunicipality}の市場で郷土料理やスイーツを食べ歩きます。`,
        stayMinutes: 55,
      },
      {
        area: cultureArea,
        category: SpotCategory.OTHER,
        description: `${baseMunicipality}に点在する文化施設で屋内展示を鑑賞します。`,
        stayMinutes: 70,
      },
      {
        area: shoppingArea,
        category: SpotCategory.SHOPPING,
        description: `${baseMunicipality}の中心商店街で土産やクラフトを探します。`,
        stayMinutes: 45,
      },
      {
        area: relaxationArea,
        category: SpotCategory.REST,
        description: `${baseMunicipality}のカフェやラウンジで休憩しつつ次の移動に備えます。`,
        stayMinutes: 60,
      },
    ];
  }

  private buildDestinationGuidelines(destinations: string[]) {
    if (!Array.isArray(destinations) || !destinations.length) return [];
    const seen = new Set<string>();
    const lines: string[] = [];
    destinations.forEach((dest) => {
      if (typeof dest !== 'string') return;
      const trimmed = dest.trim();
      if (!trimmed.length || seen.has(trimmed)) return;
      seen.add(trimmed);
      const insight = this.interpretDestination(trimmed);
      if (insight.kind === 'ADMIN_AREA') {
        lines.push(
          `- 「${insight.raw}」は行政区域。境界内で朝昼晩それぞれ異なる実在スポットを確実に選ぶ。`,
        );
      } else {
        lines.push(
          `- 「${insight.raw}」はランドマーク。行程全体で1枠に留め、残りは徒歩または公共交通で30分以内の具体的な施設名にする。`,
        );
      }
    });
    return lines;
  }

  private deriveMunicipalityLabel(
    anchor: string | undefined,
    draft?: DraftWithCompanion,
  ) {
    const trimmed = (anchor ?? '').trim();
    if (trimmed.length) {
      const catalogArea = this.findFallbackSpotPresets(trimmed)?.find(
        (spot) => spot.area,
      )?.area;
      if (catalogArea) return catalogArea;
      if (this.looksLikeMunicipality(trimmed)) return trimmed;
      if (KANJI_MUNICIPAL_OVERRIDES[trimmed])
        return KANJI_MUNICIPAL_OVERRIDES[trimmed];
      const romaji = this.convertRomajiMunicipality(trimmed);
      if (romaji) return romaji;
    }

    const draftMunicipality = this.extractMunicipalityFromDraft(draft);
    if (draftMunicipality) return draftMunicipality;

    if (trimmed.length) {
      const normalized = this.stripAdministrativeSuffix(trimmed) || trimmed;
      return `${normalized}市街地`;
    }
    return '目的地市街地';
  }

  private extractMunicipalityFromDraft(draft?: DraftWithCompanion) {
    if (!draft) return null;
    const candidates = [
      ...(Array.isArray(draft.destinations) ? draft.destinations : []),
      draft.origin,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed.length) continue;
      if (this.looksLikeMunicipality(trimmed)) return trimmed;
      if (KANJI_MUNICIPAL_OVERRIDES[trimmed])
        return KANJI_MUNICIPAL_OVERRIDES[trimmed];
      const romaji = this.convertRomajiMunicipality(trimmed);
      if (romaji) return romaji;
    }
    return null;
  }

  private looksLikeMunicipality(value: string) {
    return (
      MUNICIPAL_SUFFIX_RE.test(value) || MUNICIPAL_EN_SUFFIX_RE.test(value)
    );
  }

  private convertRomajiMunicipality(value: string) {
    const normalized = value
      .replace(/\s+/g, '')
      .replace(/[-_'’]/g, '')
      .toLowerCase();
    if (!normalized.length) return null;
    if (ROMAJI_MUNICIPAL_MAP[normalized])
      return ROMAJI_MUNICIPAL_MAP[normalized];
    const base = normalized.replace(
      /(city|prefecture|ward|district|town|village)$/i,
      '',
    );
    return ROMAJI_MUNICIPAL_MAP[base] ?? null;
  }

  private buildDestinationExamples(destinations: string[]) {
    if (!Array.isArray(destinations) || !destinations.length) return [];
    const seen = new Set<string>();
    const lines: string[] = [];
    destinations.forEach((dest) => {
      if (typeof dest !== 'string') return;
      const trimmed = dest.trim();
      if (!trimmed.length || seen.has(trimmed)) return;
      seen.add(trimmed);
      const matched = DESTINATION_FALLBACK_LIBRARY.find((entry) =>
        entry.matchers.some((matcher) => matcher.test(trimmed)),
      );
      if (matched) {
        const sampleNames = matched.spots
          .map((spot) => spot.placeName)
          .filter((name): name is string => Boolean(name));
        if (sampleNames.length) {
          lines.push(
            `- ${trimmed}周辺で確実に存在するスポット例: ${sampleNames.join(' / ')}`,
          );
        }
      }
    });
    return lines;
  }

  private resolveRealPlaceName(value?: string | null) {
    const trimmed = (value ?? '').trim();
    const key = normalizePlaceKey(trimmed);
    if (!key.length) return undefined;
    if (CATALOG_NAME_INDEX.has(key)) return CATALOG_NAME_INDEX.get(key);
    if (CATALOG_ALIAS_INDEX.has(key)) return CATALOG_ALIAS_INDEX.get(key);
    if (this.looksConcretePlaceName(trimmed)) return trimmed.slice(0, 200);
    return undefined;
  }

  private isVerifiablyRealPlace(placeName: string | undefined) {
    const trimmed = (placeName ?? '').trim();
    if (!trimmed.length) return false;
    const key = normalizePlaceKey(trimmed);
    if (CATALOG_NAME_INDEX.has(key) || CATALOG_ALIAS_INDEX.has(key))
      return true;
    return this.looksConcretePlaceName(trimmed);
  }

  private looksConcretePlaceName(name: string) {
    if (!name || name.length < 2) return false;
    if (CONCRETE_PLACE_SUFFIX_RE.test(name)) return true;
    return REAL_PLACE_COMPLEXITY_RE.test(name);
  }

  private interpretDestination(raw: string | undefined): DestinationInsight {
    const fallback = (raw ?? '').trim();
    if (!fallback.length) {
      return { raw: '', normalized: '', kind: 'LANDMARK' };
    }
    const normalized = fallback;
    const lower = normalized.toLowerCase();
    const hasAdminSuffix = ADMIN_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix),
    );
    const hasEnglishKeyword = ADMIN_KEYWORDS.some((keyword) =>
      lower.includes(keyword),
    );
    const hasRomajiSuffix = /(\b|-)(shi|ken|fu|to|ku|gun|machi|cho|son)$/i.test(
      normalized,
    );
    const kind: DestinationKind =
      hasAdminSuffix || hasEnglishKeyword || hasRomajiSuffix
        ? 'ADMIN_AREA'
        : 'LANDMARK';
    return { raw: fallback, normalized, kind };
  }

  private stripAdministrativeSuffix(value: string) {
    if (!value) return '';
    const trimmed = value.trim();
    const jp = trimmed.replace(/(都|道|府|県|市|区|郡|町|村)$/u, '');
    if (jp.length && jp.length !== trimmed.length) return jp;
    const en = trimmed.replace(
      /\s?(prefecture|city|ward|district|town|village)$/i,
      '',
    );
    if (en.length && en.length !== trimmed.length) return en;
    const romaji = trimmed.replace(
      /-(shi|ken|fu|to|ku|gun|machi|cho|son)$/i,
      '',
    );
    return romaji.length ? romaji : trimmed;
  }

  private isAbstractPlaceName(name: string, anchor: string) {
    const sanitized = name.replace(/[「」『』【】（）()]/g, '').trim();
    if (!sanitized.length) return true;
    const anchorNormalized = (anchor ?? '').replace(/\s+/g, '');
    const nameNormalized = sanitized.replace(/\s+/g, '');
    if (anchorNormalized.length && nameNormalized === anchorNormalized)
      return true;
    if (
      anchorNormalized.length &&
      nameNormalized.startsWith(anchorNormalized)
    ) {
      const remainder = nameNormalized
        .slice(anchorNormalized.length)
        .replace(/^[の・]/, '');
      if (!remainder.length) return true;
      if (ABSTRACT_PLACEHOLDER_RE.test(remainder)) return true;
    }
    if (GENERIC_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(sanitized)))
      return true;
    return false;
  }

  private normalizeTime(value: string | undefined, slotIndex: number) {
    const fallback =
      DEFAULT_TIME_SLOTS[Math.min(slotIndex, DEFAULT_TIME_SLOTS.length - 1)];
    if (!value) return fallback;

    const colonMatch = value.match(/(\d{1,2})[:：](\d{1,2})/);
    if (colonMatch) {
      const hour = this.clampHour(parseInt(colonMatch[1], 10));
      const minute = this.clampMinute(parseInt(colonMatch[2], 10));
      return this.formatTime(hour, minute);
    }

    const digitsOnly = value.replace(/[^\d]/g, '');
    if (digitsOnly.length >= 3) {
      const hourDigits = digitsOnly.slice(0, digitsOnly.length - 2);
      const minuteDigits = digitsOnly.slice(-2);
      const hour = this.clampHour(parseInt(hourDigits, 10));
      const minute = this.clampMinute(parseInt(minuteDigits, 10));
      return this.formatTime(hour, minute);
    }

    const hourMatch = value.match(/\d{1,2}/);
    if (hourMatch) {
      const hour = this.clampHour(parseInt(hourMatch[0], 10));
      return this.formatTime(hour, 0);
    }

    return fallback;
  }

  private deriveFallbackTime(slotIndex: number) {
    const base = DEFAULT_TIME_SLOTS[slotIndex % DEFAULT_TIME_SLOTS.length];
    const offset = Math.floor(slotIndex / DEFAULT_TIME_SLOTS.length) * 60;
    return this.shiftTime(base, offset);
  }

  private normalizeWeatherField(
    value: string | undefined,
    scenario: DayScenario,
  ): Weather {
    if (!value)
      return scenario === DayScenario.SUNNY ? Weather.SUNNY : Weather.RAINY;
    const upper = value.trim().toUpperCase();
    if (
      upper.includes('RAIN') ||
      upper.includes('RAINY') ||
      upper.includes('雨')
    )
      return Weather.RAINY;
    if (upper.includes('SUN') || upper.includes('晴')) return Weather.SUNNY;
    if (upper.includes('CLOUD')) return Weather.CLOUDY;
    return scenario === DayScenario.SUNNY ? Weather.SUNNY : Weather.RAINY;
  }

  private resolvePrimaryDestination(
    draft: DraftWithCompanion,
    dayIndex: number,
  ) {
    if (Array.isArray(draft.destinations) && draft.destinations.length) {
      const withinRange = draft.destinations[dayIndex];
      if (withinRange && withinRange.trim().length) return withinRange.trim();
      const first = draft.destinations.find(
        (dest) => dest && dest.trim().length,
      );
      if (first) return first.trim();
    }
    return draft.origin;
  }

  private shiftTime(base: string, minutes: number) {
    const totalMinutes = this.timeToMinutes(base) + minutes;
    const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return this.formatTime(hour, minute);
  }

  private timeToMinutes(time: string) {
    const [hourStr, minuteStr] = time.split(':');
    const hour = this.clampHour(parseInt(hourStr ?? '0', 10));
    const minute = this.clampMinute(parseInt(minuteStr ?? '0', 10));
    return hour * 60 + minute;
  }

  private formatTime(hour: number, minute: number) {
    const h = this.clampHour(hour).toString().padStart(2, '0');
    const m = this.clampMinute(minute).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private clampHour(value: number) {
    if (!Number.isFinite(value)) return 9;
    if (value < 0) return 0;
    if (value > 23) return 23;
    return value;
  }

  private clampMinute(value: number) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 59) return 59;
    return value;
  }

  private alignScenarioPairs(
    days: NormalizedDay[],
    context: { draft: DraftWithCompanion },
  ) {
    const grouped = this.groupDaysByIndex(days);
    const scopedDays = Array.from(grouped.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    scopedDays.forEach(([dayIndex, pair]) => {
      if (!pair.sunny || !pair.rainy) return;
      const targetLength = Math.min(
        Math.max(
          pair.sunny.activities.length,
          pair.rainy.activities.length,
          MIN_ACTIVITIES_PER_SCENARIO,
        ),
        MAX_ACTIVITIES_PER_SCENARIO,
      );
      pair.sunny.activities = this.extendScenarioActivities(
        pair.sunny.activities,
        targetLength,
        {
          scenario: DayScenario.SUNNY,
          dayIndex,
          date: pair.sunny.date,
          draft: context.draft,
        },
      );
      pair.rainy.activities = this.extendScenarioActivities(
        pair.rainy.activities,
        targetLength,
        {
          scenario: DayScenario.RAINY,
          dayIndex,
          date: pair.rainy.date,
          draft: context.draft,
        },
      );
      this.alignActivityTimes(pair.sunny.activities, pair.rainy.activities);
    });
    return this.flattenScenarioPairs(grouped);
  }

  private enforceScenarioProximity(
    days: NormalizedDay[],
    context: { draft: DraftWithCompanion },
  ) {
    const grouped = this.groupDaysByIndex(days);
    grouped.forEach((pair, dayIndex) => {
      if (!pair.sunny && !pair.rainy) return;
      const anchor = this.resolvePrimaryDestination(context.draft, dayIndex);
      const municipality = this.deriveMunicipalityLabel(anchor, context.draft);

      if (pair.sunny && pair.rainy) {
        this.alignActivityLocales(
          pair.sunny,
          pair.rainy,
          municipality,
          dayIndex,
          context.draft,
        );
        return;
      }

      if (pair.sunny) {
        pair.sunny.activities = this.localizeSingleScenario(
          pair.sunny.activities,
          {
            municipality,
            scenario: DayScenario.SUNNY,
            dayIndex,
            draft: context.draft,
          },
        );
      }
      if (pair.rainy) {
        pair.rainy.activities = this.localizeSingleScenario(
          pair.rainy.activities,
          {
            municipality,
            scenario: DayScenario.RAINY,
            dayIndex,
            draft: context.draft,
          },
        );
      }
    });
    return this.flattenScenarioPairs(grouped);
  }

  private preventCrossDayPlaceReuse(
    days: NormalizedDay[],
    context: { draft: DraftWithCompanion },
  ) {
    const seen = new Set<string>();
    const fallbackCache = new Map<string, NormalizedActivity[]>();
    return days.map((day) => {
      const updated = day.activities.map((activity) => {
        if (!activity.placeName) return activity;
        const key = normalizePlaceKey(activity.placeName);
        if (!key.length) return activity;
        if (!seen.has(key)) {
          seen.add(key);
          return activity;
        }

        const substitution = this.pickFallbackReplacement(
          day,
          context.draft,
          seen,
          fallbackCache,
        );
        if (substitution) {
          const replacement = {
            ...activity,
            area: substitution.area,
            placeName: substitution.placeName,
            category: substitution.category,
            description: substitution.description,
            stayMinutes: substitution.stayMinutes,
          };
          if (replacement.placeName) {
            const nextKey = normalizePlaceKey(replacement.placeName);
            if (nextKey.length) {
              seen.add(nextKey);
            }
          }
          return replacement;
        }

        const scenarioLabel =
          day.scenario === DayScenario.SUNNY ? '屋外' : '屋内';
        const fallbackArea = this.buildFallbackAreaLabel(
          this.resolvePrimaryDestination(context.draft, day.dayIndex),
          day.scenario,
          activity.orderIndex,
          context.draft,
        );
        return {
          ...activity,
          area: fallbackArea,
          placeName: undefined,
          description: this.decorateFallbackDescription(
            activity.description ?? `${fallbackArea}で別のスポットを巡ります。`,
            scenarioLabel,
            day.scenario,
          ),
        };
      });
      return { ...day, activities: updated };
    });
  }

  private pickFallbackReplacement(
    day: NormalizedDay,
    draft: DraftWithCompanion,
    seen: Set<string>,
    cache: Map<string, NormalizedActivity[]>,
  ): Pick<
    NormalizedActivity,
    'area' | 'placeName' | 'category' | 'description' | 'stayMinutes'
  > | null {
    const cacheKey = `${day.dayIndex}-${day.scenario}`;
    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        this.buildFallbackActivities(
          {
            scenario: day.scenario,
            dayIndex: day.dayIndex,
            date: day.date,
            draft,
          },
          MAX_ACTIVITIES_PER_SCENARIO * 2,
        ),
      );
    }
    const queue = cache.get(cacheKey)!;
    while (queue.length) {
      const candidate = queue.shift()!;
      const candidateKey = candidate.placeName
        ? normalizePlaceKey(candidate.placeName)
        : '';
      if (candidateKey && seen.has(candidateKey)) continue;
      return {
        area: candidate.area,
        placeName: candidate.placeName ?? undefined,
        category: candidate.category,
        description: candidate.description,
        stayMinutes: candidate.stayMinutes,
      };
    }
    return null;
  }

  private extendScenarioActivities(
    activities: NormalizedActivity[],
    targetLength: number,
    context: {
      scenario: DayScenario;
      dayIndex: number;
      date: string;
      draft: DraftWithCompanion;
    },
  ) {
    const sorted = [...activities]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .slice(0, targetLength)
      .map((activity, idx) => ({ ...activity, orderIndex: idx }));

    if (sorted.length >= targetLength) return sorted;

    const fallbacks = this.buildFallbackActivities(context, targetLength);
    const signature = (activity: NormalizedActivity) =>
      `${activity.area}:${normalizePlaceKey(activity.placeName ?? '')}:${activity.category}`;
    const seen = new Set(sorted.map(signature));

    for (const fallback of fallbacks) {
      if (sorted.length >= targetLength) break;
      const nextSignature = signature(fallback);
      if (seen.has(nextSignature)) continue;
      seen.add(nextSignature);
      sorted.push({ ...fallback, orderIndex: sorted.length });
    }

    while (sorted.length < targetLength) {
      const placeholderIndex = sorted.length;
      sorted.push({
        time: this.deriveFallbackTime(placeholderIndex),
        area: this.buildFallbackAreaLabel(
          this.resolvePrimaryDestination(context.draft, context.dayIndex),
          context.scenario,
          placeholderIndex,
          context.draft,
        ),
        placeName: undefined,
        category: SpotCategory.OTHER,
        description: this.decorateFallbackDescription(
          '代替プランとして柔軟に過ごします。',
          '屋内外',
          context.scenario,
        ),
        stayMinutes: 60,
        weather:
          context.scenario === DayScenario.SUNNY
            ? Weather.SUNNY
            : Weather.RAINY,
        orderIndex: placeholderIndex,
      });
    }

    return sorted;
  }

  private alignActivityTimes(
    sunnyActivities: NormalizedActivity[],
    rainyActivities: NormalizedActivity[],
  ) {
    const slots = Math.max(sunnyActivities.length, rainyActivities.length);
    const usedTimes = new Set<string>();
    for (let idx = 0; idx < slots; idx += 1) {
      const fallback = this.deriveFallbackTime(idx);
      let time =
        sunnyActivities[idx]?.time ?? rainyActivities[idx]?.time ?? fallback;
      if (!time) time = fallback;
      while (usedTimes.has(time)) {
        time = this.shiftTime(time, 5);
      }
      usedTimes.add(time);
      if (sunnyActivities[idx]) {
        sunnyActivities[idx] = {
          ...sunnyActivities[idx],
          time,
          orderIndex: idx,
        };
      }
      if (rainyActivities[idx]) {
        rainyActivities[idx] = {
          ...rainyActivities[idx],
          time,
          orderIndex: idx,
        };
      }
    }
  }

  private alignActivityLocales(
    sunny: NormalizedDay,
    rainy: NormalizedDay,
    municipality: string,
    dayIndex: number,
    draft: DraftWithCompanion,
  ) {
    const slots = Math.max(sunny.activities.length, rainy.activities.length);
    for (let idx = 0; idx < slots; idx += 1) {
      const preferredArea = this.pickPreferredArea(
        municipality,
        sunny.activities[idx]?.area,
        rainy.activities[idx]?.area,
      );
      if (sunny.activities[idx]) {
        sunny.activities[idx] = {
          ...sunny.activities[idx],
          area: this.ensureScenarioAreaLabel(
            sunny.activities[idx].area,
            preferredArea,
            municipality,
            DayScenario.SUNNY,
            idx,
            draft,
            dayIndex,
          ),
          description: this.ensureScenarioDescription(
            sunny.activities[idx].description,
            DayScenario.SUNNY,
          ),
        };
      }
      if (rainy.activities[idx]) {
        rainy.activities[idx] = {
          ...rainy.activities[idx],
          area: this.ensureScenarioAreaLabel(
            rainy.activities[idx].area,
            preferredArea,
            municipality,
            DayScenario.RAINY,
            idx,
            draft,
            dayIndex,
          ),
          description: this.ensureScenarioDescription(
            rainy.activities[idx].description,
            DayScenario.RAINY,
          ),
        };
      }
    }
  }

  private localizeSingleScenario(
    activities: NormalizedActivity[],
    context: {
      municipality: string;
      scenario: DayScenario;
      dayIndex: number;
      draft: DraftWithCompanion;
    },
  ) {
    return activities.map((activity, idx) => ({
      ...activity,
      area: this.ensureScenarioAreaLabel(
        activity.area,
        context.municipality,
        context.municipality,
        context.scenario,
        idx,
        context.draft,
        context.dayIndex,
      ),
      description: this.ensureScenarioDescription(
        activity.description,
        context.scenario,
      ),
    }));
  }

  private pickPreferredArea(
    baseMunicipality: string,
    ...candidates: Array<string | undefined>
  ) {
    for (const candidate of candidates) {
      if (
        candidate &&
        this.areaMatchesMunicipality(candidate, baseMunicipality)
      ) {
        return candidate.trim();
      }
    }
    return baseMunicipality;
  }

  private ensureScenarioAreaLabel(
    current: string | undefined,
    preferredArea: string,
    municipality: string,
    scenario: DayScenario,
    slotIndex: number,
    draft: DraftWithCompanion,
    dayIndex: number,
  ) {
    const trimmed = (current ?? '').trim();
    if (trimmed.length && this.areaMatchesMunicipality(trimmed, municipality)) {
      return trimmed;
    }
    const preferredTrimmed = preferredArea.trim();
    if (
      preferredTrimmed.length &&
      this.areaMatchesMunicipality(preferredTrimmed, municipality)
    ) {
      return preferredTrimmed;
    }
    const anchor = this.resolvePrimaryDestination(draft, dayIndex);
    return this.buildFallbackAreaLabel(anchor, scenario, slotIndex, draft);
  }

  private ensureScenarioDescription(
    value: string | undefined,
    scenario: DayScenario,
  ) {
    const trimmed = (value ?? '').trim();
    if (!trimmed.length) {
      return scenario === DayScenario.SUNNY
        ? '屋外で地域の雰囲気を楽しみます。'
        : '屋内施設で落ち着いて過ごします。';
    }
    if (
      scenario === DayScenario.RAINY &&
      !/(屋内|室内|雨天|インドア|雨の日)/.test(trimmed)
    ) {
      return `${trimmed}（屋内メインで雨天対応）`;
    }
    if (
      scenario === DayScenario.SUNNY &&
      /(屋内|室内)/.test(trimmed) &&
      !/(屋外|屋上|晴|青空|アウトドア)/.test(trimmed)
    ) {
      return `${trimmed}（晴天時は屋外中心）`;
    }
    return trimmed;
  }

  private areaMatchesMunicipality(
    area: string | undefined,
    municipality: string,
  ) {
    if (!area || !municipality) return false;
    const normalizedArea = this.normalizeAreaToken(area);
    const normalizedMunicipality = this.normalizeAreaToken(municipality);
    if (!normalizedArea.length || !normalizedMunicipality.length) return false;
    return normalizedArea.includes(normalizedMunicipality);
  }

  private normalizeAreaToken(value: string) {
    return value.replace(/[\s\u3000・,，（）()]/g, '');
  }

  private ensureLandmarkAnchors(
    days: NormalizedDay[],
    context: { draft: DraftWithCompanion; totalDates: string[] },
  ): NormalizedDay[] {
    const pairs = this.groupDaysByIndex(days);
    let orderedIndexes = Array.from(pairs.keys()).sort((a, b) => a - b);
    if (!orderedIndexes.length) {
      const fallbackDate =
        context.totalDates[0] ?? new Date().toISOString().slice(0, 10);
      pairs.set(0, {
        sunny: {
          dayIndex: 0,
          date: fallbackDate,
          scenario: DayScenario.SUNNY,
          activities: [],
        },
        rainy: {
          dayIndex: 0,
          date: fallbackDate,
          scenario: DayScenario.RAINY,
          activities: [],
        },
      });
      orderedIndexes = [0];
    }

    const destinations = Array.isArray(context.draft.destinations)
      ? context.draft.destinations
      : [];
    const seen = new Set<string>();

    destinations.forEach((destination, idx) => {
      if (typeof destination !== 'string') return;
      const trimmed = destination.trim();
      if (!trimmed.length) return;
      const insight = this.interpretDestination(trimmed);
      if (insight.kind !== 'LANDMARK') return;
      const destKey = normalizePlaceKey(trimmed);
      if (seen.has(destKey)) return;
      seen.add(destKey);
      if (this.hasLandmarkActivity(this.flattenScenarioPairs(pairs), trimmed))
        return;

      const resolvedIndex = pairs.has(idx)
        ? idx
        : orderedIndexes[idx % orderedIndexes.length];
      if (!pairs.has(resolvedIndex)) {
        const date =
          context.totalDates[resolvedIndex] ??
          context.totalDates[context.totalDates.length - 1] ??
          new Date().toISOString().slice(0, 10);
        pairs.set(resolvedIndex, {
          sunny: {
            dayIndex: resolvedIndex,
            date,
            scenario: DayScenario.SUNNY,
            activities: [],
          },
          rainy: {
            dayIndex: resolvedIndex,
            date,
            scenario: DayScenario.RAINY,
            activities: [],
          },
        });
        orderedIndexes = Array.from(pairs.keys()).sort((a, b) => a - b);
      }

      const targetPair = pairs.get(resolvedIndex)!;
      if (!targetPair.sunny) {
        const date =
          targetPair.rainy?.date ??
          context.totalDates[resolvedIndex] ??
          context.totalDates[context.totalDates.length - 1] ??
          new Date().toISOString().slice(0, 10);
        targetPair.sunny = {
          dayIndex: resolvedIndex,
          date,
          scenario: DayScenario.SUNNY,
          activities: [],
        };
      }
      if (!targetPair.rainy) {
        const date = targetPair.sunny.date;
        targetPair.rainy = {
          dayIndex: resolvedIndex,
          date,
          scenario: DayScenario.RAINY,
          activities: [],
        };
      }
      if (!targetPair.sunny || !targetPair.rainy) return;

      const anchorActivities = this.buildLandmarkAnchorActivities(trimmed, {
        dayIndex: resolvedIndex,
        date: targetPair.sunny.date,
        draft: context.draft,
      });
      targetPair.sunny.activities.unshift(anchorActivities.sunny);
      targetPair.rainy.activities.unshift(anchorActivities.rainy);
      this.reindexActivities(targetPair.sunny.activities);
      this.reindexActivities(targetPair.rainy.activities);
    });

    return this.flattenScenarioPairs(pairs);
  }

  private reindexActivities(activities: NormalizedActivity[]) {
    activities.forEach((activity, idx) => {
      activity.orderIndex = idx;
    });
  }

  private buildLandmarkAnchorActivities(
    destination: string,
    context: { dayIndex: number; date: string; draft: DraftWithCompanion },
  ) {
    const presets = this.findFallbackSpotPresets(destination) ?? [];
    const anchorSpot = presets.find((spot) => Boolean(spot.placeName));
    const anchorName = anchorSpot?.placeName ?? destination;
    const canonicalName = this.resolveRealPlaceName(anchorName) ?? anchorName;
    const area =
      anchorSpot?.area ??
      this.deriveMunicipalityLabel(destination, context.draft);
    const baseDescription =
      anchorSpot?.description ??
      `${canonicalName}を訪れ、代表的な見どころを体験します。`;
    const category = anchorSpot?.category ?? SpotCategory.SIGHTSEEING;
    const stayMinutes = anchorSpot?.stayMinutes ?? 60;
    const baseActivity = {
      time: DEFAULT_TIME_SLOTS[1] ?? DEFAULT_TIME_SLOTS[0],
      area,
      placeName: canonicalName,
      category,
      description: baseDescription,
      stayMinutes,
      orderIndex: 0,
    } as const;

    return {
      sunny: {
        ...baseActivity,
        weather: Weather.SUNNY,
      },
      rainy: {
        ...baseActivity,
        description: this.decorateFallbackDescription(
          baseDescription,
          '屋内',
          DayScenario.RAINY,
        ),
        weather: Weather.RAINY,
      },
    } satisfies { sunny: NormalizedActivity; rainy: NormalizedActivity };
  }

  private hasLandmarkActivity(days: NormalizedDay[], destination: string) {
    const fallbackSpots = this.findFallbackSpotPresets(destination) ?? [];
    const fallbackKeys = fallbackSpots
      .map((spot) => normalizePlaceKey(spot.placeName ?? ''))
      .filter((key) => key.length);
    return days.some((day) =>
      day.activities.some((activity) =>
        this.matchesDestinationPlace(
          activity.placeName,
          destination,
          fallbackKeys,
        ),
      ),
    );
  }

  private matchesDestinationPlace(
    placeName: string | undefined,
    destination: string,
    fallbackKeys: string[] = [],
  ) {
    if (!placeName) return false;
    const placeKey = normalizePlaceKey(placeName);
    if (!placeKey.length) return false;
    const destinationKey = normalizePlaceKey(destination);
    if (!destinationKey.length) return false;
    if (placeKey === destinationKey) return true;
    if (placeKey.includes(destinationKey) || destinationKey.includes(placeKey))
      return true;
    return fallbackKeys.includes(placeKey);
  }

  private groupDaysByIndex(days: NormalizedDay[]) {
    const map = new Map<number, ScenarioPair>();
    days.forEach((day) => {
      const pair = map.get(day.dayIndex) ?? {};
      if (day.scenario === DayScenario.SUNNY) {
        pair.sunny = day;
      } else if (day.scenario === DayScenario.RAINY) {
        pair.rainy = day;
      }
      map.set(day.dayIndex, pair);
    });
    return map;
  }

  private flattenScenarioPairs(pairs: Map<number, ScenarioPair>) {
    const orderedIndexes = Array.from(pairs.keys()).sort((a, b) => a - b);
    const flattened: NormalizedDay[] = [];
    orderedIndexes.forEach((dayIndex) => {
      const pair = pairs.get(dayIndex);
      if (!pair) return;
      if (pair.sunny) flattened.push(pair.sunny);
      if (pair.rainy) flattened.push(pair.rainy);
    });
    return flattened;
  }

  async run(jobId: string, correlationId: string, options: RunOptions) {
    // Mark running before performing LLM call; this ensures status is accurate even if downstream fails。
    const job = await this.prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.RUNNING,
        startedAt: new Date(),
        model: options.model,
        temperature: options.temperature,
        targetDays: options.targetDays,
        promptHash: options.promptHash,
      },
      include: { draft: { include: { companionDetail: true } } },
    });

    const draft = job.draft as DraftWithCompanion;
    const totalDates = this.expandDates(draft.startDate, draft.endDate);
    const expectedDayIndexes = (
      options.targetDays.length
        ? options.targetDays
        : totalDates.map((_, idx) => idx)
    ).filter((idx) => Number.isFinite(idx) && idx >= 0);
    const expectedDaySet = new Set(expectedDayIndexes);
    const expectedSchema = ITINERARY_SCHEMA_TEXT;
    const basePrompt = this.buildPrompt(
      draft,
      options.targetDays ?? [],
      totalDates,
    );

    let lastError = '';
    let attempt = 0;
    const maxAttempts = BACKOFF.length + 1;

    for (attempt = 0; attempt < maxAttempts; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : this.buildRepairPrompt(basePrompt, lastError, expectedSchema);

      try {
        const providerResult = await this.gemini.generate(
          prompt,
          options.model,
          options.temperature,
        );
        const cleaned = stripCodeFence(providerResult.rawText);

        let parsedJson: any;
        try {
          parsedJson = this.parseJsonWithRepair(cleaned);
        } catch (parseErr) {
          lastError = `parse_error: ${(parseErr as Error).message}`;
          await this.writeAudit(jobId, correlationId, {
            prompt,
            request: providerResult.request as Prisma.InputJsonValue,
            rawResponse:
              typeof providerResult.rawResponse === 'string'
                ? providerResult.rawResponse
                : JSON.stringify(providerResult.rawResponse),
            parsed: undefined,
            status: GenerationJobStatus.RUNNING,
            retryCount: attempt,
            model: options.model,
            temperature: options.temperature,
            errorMessage: lastError,
          });
          if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
          continue;
        }

        const baseResult = itinerarySchema.safeParse(parsedJson);
        const dayCandidates = this.extractDayCandidates(parsedJson?.days);
        const normalization = this.normalizeDays(dayCandidates, {
          draft,
          totalDates,
          expectedDayIndexes,
        });
        const validDays = normalization.days;
        if (normalization.llmDayCount === 0) {
          lastError = 'schema_error: no valid llm days';
          this.logger.warn({
            jobId,
            correlationId,
            event: 'LLM_SCHEMA_DEBUG',
            reason: 'no_llm_days',
            preview: preview(cleaned),
            sampleDays: preview(dayCandidates.slice(0, 2)),
          });
          await this.writeAudit(jobId, correlationId, {
            prompt,
            request: providerResult.request as Prisma.InputJsonValue,
            rawResponse:
              typeof providerResult.rawResponse === 'string'
                ? providerResult.rawResponse
                : JSON.stringify(providerResult.rawResponse),
            parsed: undefined,
            status: GenerationJobStatus.RUNNING,
            retryCount: attempt,
            model: options.model,
            temperature: options.temperature,
            errorMessage: lastError,
          });
          if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
          continue;
        }

        const requiredScenarioCount = expectedDayIndexes.length * 2;
        const allDaysValid =
          baseResult.success &&
          normalization.llmDayCount === requiredScenarioCount;

        const partialDays = Array.from(
          new Set(
            normalization.llmDayIndexes.filter((dayIndex) =>
              expectedDaySet.has(dayIndex),
            ),
          ),
        ).sort((a, b) => a - b);
        const parsed: Prisma.JsonObject = {
          title: baseResult.success
            ? baseResult.data.title
            : (parsedJson.title ?? 'untitled'),
          days: validDays,
        } as Prisma.JsonObject;

        const status = allDaysValid
          ? GenerationJobStatus.SUCCEEDED
          : PARTIAL_SUCCESS_STATUS;
        const errorMessage = allDaysValid ? null : ErrorCode.AI_PARTIAL_SUCCESS;

        await this.prisma.$transaction([
          this.prisma.aiGenerationAudit.create({
            data: {
              id: randomUUID(),
              jobId,
              correlationId,
              prompt,
              request: providerResult.request as Prisma.InputJsonValue,
              rawResponse:
                typeof providerResult.rawResponse === 'string'
                  ? providerResult.rawResponse
                  : JSON.stringify(providerResult.rawResponse),
              parsed,
              status,
              retryCount: attempt,
              model: options.model,
              temperature: options.temperature,
              errorMessage,
            },
          }),
          this.prisma.generationJob.update({
            where: { id: jobId },
            data: {
              status,
              partialDays,
              retryCount: attempt,
              finishedAt: new Date(),
              error: errorMessage,
            },
          }),
        ]);

        this.logger.log({ jobId, correlationId, status, partialDays });
        return {
          status,
          partialDays,
          parsed,
          error: errorMessage ?? undefined,
        };
      } catch (err) {
        const providerErr = err as GeminiProviderError | Error;
        const isRetryable =
          (providerErr instanceof GeminiProviderError &&
            [408, 429, 500, 502, 503, 504].includes(providerErr.status)) ||
          (providerErr instanceof Error &&
            /ECONNRESET|ETIMEDOUT|fetch failed|ENOTFOUND/i.test(
              providerErr.message,
            ));

        lastError =
          providerErr instanceof GeminiProviderError
            ? `provider_error_${providerErr.status}`
            : (providerErr.message ?? 'provider_error');
        await this.writeAudit(jobId, correlationId, {
          prompt,
          request: undefined,
          rawResponse:
            providerErr instanceof GeminiProviderError
              ? providerErr.body
              : undefined,
          parsed: undefined,
          status: GenerationJobStatus.RUNNING,
          retryCount: attempt,
          model: options.model,
          temperature: options.temperature,
          errorMessage: lastError,
        });
        if (isRetryable && attempt < maxAttempts - 1) {
          await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
          continue;
        }
        break;
      }
    }

    const finalError = lastError || ErrorCode.AI_RETRY_EXHAUSTED;
    await this.prisma.$transaction([
      this.prisma.aiGenerationAudit.create({
        data: {
          id: randomUUID(),
          jobId,
          correlationId,
          prompt: basePrompt,
          request: undefined,
          rawResponse: undefined,
          parsed: undefined,
          status: GenerationJobStatus.FAILED,
          retryCount: attempt,
          model: options.model,
          temperature: options.temperature,
          errorMessage: finalError,
        },
      }),
      this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: GenerationJobStatus.FAILED,
          error: finalError,
          retryCount: attempt,
          finishedAt: new Date(),
        },
      }),
    ]);

    this.logger.error({ jobId, correlationId, error: finalError });
    return { status: GenerationJobStatus.FAILED, error: finalError };
  }

  private extractDayCandidates(input: unknown): unknown[] {
    if (Array.isArray(input)) return input;
    if (input && typeof input === 'object') {
      // Why: Gemini が { "day0": {...}, "day1": {...} } のような連想オブジェクトを返すことがあり得るため値を配列化する。
      return Object.values(input as Record<string, unknown>);
    }
    return [];
  }

  private async writeAudit(
    jobId: string,
    correlationId: string,
    data: {
      prompt: string;
      request?: Prisma.InputJsonValue;
      rawResponse?: string;
      parsed?: Prisma.JsonObject;
      status: GenerationJobStatus;
      retryCount: number;
      model: string;
      temperature: number;
      errorMessage?: string | null;
    },
  ) {
    await this.prisma.aiGenerationAudit.create({
      data: {
        id: randomUUID(),
        jobId,
        correlationId,
        prompt: data.prompt,
        request: data.request,
        rawResponse: data.rawResponse,
        parsed: data.parsed,
        status: data.status,
        retryCount: data.retryCount,
        model: data.model,
        temperature: data.temperature,
        errorMessage: data.errorMessage ?? undefined,
      },
    });
  }
}
