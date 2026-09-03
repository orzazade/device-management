import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { In } from 'typeorm';
import { writeAudit } from '../audit/audit';
import { CommandBus } from '@nestjs/cqrs';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { Device, DEVICE_STATUSES } from '../entities/device.entity';
import {
  CreateDeviceCommand,
  DeviceInput,
  UpdateDeviceCommand,
} from './devices.commands';
import { ImportService } from './import.service';

class DeviceDto implements DeviceInput {
  @IsString()
  @MinLength(1)
  brand: string;

  @IsString()
  @MinLength(1)
  model: string;

  @IsString()
  @MinLength(1)
  os: string;

  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsObject()
  specs?: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  serial: string;

  @IsOptional()
  @IsString()
  imei?: string;

  @IsOptional()
  @IsArray()
  accessories?: string[];

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  squadId?: string;
}

class DevicePatchDto {
  @IsOptional() @IsString() @MinLength(1) brand?: string;
  @IsOptional() @IsString() @MinLength(1) model?: string;
  @IsOptional() @IsString() @MinLength(1) os?: string;
  @IsOptional() @IsString() osVersion?: string;
  @IsOptional() @IsObject() specs?: Record<string, unknown>;
  @IsOptional() @IsString() imei?: string;
  @IsOptional() @IsArray() accessories?: string[];
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() squadId?: string | null;
  @IsOptional() @IsIn(DEVICE_STATUSES) status?: string;
  @IsOptional() @IsString() damageNote?: string | null;
}

const actor = (req: { user: AuthUser }) => ({ id: req.user.sub, name: req.user.name });

const pub = (d: Device) => ({
  id: d.id,
  brand: d.brand,
  model: d.model,
  os: d.os,
  osVersion: d.osVersion,
  specs: d.specs,
  serial: d.serial,
  imei: d.imei,
  status: d.status,
  damageNote: d.damageNote,
  accessories: d.accessories,
  holder: d.holder ? { id: d.holder.id, name: d.holder.name } : null,
  project: d.project ? { id: d.project.id, name: d.project.name } : null,
  squad: d.squad ? { id: d.squad.id, name: d.squad.name } : null,
  createdAt: d.createdAt,
});

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly db: AppDbContext,
    private readonly bus: CommandBus,
    private readonly importer: ImportService,
  ) {}

  @Get()
  async list(
    @Req() req: { user: AuthUser },
    @Query('q') q?: string,
    @Query('brand') brand?: string,
    @Query('os') os?: string,
    @Query('status') status?: string,
  ) {
    const qb = this.db
      .devices()
      .createQueryBuilder('d')
      .withDeleted()
      .leftJoinAndSelect('d.holder', 'holder')
      .leftJoinAndSelect('d.project', 'project')
      .leftJoinAndSelect('d.squad', 'squad')
      .orderBy('d.brand')
      .addOrderBy('d.model');
    const staffUser = req.user.role === 'admin';
    if (status && status !== 'deleted' && !(DEVICE_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`Unknown status "${status}"`);
    }
    if (status === 'deleted' && staffUser) {
      qb.andWhere('d.deletedAt IS NOT NULL');
    } else {
      qb.andWhere('d.deletedAt IS NULL');
      if (status) qb.andWhere('d.status = :status', { status });
    }
    if (q) {
      qb.andWhere(
        '(d.brand ILIKE :q OR d.model ILIKE :q OR d.os ILIKE :q OR d.serial ILIKE :q OR d.imei ILIKE :q OR holder.name ILIKE :q OR d.specs::text ILIKE :q)',
        { q: `%${q}%` },
      );
    }
    if (brand) qb.andWhere('d.brand = :brand', { brand });
    if (os) qb.andWhere('d.os = :os', { os });
    const rows = await qb.getMany();
    // "When does it come free?" — the end date of the current loan.
    const open = rows.length
      ? await this.db.requests().find({
          where: { deviceId: In(rows.map((r) => r.id)), state: In(['active', 'overdue']) },
        })
      : [];
    const busy = new Map(open.map((l) => [l.deviceId, { until: l.toDate, state: l.state }]));
    return rows.map((d) => ({ ...pub(d), busy: busy.get(d.id) ?? null }));
  }

  @Delete(':id')
  @Roles('admin')
  async softDelete(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const device = await ctx.devices.findOne({ where: { id } });
      if (!device) throw new NotFoundException('Device not found');
      if (device.holderId) {
        throw new ConflictException('Device is in someone’s hands — take it back first');
      }
      const open = await ctx.requests.count({
        where: { deviceId: id, state: In(['pending', 'approved', 'active', 'overdue']) },
      });
      if (open > 0) {
        throw new ConflictException(
          `Device has ${open} open request(s) — resolve them first`,
        );
      }
      const openRepairs = await ctx.repairs.count({
        where: { deviceId: id, state: In(['reported', 'repair_requested', 'in_repair']) },
      });
      if (openRepairs > 0) {
        throw new ConflictException(
          `Device has ${openRepairs} open repair(s) — close them first`,
        );
      }
      await ctx.devices.softDelete(id);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'device',
        entityId: id,
        action: 'deleted',
        oldValue: { device: `${device.brand} ${device.model}`, serial: device.serial },
      });
      return { ok: true };
    });
  }

  @Post(':id/restore')
  @Roles('admin')
  async restore(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const device = await ctx.devices.findOne({ where: { id }, withDeleted: true });
      if (!device || !device.deletedAt) throw new NotFoundException('No deleted device with this id');
      await ctx.devices.restore(id);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'device',
        entityId: id,
        action: 'restored',
        newValue: { device: `${device.brand} ${device.model}`, serial: device.serial },
      });
      return { ok: true };
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const d = await this.db
      .devices()
      .findOne({ where: { id }, relations: { holder: true, project: true, squad: true } });
    if (!d) throw new NotFoundException('Device not found');
    return pub(d);
  }

  /**
   * Date ranges the request calendar must block: approved/active/overdue are
   * hard bookings, pending are "requested" (picking them invites a conflict).
   * excludeRequestId lets the time-override modal ignore its own range.
   */
  @Get(':id/bookings')
  async bookings(
    @Param('id') id: string,
    @Query('excludeRequestId') excludeRequestId?: string,
  ) {
    const rows = await this.db.requests().find({
      where: { deviceId: id },
      select: { id: true, fromDate: true, toDate: true, state: true },
    });
    return rows
      .filter((r) => r.id !== excludeRequestId)
      .filter((r) => ['pending', 'approved', 'active', 'overdue'].includes(r.state))
      .map((r) => ({
        fromDate: r.fromDate,
        toDate: r.toDate,
        kind: r.state === 'pending' ? 'requested' : 'booked',
      }));
  }

  @Get(':id/repairs')
  async repairs(@Param('id') id: string) {
    const rows = await this.db.repairs().find({
      where: { deviceId: id },
      relations: { reportedBy: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      issue: r.issue,
      state: r.state,
      reportedBy: r.reportedBy?.name,
      createdAt: r.createdAt,
      closedAt: r.closedAt,
    }));
  }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    // The device's story includes its loans and repairs, not just edits.
    const [requestIds, repairIds] = await Promise.all([
      this.db.requests().find({ where: { deviceId: id }, select: { id: true }, withDeleted: true }),
      this.db.repairs().find({ where: { deviceId: id }, select: { id: true }, withDeleted: true }),
    ]);
    const wheres: { entityType: string; entityId: unknown }[] = [
      { entityType: 'device', entityId: id },
    ];
    if (requestIds.length)
      wheres.push({ entityType: 'request', entityId: In(requestIds.map((r) => r.id)) });
    if (repairIds.length)
      wheres.push({ entityType: 'repair', entityId: In(repairIds.map((r) => r.id)) });
    return this.db
      .auditLogs()
      .find({ where: wheres as never, order: { id: 'DESC' }, take: 200 });
  }

  @Post()
  @Roles('admin')
  async create(@Body() dto: DeviceDto, @Req() req: { user: AuthUser }) {
    const d: Device = await this.bus.execute(new CreateDeviceCommand(actor(req), dto));
    // Reply with the same shape as GET — relations included.
    const full = await this.db
      .devices()
      .findOne({ where: { id: d.id }, relations: { holder: true, project: true, squad: true } });
    return pub(full ?? d);
  }

  @Patch(':id')
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() dto: DevicePatchDto,
    @Req() req: { user: AuthUser },
  ) {
    const d: Device = await this.bus.execute(new UpdateDeviceCommand(actor(req), id, dto));
    const full = await this.db
      .devices()
      .findOne({ where: { id: d.id }, relations: { holder: true, project: true, squad: true } });
    return pub(full ?? d);
  }

  @Post('import')
  @Roles('admin')
  async import(@Query('commit') commit: string, @Req() req: any) {
    const file = await req.file();
    if (!file) throw new BadRequestException('Upload an .xlsx file');
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      // fastify-multipart throws when the 10 MB limit trips mid-stream.
      throw new BadRequestException(
        'File is bigger than the 10 MB limit — split it or remove embedded images',
      );
    }
    return this.importer.run(buffer, actor(req), commit === 'true');
  }

  /** The column contract as a file, not a sentence: header row + one
   * example, generated from the same map the importer reads. */
  @Get('import/template')
  @Roles('admin')
  async importTemplate(@Res({ passthrough: false }) res: any) {
    const buffer = await this.importer.buildTemplate();
    res
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="devicedesk-import-template.xlsx"')
      .send(buffer);
  }
}
