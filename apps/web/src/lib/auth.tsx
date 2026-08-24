import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, tokenStore } from './api';
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
          tokenStore.clear();
        } else {
          setSessionCheckFailed(true);
        }
      })
      .finally(() => setLoading(false));
  }, [sessionAttempt]);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: Me; mustChangePassword?: boolean }>(
      '/auth/login',
      { method: 'POST', body: { email, password } },
    );
    tokenStore.set(res.token);
    setUser(res.user);
    setMustChangePassword(!!res.mustChangePassword);
  };

  const logout = () => {
    tokenStore.clear();
    setUser(null);
    setMustChangePassword(false);
    // The next person at this desk must not see this user's cached data.
    queryClient.clear();
  };

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        sessionCheckFailed,
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
