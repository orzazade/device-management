import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Actor, writeAudit } from '../audit/audit';
import { AppDbContext } from '../db/app-db-context';
import { DeviceInput } from './devices.commands';

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportReport {
  ok: number;
  errors: ImportRowError[];
  committed: boolean;
  /** Extra headers that were stored as free-form specs. */
  specColumns?: string[];
}

/** Fixed columns the importer understands. Every OTHER column becomes a
 * spec on the device, keyed by its header text ("RAM" → specs.RAM). */
export const BASE_COLUMNS = [
  'brand', 'model', 'os', 'os_version', 'serial', 'imei', 'accessories', 'project', 'squad',
];

/** Example spec columns in the template — any header works. */
const TEMPLATE_SPEC_EXAMPLES = ['RAM', 'Storage', 'Screen', '5G'];

/**
 * Excel import (GOALS.md): dry run first, loud row-by-row errors, no silent
 * partial imports. Fixed columns: brand, model, os, os_version, serial, imei,
 * accessories (comma-separated), project. Extra columns = specs.
 */
@Injectable()
export class ImportService {
  constructor(private readonly db: AppDbContext) {}

  /** Template with the exact headers the importer reads + one example row. */
  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Devices');
    const headers = [...BASE_COLUMNS, ...TEMPLATE_SPEC_EXAMPLES];
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    const example: Record<string, string> = {
      brand: 'Samsung', model: 'Galaxy S24', os: 'Android', os_version: '14',
      serial: 'RF8T2001', imei: '353912100000002', accessories: 'Box, Cable, Charger',
      squad: '',
      project: '', RAM: '8 GB', Storage: '128 GB', Screen: '6.2"', '5G': 'yes',
    };
    ws.addRow(headers.map((h) => example[h] ?? ''));
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  async run(buffer: Buffer, actor: Actor, commit: boolean): Promise<ImportReport> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      return {
        ok: 0,
        errors: [{
          row: 0,
          message:
            'Could not read this file as .xlsx. Old .xls files must be re-saved as .xlsx (File → Save As in Excel).',
        }],
        committed: false,
      };
    }
    const ws = wb.worksheets[0];
    if (!ws) return { ok: 0, errors: [{ row: 0, message: 'File has no sheets' }], committed: false };

    const headers: Record<string, number> = {};
    // Extra columns keep their exact header text as the spec name.
    const specColumns: { name: string; col: number }[] = [];
    ws.getRow(1).eachCell((cell, col) => {
      const raw = (cell.text ?? String(cell.value ?? '')).trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      headers[key] = col;
      if (!BASE_COLUMNS.includes(key)) specColumns.push({ name: raw, col: Number(col) });
    });
    for (const required of ['brand', 'model', 'os', 'serial']) {
      if (!headers[required]) {
        return {
          ok: 0,
          errors: [{ row: 1, message: `Missing required column "${required}"` }],
          committed: false,
        };
      }
    }

    const groups = await this.db.projects().find();
    const projectByName = new Map(
      groups.filter((p) => p.kind !== 'squad').map((p) => [p.name.toLowerCase(), p.id]),
    );
    const squadByName = new Map(
      groups.filter((p) => p.kind === 'squad').map((p) => [p.name.toLowerCase(), p.id]),
    );
    const existing = await this.db
      .devices()
      .find({ select: { serial: true, deletedAt: true }, withDeleted: true });
    const existingSerials = new Map(existing.map((d) => [d.serial, !!d.deletedAt]));

    const cellStr = (row: ExcelJS.Row, name: string): string => {
      const col = headers[name];
      if (!col) return '';
      const cell = row.getCell(col);
      // .text resolves rich text, formulas and hyperlinks to what the
      // user actually sees — String(value) would print [object Object].
      const v = cell.text ?? cell.value;
      return v == null ? '' : String(v).trim();
    };

    const valid: DeviceInput[] = [];
    const errors: ImportRowError[] = [];
    const seenSerials = new Set<string>();

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const brand = cellStr(row, 'brand');
      const model = cellStr(row, 'model');
      const os = cellStr(row, 'os');
      const serial = cellStr(row, 'serial');
      const imei = cellStr(row, 'imei');
      const projectName = cellStr(row, 'project');
      if (!brand && !model && !os && !serial) return; // fully empty row

      const problems: string[] = [];
      if (!brand) problems.push('brand is empty');
      if (!model) problems.push('model is empty');
      if (!os) problems.push('os is empty');
      if (!serial) problems.push('serial is empty');
      if (serial && existingSerials.has(serial)) {
        problems.push(
          existingSerials.get(serial)
            ? `serial ${serial} belongs to a DELETED device — restore it instead of re-importing`
            : `serial ${serial} already exists`,
        );
      }
      if (serial && seenSerials.has(serial)) problems.push(`serial ${serial} is duplicated in the file`);
      if (imei && !/^\d{8,20}$/.test(imei)) problems.push(`imei "${imei}" is not a number`);
      if (serial && !/^[A-Za-z0-9-]{4,}$/.test(serial))
        problems.push(`serial "${serial}" — letters/numbers only, at least 4, no spaces`);
      let projectId: string | null = null;
      if (projectName) {
        projectId = projectByName.get(projectName.toLowerCase()) ?? null;
        if (!projectId) problems.push(`project "${projectName}" does not exist`);
      }
      const squadName = cellStr(row, 'squad');
      let squadId: string | null = null;
      if (squadName) {
        squadId = squadByName.get(squadName.toLowerCase()) ?? null;
        if (!squadId) problems.push(`squad "${squadName}" does not exist`);
      }
      if (!projectName && !squadName) problems.push('give a project or a squad');

      if (problems.length) {
        errors.push({ row: rowNumber, message: problems.join('; ') });
        return;
      }
      seenSerials.add(serial);
      const specs: Record<string, string> = {};
      for (const { name, col } of specColumns) {
        const cell = row.getCell(col);
        const v = (cell.text ?? (cell.value == null ? '' : String(cell.value))).trim();
        if (v) specs[name] = v;
      }
      valid.push({
        brand,
        model,
        os,
        osVersion: cellStr(row, 'os_version'),
        specs,
        serial,
        imei,
        accessories: cellStr(row, 'accessories')
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        projectId,
        squadId,
      });
    });

    const specNames = specColumns.map((c) => c.name);
    if (!commit) return { ok: valid.length, errors, committed: false, specColumns: specNames };

    await this.db.withTransaction(async (ctx) => {
      for (const d of valid) {
        const saved = await ctx.devices.save({ ...d, accessories: d.accessories ?? [] });
        // Every imported device gets its own history, like a manual add.
        await writeAudit(ctx.manager, actor, {
          entityType: 'device',
          entityId: saved.id,
          action: 'created',
          newValue: { brand: d.brand, model: d.model, serial: d.serial, via: 'excel_import' },
        });
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'device',
        entityId: 'bulk',
        action: 'excel_import',
        newValue: { imported: valid.length, rejectedRows: errors.map((e) => e.row) },
      });
    });
    return { ok: valid.length, errors, committed: true, specColumns: specNames };
  }
}
