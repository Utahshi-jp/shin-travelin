import { z } from "zod";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type ScenarioSelector = "BOTH" | "SUNNY" | "RAINY";

type ErrorBody = { code: string; message: string; details?: unknown; correlationId?: string };

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

const errorSchema = z.object({ code: z.string(), message: z.string(), details: z.any().optional(), correlationId: z.string().optional() });

function pickBrowserToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fromStorage = localStorage.getItem("shin_access_token") ?? undefined;
  if (fromStorage) return fromStorage;
  // Why: SSR一覧ではCookieのみになるため、クライアント遷移後もAPIを叩けるようCookieから復元する。
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
  // Why: BackendがBearerのみでもCookie併用にしておくとSSR/CSRのどちらでも同一クライアントを使い回せる。
  if (auth?.cookieToken) {
    headers.Cookie = `shin_access_token=${auth.cookieToken}`;
  }
  return headers;
}

async function apiFetch<T>(path: string, init?: RequestInit & { auth?: AuthTokens }): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init?.auth, init?.headers),
    cache: init?.cache ?? "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    let parsed: ErrorBody = { code: "UNKNOWN", message: res.statusText };
    try {
      parsed = errorSchema.parse(await res.json());
    } catch {
      parsed = { code: "UNKNOWN", message: res.statusText };
    }
    throw new ApiError({ status: res.status, ...parsed });
  }

  // Some endpoints (e.g., 204) may return no body.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  getHealth: (auth?: AuthTokens) => apiFetch<{ status: string }>("/health", { auth }),
  register: (body: { email: string; password: string; displayName: string }) =>
    apiFetch<{ accessToken: string; user: { id: string; email: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    apiFetch<{ accessToken: string; user: { id: string; email: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createDraft: (body: unknown) =>
    apiFetch<{ id: string; createdAt: string }>("/drafts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getDraft: (id: string, auth?: AuthTokens) => apiFetch(`/drafts/${id}`, { auth }),
  startGeneration: (body: { draftId: string; targetDays?: number[] }) =>
    apiFetch<{ jobId: string; status: string; itineraryId?: string }>("/ai/generate", { method: "POST", body: JSON.stringify(body) }),
  getJobStatus: (id: string, auth?: AuthTokens) =>
    apiFetch<{ status: string; retryCount: number; partialDays: number[]; error?: string }>(`/ai/jobs/${id}`, { auth }),
  listItineraries: (params?: ItineraryListQuery, auth?: AuthTokens) => {
    const search = new URLSearchParams();
    if (params?.page && params.page > 1) search.set("page", String(params.page));
    if (params?.keyword) search.set("keyword", params.keyword);
    if (params?.startDate) search.set("startDate", params.startDate);
    if (params?.endDate) search.set("endDate", params.endDate);
    if (params?.purpose) search.set("purpose", params.purpose);
    const suffix = search.toString();
    return apiFetch(`/itineraries${suffix ? `?${suffix}` : ""}`, { auth });
  },
  getItinerary: (id: string, auth?: AuthTokens) => apiFetch(`/itineraries/${id}`, { auth }),
  updateItinerary: (id: string, body: unknown) => apiFetch(`/itineraries/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  regenerateItinerary: (id: string, params: { days: number[]; destinations?: string[] }) =>
    apiFetch<{ jobId: string }>(`/itineraries/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ days: params.days, destinations: params.destinations }),
    }),
};
