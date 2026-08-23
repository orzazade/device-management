import { EntityManager } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

export interface Actor {
  id: string | null;
  name: string;
}

/**
 * Write an audit row INSIDE the caller's transaction — same commit as the
 * state change it describes. An unaudited change is impossible, not unlikely.
 */
export async function writeAudit(
  manager: EntityManager,
  actor: Actor,
  entry: {
    entityType: string;
    entityId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  await manager.getRepository(AuditLog).insert({
    actorId: actor.id,
    actorName: actor.name,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    oldValue: (entry.oldValue ?? null) as any,
    newValue: (entry.newValue ?? null) as any,
  });
}
