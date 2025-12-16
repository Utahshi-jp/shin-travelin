import Link from "next/link";
import { cookies } from "next/headers";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type ListResponse = { items: { id: string; title: string; version: number; createdAt: string }[]; page: number; total: number };

export default async function ItinerariesPage({ searchParams }: { searchParams: { page?: string } }) {
  const token = cookies().get("shin_access_token")?.value;
  const page = searchParams?.page ? parseInt(searchParams.page, 10) || 1 : 1;

  if (!token) {
    return <p className="p-6 text-sm text-slate-600">一覧を取得するにはログインしてください。</p>;
  }

  const res = await fetch(`${BASE_URL}/itineraries?page=${page}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return <p className="p-6 text-sm text-red-600">一覧取得に失敗しました。再読み込みしてください。</p>;
  }

  const data = (await res.json()) as ListResponse;
  if (!data.items.length) {
    return <p className="p-6 text-sm text-slate-600">旅程がまだありません。</p>;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-bold">旅程一覧</h1>
      <ul className="mt-4 divide-y border rounded">
        {data.items.map((itinerary) => (
          <li key={itinerary.id} className="p-3 hover:bg-slate-50">
            <Link href={`/itineraries/${itinerary.id}`} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{itinerary.title}</p>
                <p className="text-xs text-slate-500">version {itinerary.version}</p>
              </div>
              <span className="text-xs text-slate-500">{new Date(itinerary.createdAt).toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
