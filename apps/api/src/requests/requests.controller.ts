import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
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

  @IsString()
  @MinLength(5)
  reason: string;

  @IsDateString()
  fromDate: string;

  @IsDateString()
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

class TimeDto {
  @IsDateString()
  fromDate: string;

  @IsDateString()
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
      }
    : { id: r.deviceId },
  requester: r.requester ? { id: r.requester.id, name: r.requester.name } : { id: r.requesterId },
  createdById: r.createdById,
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
    const r: DeviceRequest = await this.bus.execute(
      new CreateRequestCommand(actor(req), {
        deviceId: dto.deviceId,
        requesterId,
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
      .leftJoinAndSelect('r.device', 'device')
      .leftJoinAndSelect('device.holder', 'deviceHolder')
      .leftJoinAndSelect('r.requester', 'requester')
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
        relations: { device: { holder: true }, requester: true },
        order: { createdAt: 'DESC' },
      });
    const mine = all.filter(
      (r) =>
        r.device.holderId === req.user.sub ||
        (r.device.holderId === null && staff(req.user)),
    );
    return mine.map(pub);
  }

  @Post(':id/approve')
  @Roles('admin', 'manager')
  async approve(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    await this.bus.execute(new DecideRequestCommand(actor(req), id, 'approved', req.user.role));
    return this.reload(id);
  }

  @Post(':id/reject')
  @Roles('admin', 'manager')
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

  @Patch(':id/time')
  @Roles('admin', 'manager')
  async overrideTime(
    @Param('id') id: string,
    @Body() dto: TimeDto,
    @Req() req: { user: AuthUser },
  ) {
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

  /** Manual overdue scan — same code the hourly job runs, for ops and tests. */
  @Post('scan-overdue')
  @Roles('admin', 'manager')
  async scanOverdue() {
    const marked = await this.jobs.scanOverdue();
    return { marked };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    await this.bus.execute(
      new CancelRequestCommand(actor(req), id, req.user.sub, staff(req.user)),
    );
    return this.reload(id);
  }

  private async reload(id: string) {
    const r = await this.db.requests().findOne({
      where: { id },
      relations: { device: { holder: true }, requester: true },
    });
    return pub(r!);
  }
}
