import { getHealth } from "@/shared/api/client";

export default async function Home() {
  const health = await getHealth();

  return (
    <main style={{ padding: 24 }}>
      <h1>shintravelin</h1>
      <p>API Health: {health.status}</p>
    </main>
  );
}
