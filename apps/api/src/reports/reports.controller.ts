import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';

/**
 * The report that sells the tool to managers (ROADMAP S7): which devices
 * nobody has used in N days — stop buying the wrong ones.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly db: AppDbContext) {}

  @Get('idle-devices')
  @Roles('admin', 'manager')
  async idleDevices(@Query('days') days?: string) {
    const n = Math.min(Math.max(parseInt(days ?? '90', 10) || 90, 7), 365);
    const rows = await this.db.raw.query(
      `
      SELECT d.id, d.brand, d.model, d.serial, d.status,
             GREATEST(d.created_at, COALESCE(MAX(r.created_at), d.created_at)) AS last_activity
      FROM devices d
      LEFT JOIN requests r ON r.device_id = d.id
      WHERE d.status != 'retired' AND d.deleted_at IS NULL
      GROUP BY d.id
      HAVING GREATEST(d.created_at, COALESCE(MAX(r.created_at), d.created_at))
             < now() - ($1 || ' days')::interval
      ORDER BY last_activity ASC
      `,
      [n],
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      brand: r.brand,
      model: r.model,
      serial: r.serial,
      status: r.status,
      lastActivity: r.last_activity,
    }));
  }
}
