import { cookies } from "next/headers";
import { notFound } from "next/navigation";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type PrintDto = { id: string; title: string; days: { date: string; activities: { time: string; location: string; content: string }[] }[] };

async function fetchPrintable(id: string): Promise<PrintDto | null> {
  const token = cookies().get("shin_access_token")?.value;
  if (!token) return null;
  const res = await fetch(`${BASE_URL}/itineraries/${id}/print`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as PrintDto;
}

export default async function PrintPage({ params }: { params: { id: string } }) {
  const data = await fetchPrintable(params.id);
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-8 print:px-0">
      <h1 className="text-2xl font-bold">{data!.title}</h1>
      <section className="mt-4 space-y-4">
        {data!.days.map((day, idx) => (
          <div key={idx} className="rounded border p-3">
            <h2 className="font-semibold">{day.date}</h2>
            <ul className="mt-2 space-y-1">
              {day.activities.map((act, i) => (
                <li key={i} className="text-sm">
                  <span className="font-mono">{act.time}</span> {act.location} - {act.content}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
