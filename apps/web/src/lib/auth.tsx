import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';

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

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api<Me>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

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
  };

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
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
