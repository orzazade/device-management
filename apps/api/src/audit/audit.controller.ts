import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';

@Controller('audit')
export class AuditController {
  constructor(private readonly db: AppDbContext) {}

  @Get()
  @Roles('admin')
  async list(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit ?? '100', 10) || 100, 500);
    return this.db.auditLogs().find({ order: { id: 'DESC' }, take });
  }
}
