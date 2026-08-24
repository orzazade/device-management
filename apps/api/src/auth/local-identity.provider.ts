import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppDbContext } from '../db/app-db-context';
import { User } from '../entities/user.entity';
import { IdentityProvider } from './identity-provider';

@Injectable()
export class LocalIdentityProvider implements IdentityProvider {
  constructor(private readonly db: AppDbContext) {}

  async verify(email: string, password: string): Promise<User | null> {
    const user = await this.db
      .users()
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email AND u.active = true', { email: email.toLowerCase().trim() })
      .getOne();
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }
}
