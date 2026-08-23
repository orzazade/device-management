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
}

/**
 * Excel import (GOALS.md): dry run first, loud row-by-row errors, no silent
 * partial imports. Columns (header row): brand, model, os, os_version,
 * specs, serial, imei, accessories (comma-separated), project.
 */
@Injectable()
export class ImportService {
  constructor(private readonly db: AppDbContext) {}

  async run(buffer: Buffer, actor: Actor, commit: boolean): Promise<ImportReport> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { ok: 0, errors: [{ row: 0, message: 'File has no sheets' }], committed: false };

    const headers: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, col) => {
      headers[String(cell.value).trim().toLowerCase()] = col;
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

    const projects = await this.db.projects().find();
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
    const existingSerials = new Set(
      (
        await this.db.devices().find({ select: { serial: true }, withDeleted: true })
      ).map((d) => d.serial),
    );

    const cellStr = (row: ExcelJS.Row, name: string): string => {
      const col = headers[name];
      if (!col) return '';
      const v = row.getCell(col).value;
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
      if (serial && existingSerials.has(serial)) problems.push(`serial ${serial} already exists`);
      if (serial && seenSerials.has(serial)) problems.push(`serial ${serial} is duplicated in the file`);
      if (imei && !/^\d{8,20}$/.test(imei)) problems.push(`imei "${imei}" is not a number`);
      let projectId: string | null = null;
      if (projectName) {
        projectId = projectByName.get(projectName.toLowerCase()) ?? null;
        if (!projectId) problems.push(`project "${projectName}" does not exist`);
      }

      if (problems.length) {
        errors.push({ row: rowNumber, message: problems.join('; ') });
        return;
      }
      seenSerials.add(serial);
      const specs: Record<string, unknown> = {};
      for (const [col, key] of [
        ['chipset', 'chipset'],
        ['ram', 'ram'],
        ['storage', 'storage'],
        ['battery', 'battery'],
        ['screen', 'screenSize'],
        ['color', 'color'],
        ['year', 'releaseYear'],
        ['specs', 'notes'],
      ] as const) {
        const v = cellStr(row, col);
        if (v) specs[key] = v;
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
      });
    });

    if (!commit) return { ok: valid.length, errors, committed: false };

    await this.db.withTransaction(async (ctx) => {
      for (const d of valid) {
        await ctx.devices.save({ ...d, accessories: d.accessories ?? [] });
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'device',
        entityId: 'bulk',
        action: 'excel_import',
        newValue: { imported: valid.length, rejectedRows: errors.map((e) => e.row) },
      });
    });
    return { ok: valid.length, errors, committed: true };
  }
}
