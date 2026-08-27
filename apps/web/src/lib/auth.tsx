import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, SESSION_EXPIRED_EVENT, api, tokenStore } from './api';
import { queryClient } from './queryClient';

export type Role = 'admin' | 'manager' | 'tester';
export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  /** Session check failed for a non-auth reason (server down) — the token
   * is kept; retry instead of dumping the user at the login screen. */
  sessionCheckFailed: boolean;
  retrySession: () => void;
  /** The last session ended because the server rejected it (expired /
   * deactivated) — the login screen explains that. */
  sessionExpired: boolean;
  /** true right after logging in with a factory-default password. */
  mustChangePassword: boolean;
  clearMustChange: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);
export const isStaff = (r?: Role) => r === 'admin' || r === 'manager';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setSessionCheckFailed(false);
    api<Me>('/auth/me')
      .then(setUser)
      .catch((e) => {
        // Only a real auth verdict invalidates the token. A server blip
        // must not sign out a hundred people.
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          invalidateSession();
        } else {
          setSessionCheckFailed(true);
        }
      })
      .finally(() => setLoading(false));
  }, [sessionAttempt]);

  // The ONE place a session gets dropped. api() and the /auth/me check both
  // end up here; the router hop happens in <SessionExpiryRedirect/>.
  const invalidateSession = (reason: 'expired' | 'logout' = 'expired') => {
    tokenStore.clear();
    setUser(null);
    setMustChangePassword(false);
    setSessionExpired(reason === 'expired');
    queryClient.clear();
  };
  useEffect(() => {
    const onExpired = () => invalidateSession('expired');
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: Me; mustChangePassword?: boolean }>(
      '/auth/login',
      { method: 'POST', body: { email, password } },
    );
    tokenStore.set(res.token);
    setUser(res.user);
    setSessionExpired(false);
    setMustChangePassword(!!res.mustChangePassword);
  };

  // The next person at this desk must not see this user's cached data.
  const logout = () => invalidateSession('logout');

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        sessionCheckFailed,
        sessionExpired,
        retrySession: () => setSessionAttempt((n) => n + 1),
        mustChangePassword,
        clearMustChange: () => setMustChangePassword(false),
        login,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** Mount inside the router: when the session expires mid-page, go to the
 * login screen with the router (no hard reload) and remember where the
 * person was, so sign-in brings them straight back. */
export function SessionExpiryRedirect() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const onExpired = () => {
      if (loc.pathname === '/login') return;
      nav('/login?expired=1', { replace: true, state: { from: loc.pathname + loc.search } });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [nav, loc.pathname, loc.search]);
  return null;
}
