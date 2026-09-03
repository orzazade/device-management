import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { IsString, IsUUID, MinLength } from 'class-validator';
import { writeAudit } from '../audit/audit';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { Repair, REPAIR_TRANSITIONS, RepairState } from '../entities/repair.entity';
import { notify, staffIds } from '../notifications/notify';
import { transition as requestTransition } from '../requests/request-machine';

class ReportDto {
  @IsUUID()
  deviceId: string;

  @IsString()
  @MinLength(5)
  issue: string;
}

class WriteOffDto {
  /** Finance will ask "why was this scrapped" — the answer lives here. */
  @IsString()
  @MinLength(5)
  reason: string;
}

function repairTransition(repair: Repair, to: RepairState): RepairState {
  const allowed = REPAIR_TRANSITIONS[repair.state] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException(`Repair is "${repair.state}" — it cannot become "${to}"`);
  }
  const from = repair.state;
  repair.state = to;
  return from;
}

const actor = (req: { user: AuthUser }) => ({ id: req.user.sub, name: req.user.name });

const pub = (r: Repair) => ({
  id: r.id,
  device: r.device
    ? { id: r.device.id, brand: r.device.brand, model: r.device.model }
    : { id: r.deviceId },
  reportedBy: r.reportedBy ? { id: r.reportedBy.id, name: r.reportedBy.name } : null,
  issue: r.issue,
  state: r.state,
  createdAt: r.createdAt,
  closedAt: r.closedAt,
});

@Controller('repairs')
export class RepairsController {
  constructor(private readonly db: AppDbContext) {}

  @Get()
  async list() {
    const rows = await this.db.repairs().find({
      relations: { device: true, reportedBy: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map(pub);
  }

  @Post()
  async report(@Body() dto: ReportDto, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const device = await ctx.devices.findOne({ where: { id: dto.deviceId } });
      if (!device) throw new NotFoundException('Device not found');
      if (device.status === 'retired') {
        throw new ConflictException('This device is written off — it has no repair path');
      }
      const openRepair = await ctx.repairs.findOne({
        where: [
          { deviceId: device.id, state: 'reported' },
          { deviceId: device.id, state: 'repair_requested' },
          { deviceId: device.id, state: 'in_repair' },
        ],
      });
      if (openRepair) {
        throw new ConflictException(
          `This device already has an open repair (“${openRepair.issue}”) — add details there instead of filing a second one`,
        );
      }
      const repair = await ctx.repairs.save({
        deviceId: device.id,
        reportedById: req.user.sub,
        issue: dto.issue,
      });
      device.damageNote = dto.issue;
      await ctx.devices.save(device);
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'repair',
        entityId: repair.id,
        action: 'reported',
        newValue: { device: `${device.brand} ${device.model}`, issue: dto.issue },
      });
      await notify(ctx.manager, 'repair_update', await staffIds(ctx.manager),
        `Damage reported: ${device.brand} ${device.model} — ${dto.issue}`,
        { repairId: repair.id }, '/repairs');
      return pub({ ...repair, device } as Repair);
    });
  }

  @Post(':id/advance')
  @Roles('admin')
  async advance(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const repair = await ctx.repairs.findOne({
        where: { id },
        relations: { device: true, reportedBy: true },
        withDeleted: true, // a soft-deleted device must not 500 the repair flow
      });
      if (!repair) throw new NotFoundException('Repair not found');
      const next: RepairState | undefined = (
        { reported: 'repair_requested', repair_requested: 'in_repair', in_repair: 'fixed' } as const
      )[repair.state as 'reported' | 'repair_requested' | 'in_repair'];
      if (!next) throw new ConflictException(`Repair is already ${repair.state}`);
      const old = repairTransition(repair, next);

      const device = repair.device;
      if (next === 'in_repair') {
        // Device leaves circulation; whatever was running on it is over.
        const open = await ctx.requests.find({
          where: [
            { deviceId: device.id, state: 'active' },
            { deviceId: device.id, state: 'overdue' },
          ],
        });
        for (const p of open) {
          const pOld = requestTransition(p, 'returned');
          await ctx.requests.save(p);
          await writeAudit(ctx.manager, actor(req), {
            entityType: 'request',
            entityId: p.id,
            action: 'closed_by_repair',
            oldValue: { state: pOld },
            newValue: { state: 'returned' },
          });
          await notify(ctx.manager, 'repair_update', [p.requesterId],
            `Your loan of ${device.brand} ${device.model} was closed — the device is going to repair. Please hand it in.`,
            { requestId: p.id }, '/requests');
        }
        device.status = 'in_repair';
        device.holderId = null;
      }
      if (next === 'fixed') {
        // Only revive a device that is actually out for this repair — a
        // written-off (retired) device must never come back via 'fixed'.
        if (device.status === 'in_repair') {
          device.status = 'available';
          device.damageNote = null;
        }
        repair.closedAt = new Date();
      }
      await ctx.devices.save(device);
      await ctx.repairs.save(repair);
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'repair',
        entityId: repair.id,
        action: next,
        oldValue: { state: old },
        newValue: { state: next },
      });
      await notify(ctx.manager, 'repair_update', [repair.reportedById],
        `Repair update: ${device.brand} ${device.model} → ${next.replace(/_/g, ' ')}`,
        { repairId: repair.id }, '/repairs');
      return pub(repair);
    });
  }

  /** A mistaken report gets an exit that does not drag the device out
   * of circulation. Staff only; clears the damage note it created. */
  @Post(':id/cancel')
  @Roles('admin')
  async cancel(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const repair = await ctx.repairs.findOne({
        where: { id },
        relations: { device: true, reportedBy: true },
        withDeleted: true,
      });
      if (!repair) throw new NotFoundException('Repair not found');
      const old = repairTransition(repair, 'cancelled');
      repair.closedAt = new Date();
      const device = repair.device;
      if (device.damageNote === repair.issue) {
        device.damageNote = null;
        await ctx.devices.save(device);
      }
      await ctx.repairs.save(repair);
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'repair',
        entityId: repair.id,
        action: 'cancelled',
        oldValue: { state: old },
        newValue: { state: 'cancelled' },
      });
      await notify(ctx.manager, 'repair_update', [repair.reportedById],
        `Your damage report for ${device.brand} ${device.model} was cancelled by ${req.user.name}`,
        { repairId: repair.id }, '/repairs');
      return pub(repair);
    });
  }

  @Post(':id/write-off')
  @Roles('admin')
  async writeOff(
    @Param('id') id: string,
    @Body() dto: WriteOffDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.db.withTransaction(async (ctx) => {
      const repair = await ctx.repairs.findOne({
        where: { id },
        relations: { device: true, reportedBy: true },
        withDeleted: true, // a soft-deleted device must not 500 the repair flow
      });
      if (!repair) throw new NotFoundException('Repair not found');
      const old = repairTransition(repair, 'written_off');
      const device = repair.device;
      // Retirement ends any open loan — otherwise a later return check-in
      // would flip the retired device back to available.
      const open = await ctx.requests.find({
        where: [
          { deviceId: device.id, state: 'active' },
          { deviceId: device.id, state: 'overdue' },
        ],
      });
      for (const p of open) {
        const pOld = requestTransition(p, 'returned');
        await ctx.requests.save(p);
        await writeAudit(ctx.manager, actor(req), {
          entityType: 'request',
          entityId: p.id,
          action: 'closed_by_write_off',
          oldValue: { state: pOld },
          newValue: { state: 'returned' },
        });
        await notify(ctx.manager, 'repair_update', [p.requesterId],
          `Your loan of ${device.brand} ${device.model} was closed — the device is written off. Please hand it in.`,
          { requestId: p.id }, '/requests');
      }
      device.status = 'retired';
      device.holderId = null;
      repair.closedAt = new Date();
      await ctx.devices.save(device);
      await ctx.repairs.save(repair);
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'repair',
        entityId: repair.id,
        action: 'written_off',
        oldValue: { state: old },
        newValue: { state: 'written_off', deviceStatus: 'retired', reason: dto.reason },
      });
      return pub(repair);
    });
  }
}
