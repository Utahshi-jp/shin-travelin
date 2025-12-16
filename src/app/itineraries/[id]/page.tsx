import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ItineraryEditor } from "@/features/itinerary/components/ItineraryEditor";
import { ItineraryFormValues } from "@/shared/validation/itinerary.schema";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function fetchItinerary(id: string): Promise<ItineraryFormValues | null> {
  const token = cookies().get("shin_access_token")?.value;
  if (!token) return null;
  const res = await fetch(`${BASE_URL}/itineraries/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    id: data.id,
    title: data.title,
    version: data.version,
    days: data.days ?? [],
  };
}

export default async function ItineraryDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { jobId?: string } }) {
  const itinerary = await fetchItinerary(params.id);
  if (!itinerary) {
    notFound();
  }
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-xl font-bold">旅程詳細</h1>
      {searchParams.jobId && <p className="text-xs text-slate-500">jobId: {searchParams.jobId}</p>}
      <ItineraryEditor itinerary={itinerary!} />
    </main>
  );
}
