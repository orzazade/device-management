import { useEffect, useState } from 'react';

type Health = { status: string; db: string; redis: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then(async (r) => {
        const body = await r.json();
        // 503 carries the degraded body inside Nest's error envelope
        setHealth(body.message ?? body);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const chip = (v?: string) =>
    v === 'up' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-100">
      <div className="bg-white rounded-2xl shadow p-8 w-80 text-center">
        <h1 className="text-xl font-bold">DeviceDesk</h1>
        <p className="text-sm text-neutral-500 mb-6">QA Device Lab — S0 skeleton</p>
        {error && <p className="text-red-700">API unreachable: {error}</p>}
        {health && (
          <div className="space-y-2">
            <div className="text-3xl">{health.status === 'ok' ? '✅' : '⚠️'}</div>
            <div className={`rounded-full px-3 py-1 inline-block text-sm font-semibold ${chip(health.db)}`}>
              database: {health.db}
            </div>
            <br />
            <div className={`rounded-full px-3 py-1 inline-block text-sm font-semibold ${chip(health.redis)}`}>
              redis: {health.redis}
            </div>
          </div>
        )}
        {!health && !error && <p className="text-neutral-400">checking…</p>}
      </div>
    </main>
  );
}
