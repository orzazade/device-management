import { EntityManager, In } from 'typeorm';
import { config } from '../config';
import { EmailOutbox, Notification, NotificationRule } from '../entities/notification.entity';
import { User } from '../entities/user.entity';

/**
 * Emit one event to a set of users, INSIDE the caller's transaction.
 * The rules table decides the channels: in-app rows, email outbox rows,
 * both, or nothing. Emails are not sent here — a worker drains the outbox
 * with retries, and failures stay visible (ARCH.md).
 */
export async function notify(
  manager: EntityManager,
  event: string,
  userIds: string[],
  text: string,
  meta: Record<string, string> = {},
  /** In-app deeplink: where clicking this notification should take the user. */
  link?: string,
): Promise<void> {
  // A bare /requests link lands on the "Open" list, which hides rejected,
  // cancelled and returned rows — the page needs the id to pick the tab.
  if (link === '/requests' && meta.requestId) link = `/requests?id=${meta.requestId}`;
  if (link) meta = { ...meta, link };
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  const rule = await manager.getRepository(NotificationRule).findOne({ where: { event } });
  if (!rule) {
    // Loud, not silent: an unseeded event means a migration was missed.
    console.error(`notify(): no notification_rules row for event "${event}" — nothing sent`);
    return;
  }

  if (rule.inapp) {
    await manager.getRepository(Notification).insert(
      ids.map((userId) => ({ userId, event, text, meta })),
    );
  }
  if (rule.email) {
    const users = await manager.getRepository(User).find({ where: { id: In(ids) } });
    await manager.getRepository(EmailOutbox).insert(
      users.map((u) => ({
        toEmail: u.email,
        // Subject carries the actual content — scannable in a full inbox.
        subject: `DeviceDesk: ${text.length > 70 ? text.slice(0, 67) + '…' : text}`,
        body: `Hi ${u.name},\n\n${text}\n\nOpen DeviceDesk: ${config.appUrl}${link ?? ''}\n\n— DeviceDesk`,
      })),
    );
  }
}

/** Active staff (admin + manager) user ids — the audience for lab events. */
export async function staffIds(manager: EntityManager): Promise<string[]> {
  const staff = await manager
    .getRepository(User)
    .find({ where: [{ role: 'admin', active: true }, { role: 'manager', active: true }] });
  return staff.map((s) => s.id);
}
