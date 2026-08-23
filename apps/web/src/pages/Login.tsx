import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form onSubmit={submit} className="w-90 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <b className="text-xl">DeviceDesk</b>
        <small className="mb-6 block text-[10.5px] uppercase tracking-wider text-neutral-500">
          QA Device Lab
        </small>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold text-neutral-500">Work email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-semibold text-neutral-500">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-4 text-center text-xs text-neutral-400">
          Corporate LDAP sign-in arrives when hosted on company infra.
        </p>
      </form>
    </div>
  );
}
