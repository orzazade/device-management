import { MigrationInterface, QueryRunner } from 'typeorm';

// Specs shrink to what decides a pick: ram, storage, screenSize, fiveG,
// esim, nfc, notes. Everything else is dropped from every device so the
// stored JSON matches the form again (no invisible leftovers).
const REMOVED = [
  'chipset',
  'battery',
  'resolution',
  'refreshRate',
  'wifi',
  'bluetooth',
  'fingerprint',
  'faceUnlock',
  'releaseYear',
  'color',
];

export class TrimSpecs1725800000000 implements MigrationInterface {
  name = 'TrimSpecs1725800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE devices SET specs = specs - $1::text[]`, [REMOVED]);
  }

  public async down(): Promise<void> {
    // The removed values are gone; nothing to restore.
  }
}
