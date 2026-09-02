import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { DeviceRequest } from '../entities/device-request.entity';
import { JobsService } from '../jobs/jobs.service';
import {
  CancelRequestCommand,
  ConfirmHandoverCommand,
  CreateRequestCommand,
  DecideRequestCommand,
  OverrideTimeCommand,
  ReturnRequestCommand,
} from './requests.commands';

class CreateRequestDto {
  @IsUUID()
  deviceId: string;

  /** Which project the device is borrowed for. */
  @IsUUID()
  projectId: string;

  @IsString()
  @MinLength(5)
  reason: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate: string;

  /** Staff only: request on behalf of this user. */
  @IsOptional()
  @IsUUID()
  onBehalfOfId?: string;
}

class RejectDto {
  @IsString()
  @MinLength(5)
  note: string;
}

class CancelDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

class TimeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate: string;
}

class ReturnDto {
  @IsArray()
  missingAccessories: string[];

  @IsBoolean()
  damaged: boolean;

  @IsOptional()
  @IsString()
  damageNote?: string;
}

const actor = (req: { user: AuthUser }) => ({ id: req.user.sub, name: req.user.name });
const staff = (u: AuthUser) => u.role === 'admin' || u.role === 'manager';

const pub = (r: DeviceRequest) => ({
  id: r.id,
  device: r.device
    ? {
        id: r.device.id,
        brand: r.device.brand,
        model: r.device.model,
        holder: r.device.holder ? { id: r.device.holder.id, name: r.device.holder.name } : null,
        accessories: r.device.accessories,
        damageNote: r.device.damageNote,
        status: r.device.status,
      }
    : { id: r.deviceId },
  requester: r.requester ? { id: r.requester.id, name: r.requester.name } : { id: r.requesterId },
  createdById: r.createdById,
  project: r.project ? { id: r.project.id, name: r.project.name } : null,
  reason: r.reason,
  fromDate: r.fromDate,
  toDate: r.toDate,
  state: r.state,
  decisionNote: r.decisionNote,
  createdAt: r.createdAt,
});

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly db: AppDbContext,
    private readonly bus: CommandBus,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateRequestDto, @Req() req: { user: AuthUser }) {
    const requesterId =
      dto.onBehalfOfId && staff(req.user) ? dto.onBehalfOfId : req.user.sub;
    if (requesterId !== req.user.sub) {
      const target = await this.db.users().findOne({ where: { id: requesterId, active: true } });
      if (!target) {
        throw new BadRequestException('That user is deactivated or gone — pick someone active');
      }
    }
    const r: DeviceRequest = await this.bus.execute(
      new CreateRequestCommand(actor(req), {
        deviceId: dto.deviceId,
        requesterId,
        projectId: dto.projectId,
        reason: dto.reason,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
      }),
    );
    return this.reload(r.id);
  }

  @Get()
  async list(
    @Req() req: { user: AuthUser },
    @Query('scope') scope?: string,
    @Query('state') state?: string,
  ) {
    const qb = this.db
      .requests()
      .createQueryBuilder('r')
      .withDeleted() // history must outlive a deleted device
      .leftJoinAndSelect('r.device', 'device')
      .leftJoinAndSelect('device.holder', 'deviceHolder')
      .leftJoinAndSelect('r.requester', 'requester')
      .leftJoinAndSelect('r.project', 'project')
      .orderBy('r.createdAt', 'DESC');
    // "all" is staff-only; everyone else always sees just their own.
    if (scope !== 'all' || !staff(req.user)) {
      qb.andWhere('(r.requesterId = :me OR r.createdById = :me)', { me: req.user.sub });
    }
    if (state) qb.andWhere('r.state = :state', { state });
    return (await qb.getMany()).map(pub);
  }

  /** Approved requests waiting for THIS user to hand the device over. */
  @Get('pending-handover')
  async pendingHandover(@Req() req: { user: AuthUser }) {
    const all = await this.db
      .requests()
      .find({
        where: { state: 'approved' },
        relations: { device: { holder: true }, requester: true, project: true },
        order: { createdAt: 'DESC' },
      });
    const mine = all.filter(
      (r) =>
        r.device.holderId === req.user.sub ||
        (r.device.holderId === null && staff(req.user)),
    );
    return mine.map(pub);
  }

  /** Staff decide, unless the 'holder' policy is on and someone is holding
   *  the device — then only that person may. Enforced in DecideRequestHandler,
   *  which is the only place that can see the policy and the holder together. */
  /** Pending requests waiting for THIS user to decide, because they hold the
   *  device. Empty unless the 'holder' approval policy is on — mirrors
   *  pending-handover, which answers the same question for handovers. */
  @Get('pending-my-approval')
  async pendingMyApproval(@Req() req: { user: AuthUser }) {
    const mode = await this.db.settings().findOne({ where: { key: 'approval_mode' } });
    if (mode?.value !== 'holder') return [];
    const all = await this.db.requests().find({
      where: { state: 'pending' },
      relations: { device: { holder: true }, requester: true, project: true },
      order: { createdAt: 'DESC' },
    });
    return all
      .filter((r) => r.device?.holderId === req.user.sub && r.requesterId !== req.user.sub)
      .map(pub);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    await this.bus.execute(new DecideRequestCommand(actor(req), id, 'approved', req.user.role));
    return this.reload(id);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectDto,
    @Req() req: { user: AuthUser },
  ) {
    await this.bus.execute(
      new DecideRequestCommand(actor(req), id, 'rejected', req.user.role, dto.note),
    );
    return this.reload(id);
  }

  /** Staff can move any booking; the holder may extend their OWN active
   * or overdue loan (the conflict checks still apply). */
  @Patch(':id/time')
  async overrideTime(
    @Param('id') id: string,
    @Body() dto: TimeDto,
    @Req() req: { user: AuthUser },
  ) {
    if (!staff(req.user)) {
      const r = await this.db.requests().findOne({ where: { id } });
      const ownOpenLoan =
        r && r.requesterId === req.user.sub && ['active', 'overdue'].includes(r.state);
      if (!ownOpenLoan) {
        throw new ForbiddenException('Only staff can change other bookings — you can extend your own active loan');
      }
      if (dto.fromDate !== r.fromDate) {
        throw new ForbiddenException('You can only move the end date of your loan');
      }
    }
    await this.bus.execute(new OverrideTimeCommand(actor(req), id, dto.fromDate, dto.toDate));
    return this.reload(id);
  }

  @Post(':id/handover')
  async handover(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    await this.bus.execute(
      new ConfirmHandoverCommand(actor(req), id, req.user.sub, staff(req.user)),
    );
    return this.reload(id);
  }

  @Post(':id/return')
  async returnDevice(
    @Param('id') id: string,
    @Body() dto: ReturnDto,
    @Req() req: { user: AuthUser },
  ) {
    await this.bus.execute(
      new ReturnRequestCommand(actor(req), id, req.user.sub, staff(req.user), dto),
    );
    return this.reload(id);
  }

  /** The tester's half of the return: announce the device is coming back.
   * Staff record the actual check-in (the receipt) on the Loans board. */
  @Post(':id/return-intent')
  async returnIntent(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const r = await ctx.requests.findOne({
        where: { id },
        relations: { device: true, requester: true, project: true },
      });
      if (!r) throw new NotFoundException('Request not found');
      if (r.requesterId !== req.user.sub) {
        throw new ForbiddenException('Only the holder can offer a return');
      }
      if (!['active', 'overdue'].includes(r.state)) {
        throw new ConflictException(`Nothing to return — the loan is ${r.state}`);
      }
      const { writeAudit } = await import('../audit/audit');
      const { notify, staffIds } = await import('../notifications/notify');
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'request',
        entityId: r.id,
        action: 'return_offered',
        newValue: { device: `${r.device.brand} ${r.device.model}` },
      });
      await notify(ctx.manager, 'handover_pending', await staffIds(ctx.manager),
        `${r.requester.name} is returning ${r.device.brand} ${r.device.model} — check it in on the Loans board`,
        { requestId: r.id }, '/loans');
      return { ok: true };
    });
  }

  /** Manual overdue scan — same code the hourly job runs, for ops and tests. */
  @Post('scan-overdue')
  @Roles('admin', 'manager')
  async scanOverdue(@Req() req: { user: AuthUser }) {
    const marked = await this.jobs.scanOverdue(actor(req));
    return { marked };
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelDto,
    @Req() req: { user: AuthUser },
  ) {
    await this.bus.execute(
      new CancelRequestCommand(actor(req), id, req.user.sub, staff(req.user), dto?.note),
    );
    return this.reload(id);
  }

  private async reload(id: string) {
    const r = await this.db.requests().findOne({
      where: { id },
      relations: { device: { holder: true }, requester: true, project: true },
      withDeleted: true,
    });
    return pub(r!);
  }
}
