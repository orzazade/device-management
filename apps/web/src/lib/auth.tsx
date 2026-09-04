import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, SESSION_EXPIRED_EVENT, api, tokenStore } from './api';
import { queryClient } from './queryClient';

export interface Me {
  id: string;
  name: string;
  email: string;
  /** Role names, for recognising your own access. Never for deciding it. */
  roles: string[];
  /** Effective permission keys, resolved by the server for this account. */
  permissions: string[];
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
  /** Re-read this account's roles and permissions from the server, quietly. */
  refreshSession: () => void;
  /** true right after logging in with a factory-default password. */
  mustChangePassword: boolean;
  clearMustChange: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);
/**
 * Can the signed-in person do this?
 *
 * Hiding a control the API would refuse is a courtesy, not a defence — the
 * guard decides every request regardless of what this returns. Use it to stop
 * showing doors that will not open, never to decide whether something is safe.
 */
export const useCan = () => {
  const { user } = useAuth();
  return (key: string) => !!user?.permissions?.includes(key);
};

/**
 * Is this the same session, as far as the UI is concerned?
 *
 * Compared field by field rather than by reference, because `/auth/me`
 * returns a fresh object every time and swapping it in would re-render the
 * whole tree on every navigation even when nothing about the person changed.
 */
function sameSession(a: Me | null, b: Me): boolean {
  if (!a) return false;
  const list = (xs: string[]) => [...xs].sort().join('\u0000');
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.email === b.email &&
    list(a.roles) === list(b.roles) &&
    list(a.permissions) === list(b.permissions)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setSessionCheckFailed(false);
    // Shares the in-flight guard, so mounting does not fetch the session
    // twice: this check and <SessionRefresh/> both fire on first render.
    inFlight.current = true;
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
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, [sessionAttempt]);

  // The ONE place a session gets dropped. api() and the /auth/me check both
  // end up here; the router hop happens in <SessionExpiryRedirect/>.
  const invalidateSession = useCallback((reason: 'expired' | 'logout' = 'expired') => {
    tokenStore.clear();
    setUser(null);
    setMustChangePassword(false);
    setSessionExpired(reason === 'expired');
    queryClient.clear();
  }, []);

  /**
   * Re-read the session in the background.
   *
   * The guard already resolves permissions from the role tables on every
   * request, so the SERVER acts on a role change immediately. The sidebar did
   * not: it renders from whatever `/auth/me` returned at sign-in, so somebody
   * promoted an hour ago still saw a tester's navigation until they reloaded.
   *
   * Three things this must not do. It must not touch `loading` — that would
   * put the two-second brand splash in front of every navigation. It must not
   * sign anybody out on a server blip; only a real auth verdict does that,
   * same rule as the check on mount. And it must not replace `user` with an
   * identical object, or every navigation would re-render the whole app for
   * nothing.
   */
  const refreshSession = useCallback(() => {
    // Only one at a time. A time-based throttle was tempting and wrong: it
    // makes the delay before a REVOKED permission disappears depend on how
    // fast somebody happens to be clicking, and that is the direction where
    // being late actually matters.
    if (!tokenStore.get() || inFlight.current) return;
    inFlight.current = true;
    api<Me>('/auth/me')
      .then((fresh) => setUser((prev) => (sameSession(prev, fresh) ? prev : fresh)))
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          invalidateSession();
        }
        // Anything else is a connection problem, and the person is already
        // signed in and working. The next navigation tries again.
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [invalidateSession]);
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
        refreshSession,
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

/**
 * Keeps the signed-in session current while somebody is using the app.
 *
 * Mounted inside the router, because AuthProvider is above it and cannot see
 * navigation. Every route change re-reads the session, and so does returning
 * to a tab that was left open — the two moments when what somebody is allowed
 * to do may have changed without them doing anything.
 *
 * The request is cheap and throttled, and it never blocks rendering: the page
 * paints from the session already in hand, and updates only if the answer
 * actually differs.
 */
export function SessionRefresh() {
  const { pathname } = useLocation();
  const { refreshSession } = useAuth();

  useEffect(() => {
    refreshSession();
  }, [pathname, refreshSession]);

  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') refreshSession();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [refreshSession]);

  return null;
}
