import { Controller, Get, Query } from '@nestjs/common';
import { In } from 'typeorm';
import { Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { AuditLog } from '../entities/audit-log.entity';

@Controller('audit')
export class AuditController {
  constructor(private readonly db: AppDbContext) {}

  /** Filterable, keyset-paginated. `beforeId` = id of the oldest row the
   * client already has; results are always newest-first. */
  @Get()
  @Roles('admin', 'manager')
  async list(
    @Query('limit') limit?: string,
    @Query('entityType') entityType?: string,
    @Query('actor') actorName?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const take = Math.min(parseInt(limit ?? '100', 10) || 100, 500);
    const qb = this.db.auditLogs().createQueryBuilder('a').orderBy('a.id', 'DESC').take(take);
    if (entityType) qb.andWhere('a.entityType = :entityType', { entityType });
    if (actorName) qb.andWhere('a.actorName ILIKE :actor', { actor: `%${actorName}%` });
    if (from) qb.andWhere('a.createdAt >= :from', { from });
    if (to) qb.andWhere('a.createdAt < (:to)::date + 1', { to });
    if (beforeId) qb.andWhere('a.id < :beforeId', { beforeId });
    const rows = await qb.getMany();
    const labels = await this.resolveLabels(rows);
    return rows.map((r) => ({
      ...r,
      entityLabel: labels.get(`${r.entityType}:${r.entityId}`) ?? null,
    }));
  }

  /** Batch-resolve "which one?" per entity type — a row about a request
   * names the device and requester, not a UUID. Deleted entities still
   * resolve (withDeleted): history must outlive its subject. */
  private async resolveLabels(rows: AuditLog[]): Promise<Map<string, string>> {
    const byType = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!byType.has(r.entityType)) byType.set(r.entityType, new Set());
      byType.get(r.entityType)!.add(r.entityId);
    }
    const out = new Map<string, string>();
    // Some rows use symbolic ids ('bulk' imports, setting keys, rule names)
    // — feeding those to a uuid column throws, so only real UUIDs go in.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = (t: string) =>
      [...(byType.get(t) ?? [])].filter((v) => (t === 'email' ? /^\d+$/.test(v) : UUID.test(v)));

    if (ids('device').length) {
      for (const d of await this.db.devices().find({
        where: { id: In(ids('device')) },
        withDeleted: true,
      })) {
        out.set(`device:${d.id}`, `${d.brand} ${d.model}`);
      }
    }
    if (ids('user').length) {
      for (const u of await this.db.users().find({
        where: { id: In(ids('user')) },
        withDeleted: true,
      })) {
        out.set(`user:${u.id}`, u.name);
      }
    }
    if (ids('project').length) {
      for (const p of await this.db.projects().find({
        where: { id: In(ids('project')) },
        withDeleted: true,
      })) {
        out.set(`project:${p.id}`, p.name);
      }
    }
    if (ids('request').length) {
      for (const r of await this.db.requests().find({
        where: { id: In(ids('request')) },
        relations: { device: true, requester: true },
        withDeleted: true,
      })) {
        out.set(
          `request:${r.id}`,
          `${r.device?.brand ?? ''} ${r.device?.model ?? ''} · ${r.requester?.name ?? ''}`.trim(),
        );
      }
    }
    if (ids('repair').length) {
      for (const r of await this.db.repairs().find({
        where: { id: In(ids('repair')) },
        relations: { device: true },
        withDeleted: true,
      })) {
        out.set(`repair:${r.id}`, `${r.device?.brand ?? ''} ${r.device?.model ?? ''}`.trim());
      }
    }
    if (ids('email').length) {
      for (const m of await this.db.emailOutbox().find({ where: { id: In(ids('email')) } })) {
        out.set(`email:${m.id}`, `${m.subject} → ${m.toEmail}`);
      }
    }
    return out;
  }
}
