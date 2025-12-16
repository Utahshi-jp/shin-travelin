const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export async function getHealth() {
  const res = await fetch(`${BASE_URL}/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return (await res.json()) as { status: string };
}
