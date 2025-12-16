import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ItineraryDetailClient } from "@/features/itinerary/components/ItineraryDetailClient";
import { api, ApiError } from "@/shared/api/client";
import { ItineraryFormValues } from "@/shared/validation/itinerary.schema";

export default async function ItineraryDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { jobId?: string } }) {
  const token = cookies().get("shin_access_token")?.value;
  if (!token) {
    return <p className="p-6 text-sm text-slate-600">詳細を表示するにはログインしてください。</p>;
  }

  let itinerary: ItineraryFormValues | null = null;
  try {
    itinerary = await api.getItinerary(params.id, { token, cookieToken: token });
  } catch (err) {
    const apiErr = err as ApiError;
    if (apiErr.status === 404) notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-xl font-bold">旅程詳細</h1>
      <ItineraryDetailClient id={params.id} jobId={searchParams.jobId} initialItinerary={itinerary} />
    </main>
  );
}
