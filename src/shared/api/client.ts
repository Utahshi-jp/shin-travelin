import { z } from "zod";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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

const errorSchema = z.object({ code: z.string(), message: z.string(), details: z.any().optional(), correlationId: z.string().optional() });

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("shin_access_token") ?? undefined : undefined;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    let parsed: { code: string; message: string; details?: unknown; correlationId?: string } = {
      code: "UNKNOWN",
      message: res.statusText,
    };
    try {
      parsed = errorSchema.parse(await res.json());
    } catch (e) {
      parsed = { code: "UNKNOWN", message: res.statusText };
    }
    throw new ApiError({ status: res.status, ...parsed });
  }

  return (await res.json()) as T;
}

export const api = {
  getHealth: () => apiFetch<{ status: string }>("/health"),
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
  createDraft: (body: any) =>
    apiFetch<{ id: string; createdAt: string }>("/drafts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getDraft: (id: string) => apiFetch(`/drafts/${id}`),
  startGeneration: (body: { draftId: string; targetDays?: number[] }) =>
    apiFetch<{ jobId: string; status: string }>("/ai/generate", { method: "POST", body: JSON.stringify(body) }),
  getJobStatus: (id: string) => apiFetch<{ status: string; retryCount: number; partialDays: number[]; error?: string }>(`/ai/jobs/${id}`),
  createItinerary: (body: any) => apiFetch<{ id: string; version: number }>("/itineraries", { method: "POST", body: JSON.stringify(body) }),
  listItineraries: (page?: number) => apiFetch(`/itineraries${page ? `?page=${page}` : ""}`),
  getItinerary: (id: string) => apiFetch(`/itineraries/${id}`),
  updateItinerary: (id: string, body: any) => apiFetch(`/itineraries/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  regenerateItinerary: (id: string, days: number[]) =>
    apiFetch(`/itineraries/${id}/regenerate`, { method: "POST", body: JSON.stringify({ days }) }),
  getPrintable: (id: string) => apiFetch(`/itineraries/${id}/print`),
};
