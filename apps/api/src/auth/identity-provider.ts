import { User } from '../entities/user.entity';

/**
 * Pluggable identity (docs/ARCH.md): local email+password now, corporate
 * LDAP later. Everything above this interface (JWT, guards, RBAC) stays
 * unchanged when the provider is swapped.
 */
export interface IdentityProvider {
  /** Returns the user when credentials are valid, null otherwise. */
  verify(email: string, password: string): Promise<User | null>;
}

export const IDENTITY_PROVIDER = 'IDENTITY_PROVIDER';
