import { MigrationInterface, QueryRunner } from 'typeorm';

// Specs become free key/value pairs. The fixed keys that existed before
// are renamed to the labels people see, and booleans become "yes"/"no",
// so the stored JSON is exactly what the edit form shows.
const RENAME: Record<string, string> = {
  ram: 'RAM',
  storage: 'Storage',
  screenSize: 'Screen',
  fiveG: '5G',
  esim: 'eSIM',
  nfc: 'NFC',
  notes: 'Notes',
};

export class SpecsFreeForm1725900000000 implements MigrationInterface {
  name = 'SpecsFreeForm1725900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; specs: Record<string, unknown> }[] = await queryRunner.query(
      `SELECT id, specs FROM devices WHERE specs <> '{}'::jsonb`,
    );
    for (const r of rows) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.specs ?? {})) {
        const key = RENAME[k] ?? k;
        next[key] = v === true ? 'yes' : v === false ? 'no' : v == null ? '' : String(v);
      }
      await queryRunner.query(`UPDATE devices SET specs = $1::jsonb WHERE id = $2`, [
        JSON.stringify(next),
        r.id,
      ]);
    }
  }

  public async down(): Promise<void> {
    // Labels are still readable as-is; no reverse mapping needed.
  }
}
