// src/shared/api/client.ts
const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export class ApiClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`GET ${path} failed with status ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`POST ${path} failed with status ${res.status}`);
    }

    return res.json() as Promise<T>;
  }
}

export const apiClient = new ApiClient();
