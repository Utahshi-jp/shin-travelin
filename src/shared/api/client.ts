import { draftFormSchema, type DraftFormValues } from "@/shared/validation/draft.schema";
import { itinerarySchema, type ItineraryFormValues } from "@/shared/validation/itinerary.schema";
import { z } from "zod";

/**
 * Next.js から NestJS API への単一経路。SSR/CSR 双方で fetch を統一し、
 * スキーマ破壊を Zod で即座に検出する。
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

/**
 * 晴雨どちらのシナリオを対象に再生成するかを示す UI 側セレクタ。
 */
export type ScenarioSelector = "BOTH" | "SUNNY" | "RAINY";

type ErrorBody = { code: string; message: string; details?: unknown; correlationId?: string };

/**
 * API から返る `code/message/correlationId` を保持し、UI 側で一貫したエラー表示を可能にする。
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  correlationId?: string;

  constructor(params: { status: number; code: string; message: string; details?: unknown; correlationId?: string }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.correlationId = params.correlationId;
  }
}

export type AuthTokens = { token?: string; cookieToken?: string };
export type ItineraryListQuery = {
  page?: number;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  purpose?: string;
};

const errorSchema = z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), correlationId: z.string().optional() });
const userSummarySchema = z.object({ id: z.string(), email: z.string().email() });
const authResponseSchema = z.object({ accessToken: z.string(), user: userSummarySchema });
const draftResponseSchema = z.object({ id: z.string(), createdAt: z.string() });
const generationJobSchema = z.object({ jobId: z.string(), status: z.string(), itineraryId: z.string().optional(), error: z.string().optional() });
const jobStatusSchema = z.object({
  status: z.string(),
  retryCount: z.number().int().min(0),
  partialDays: z.array(z.number().int().min(0)).default([]),
  error: z.string().optional(),
  itineraryId: z.string().optional(),
});

const itineraryListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
  createdAt: z.string(),
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
  purposes: z.array(z.string()),
  primaryAreas: z.array(z.string()),
  experienceSummary: z.string().nullable(),
});

const itineraryListResponseSchema = z.object({
  items: z.array(itineraryListItemSchema),
  page: z.number().int().min(1),
  total: z.number().int().min(0),
  pageSize: z.number().int().min(1),
});

const startGenerationPayloadSchema = z.object({
  draftId: z.string(),
  targetDays: z.array(z.number().int().min(0)).optional(),
});

const regenerationPayloadSchema = z.object({
  days: z.array(z.number().int().min(0)).min(1),
  destinations: z.array(z.string().min(3).max(200)).max(5).optional(),
});

const updateItineraryPayloadSchema = z.object({
  title: itinerarySchema.shape.title,
  version: itinerarySchema.shape.version,
  days: itinerarySchema.shape.days,
});

export type AuthResponse = z.infer<typeof authResponseSchema>;
export type DraftResponse = z.infer<typeof draftResponseSchema>;
export type GenerationJobResponse = z.infer<typeof generationJobSchema>;
export type JobStatusResponse = z.infer<typeof jobStatusSchema>;
export type ItineraryListResponse = z.infer<typeof itineraryListResponseSchema>;

type ApiFetchInit<T> = RequestInit & { auth?: AuthTokens; schema?: z.ZodSchema<T> };

function pickBrowserToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fromStorage = localStorage.getItem("shin_access_token") ?? undefined;
  if (fromStorage) return fromStorage;
  const match = document.cookie.match(/(?:^|; )shin_access_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function buildHeaders(auth?: AuthTokens, initHeaders?: HeadersInit): HeadersInit {
  const token = auth?.token ?? pickBrowserToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(initHeaders as Record<string, string> | undefined),
  };
  if (auth?.cookieToken) {
    headers.Cookie = `shin_access_token=${auth.cookieToken}`;
  }
  return headers;
}

async function safeParseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * fetch の薄いラッパー。常に `credentials: include`、`cache: "no-store"` を付与し、
 * エラー時は ApiError を投げてコンポーネントからの try/catch を単純化する。
 */
async function apiFetch<T = unknown>(path: string, init?: ApiFetchInit<T>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init?.auth, init?.headers),
    cache: init?.cache ?? "no-store",
    credentials: "include",
  });

  const payload = await safeParseJson(res);

  if (!res.ok) {
    let parsed: ErrorBody = { code: "UNKNOWN", message: res.statusText };
    if (payload) {
      parsed = errorSchema.catch(parsed).parse(payload);
    }
    throw new ApiError({ status: res.status, ...parsed });
  }

  if (res.status === 204) return undefined as T;
  if (init?.schema) return init.schema.parse(payload);
  return (payload ?? undefined) as T;
}

/**
 * 画面層で直接呼び出す REST API。各エンドポイントは入力/出力とも Zod で検証済み。
 */
export const api = {
  getHealth: (auth?: AuthTokens) => apiFetch("/health", { auth, schema: z.object({ status: z.string() }) }),
  register: (body: { email: string; password: string; displayName: string }) =>
    apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify(z.object({ email: z.string().email(), password: z.string().min(8), displayName: z.string().min(1).max(120) }).parse(body)),
      schema: authResponseSchema,
    }),
  login: (body: { email: string; password: string }) =>
    apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify(z.object({ email: z.string().email(), password: z.string().min(8) }).parse(body)),
      schema: authResponseSchema,
    }),
  createDraft: (body: DraftFormValues) =>
    apiFetch("/drafts", {
      method: "POST",
      body: JSON.stringify(draftFormSchema.parse(body)),
      schema: draftResponseSchema,
    }),
  getDraft: (id: string, auth?: AuthTokens) => apiFetch(`/drafts/${id}`, { auth }),
  startGeneration: (body: { draftId: string; targetDays?: number[] }) =>
    apiFetch("/ai/generate", {
      method: "POST",
      body: JSON.stringify(startGenerationPayloadSchema.parse(body)),
      schema: generationJobSchema,
    }),
  getJobStatus: (id: string, auth?: AuthTokens) => apiFetch(`/ai/jobs/${id}`, { auth, schema: jobStatusSchema }),
  listItineraries: (params?: ItineraryListQuery, auth?: AuthTokens) => {
    const search = new URLSearchParams();
    if (params?.page && params.page > 1) search.set("page", String(params.page));
    if (params?.keyword) search.set("keyword", params.keyword);
    if (params?.startDate) search.set("startDate", params.startDate);
    if (params?.endDate) search.set("endDate", params.endDate);
    if (params?.purpose) search.set("purpose", params.purpose);
    const suffix = search.toString();
    return apiFetch(`/itineraries${suffix ? `?${suffix}` : ""}`, { auth, schema: itineraryListResponseSchema });
  },
  getItinerary: (id: string, auth?: AuthTokens) => apiFetch<ItineraryFormValues>(`/itineraries/${id}`, { auth, schema: itinerarySchema }),
  updateItinerary: (id: string, body: z.infer<typeof updateItineraryPayloadSchema>) =>
    apiFetch<ItineraryFormValues>(`/itineraries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updateItineraryPayloadSchema.parse(body)),
      schema: itinerarySchema,
    }),
  regenerateItinerary: (id: string, params: { days: number[]; destinations?: string[] }) =>
    apiFetch<{ jobId: string }>(`/itineraries/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify(regenerationPayloadSchema.parse(params)),
      schema: z.object({ jobId: z.string() }),
    }),
};
