import { MigrationInterface, QueryRunner } from 'typeorm';

// The manager tier is gone. The lab runs on peers lending to peers: whoever
// holds a device decides who gets it next, and a device nobody holds is
// simply taken. That leaves no work for a middle approver, so the role and
// the accounts holding it are retired.
//
// Retired, not erased. Deleting the rows would orphan every request, audit
// row and device those people touched, and the app already treats a user with
// deleted_at set as gone — they vanish from the lists, cannot sign in, and
// their history stays readable. Anyone still needed can be restored from the
// Users screen with "Show deleted", where they come back as a tester.
export class DropManagerRole1726200000000 implements MigrationInterface {
  name = 'DropManagerRole1726200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand back anything a manager was still holding: a deleted account
    // cannot return a device, and the device would be stuck forever.
    await queryRunner.query(`
      UPDATE requests SET state = 'returned'
      WHERE state IN ('pending', 'approved', 'active', 'overdue')
        AND requester_id IN (SELECT id FROM users WHERE role = 'manager')
    `);
    await queryRunner.query(`
      UPDATE devices SET holder_id = NULL, status = 'available'
      WHERE holder_id IN (SELECT id FROM users WHERE role = 'manager')
    `);
    await queryRunner.query(`
      UPDATE users
      SET role = 'tester', active = false, deleted_at = now()
      WHERE role = 'manager' AND deleted_at IS NULL
    `);
    // Any manager row already soft-deleted still carries the dead role.
    await queryRunner.query(`UPDATE users SET role = 'tester' WHERE role = 'manager'`);
  }

  public async down(): Promise<void> {
    // Deliberately not reversible: the migration cannot tell which of the
    // restored testers used to be managers, and guessing would hand people
    // back permissions they may no longer be meant to have. Restore
    // individual accounts from the Users screen instead.
  }
}
