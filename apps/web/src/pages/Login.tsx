import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import BrandLoader from '../components/BrandLoader';
import ThemeToggle from '../components/ThemeToggle';
import { VForm, VField } from '../components/VForm';
import { useAuth } from '../lib/auth';
import { email, required } from '../lib/validate';

export default function Login() {
  const { user, loading, login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);

  // No form flash for someone who is already signed in (F193).
  if (loading) return <BrandLoader />;
  if (entering) return <BrandLoader label="Signing you in…" />;
  if (user) return <Navigate to={from} replace />;
  const expired = new URLSearchParams(location.search).get('expired') === '1';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>
      <VForm
        className="w-full max-w-90 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
        onValidSubmit={async (f) => {
          setBusy(true);
          setError(null);
          try {
            await login(String(f.get('email')), String(f.get('password')));
            // One heartbeat of the brand before the app appears.
            setEntering(true);
            setTimeout(() => nav(from), 1400);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Login failed';
            setError(msg.includes('fetch') ? 'Can’t reach the server — check the connection and try again' : msg);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-7 inline-flex flex-col items-end">
          <img src="/azercell-logo.svg" alt="Azercell" className="brand-logo h-12" />
          <span className="mt-1 pr-0.5 text-[17px] font-medium leading-none text-accent">
            Device Manager
          </span>
        </div>
        {expired && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your session expired — sign in again to continue.
          </p>
        )}
        <div className="mb-3">
          <VField
            name="email"
            label="Work email"
            type="email"
            autoComplete="username"
            autoFocus
            rules={[required('Enter your work email'), email()]}
            placeholder="name@company.com"
          />
        </div>
        <div className="mb-4">
          <VField
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            rules={[required('Enter your password')]}
          />
        </div>
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-4 text-center text-xs text-neutral-400">
          Corporate LDAP sign-in arrives when hosted on company infra.
        </p>
      </VForm>
    </div>
  );
}
