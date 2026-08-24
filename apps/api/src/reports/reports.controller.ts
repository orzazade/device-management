import { Controller, Get, Query, Req } from '@nestjs/common';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';

/**
 * The report that sells the tool to managers (ROADMAP S7): which devices
 * nobody has used in N days — stop buying the wrong ones.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly db: AppDbContext) {}

  /** Honest dashboard numbers, computed where the data lives.
   * "Available now" excludes open repairs and bookings covering today. */
  @Get('dashboard')
  async dashboard(@Req() req: { user: AuthUser }) {
    const [avail] = await this.db.raw.query(`
      SELECT COUNT(*)::int AS n FROM devices d
      WHERE d.deleted_at IS NULL AND d.status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM repairs rp WHERE rp.device_id = d.id
            AND rp.state IN ('reported','repair_requested','in_repair'))
        AND NOT EXISTS (
          SELECT 1 FROM requests r WHERE r.device_id = d.id
            AND r.state IN ('approved','active','overdue')
            AND daterange(r.from_date, r.to_date, '[]') @> CURRENT_DATE)
    `);
    const [repairs] = await this.db.raw.query(`
      SELECT COUNT(*)::int AS n FROM repairs
      WHERE state IN ('reported','repair_requested','in_repair')
    `);
    const staff = req.user.role === 'admin' || req.user.role === 'manager';
    let overdue: unknown[] = [];
    if (staff) {
      overdue = (
        await this.db.raw.query(`
          SELECT r.id, r.to_date, d.brand, d.model, u.name AS holder
          FROM requests r
          JOIN devices d ON d.id = r.device_id
          JOIN users u ON u.id = r.requester_id
          WHERE r.state = 'overdue'
          ORDER BY r.to_date ASC
        `)
      ).map((r: Record<string, unknown>) => ({
        id: r.id,
        device: `${r.brand} ${r.model}`,
        holder: r.holder,
        dueDate: r.to_date,
      }));
    }
    return { availableNow: avail.n, openRepairs: repairs.n, overdue };
  }

  @Get('idle-devices')
  @Roles('admin', 'manager')
  async idleDevices(@Query('days') days?: string) {
    const n = Math.min(Math.max(parseInt(days ?? '90', 10) || 90, 7), 365);
    // "Activity" = real usage: the end of a loan's window (or its creation
    // for pending noise-free states). A cancelled or rejected request is
    // not usage and must not reset the idle clock.
    const rows = await this.db.raw.query(
      `
      SELECT d.id, d.brand, d.model, d.serial, d.status,
             COUNT(r.id) FILTER (WHERE r.state IN ('active','overdue','returned')) AS uses,
             GREATEST(
               d.created_at,
               COALESCE(MAX(CASE WHEN r.state IN ('active','overdue','returned')
                 THEN GREATEST(r.created_at, (r.to_date)::timestamptz) END), d.created_at)
             ) AS last_activity
      FROM devices d
      LEFT JOIN requests r ON r.device_id = d.id
      WHERE d.status = 'available' AND d.deleted_at IS NULL
      GROUP BY d.id
      HAVING GREATEST(
               d.created_at,
               COALESCE(MAX(CASE WHEN r.state IN ('active','overdue','returned')
                 THEN GREATEST(r.created_at, (r.to_date)::timestamptz) END), d.created_at)
             ) < now() - ($1 || ' days')::interval
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
      neverBorrowed: Number(r.uses) === 0,
    }));
  }
}
