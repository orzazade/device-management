import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  IsArray,
  IsIn,
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
  @IsString()
  specs?: string;

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
}

class DevicePatchDto {
  @IsOptional() @IsString() @MinLength(1) brand?: string;
  @IsOptional() @IsString() @MinLength(1) model?: string;
  @IsOptional() @IsString() @MinLength(1) os?: string;
  @IsOptional() @IsString() osVersion?: string;
  @IsOptional() @IsString() specs?: string;
  @IsOptional() @IsString() imei?: string;
  @IsOptional() @IsArray() accessories?: string[];
  @IsOptional() @IsUUID() projectId?: string | null;
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
    @Query('q') q?: string,
    @Query('brand') brand?: string,
    @Query('os') os?: string,
    @Query('status') status?: string,
  ) {
    const qb = this.db
      .devices()
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.holder', 'holder')
      .leftJoinAndSelect('d.project', 'project')
      .orderBy('d.brand')
      .addOrderBy('d.model');
    if (q) {
      qb.andWhere(
        '(d.brand ILIKE :q OR d.model ILIKE :q OR d.os ILIKE :q OR d.serial ILIKE :q OR holder.name ILIKE :q)',
        { q: `%${q}%` },
      );
    }
    if (brand) qb.andWhere('d.brand = :brand', { brand });
    if (os) qb.andWhere('d.os = :os', { os });
    if (status) qb.andWhere('d.status = :status', { status });
    return (await qb.getMany()).map(pub);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const d = await this.db
      .devices()
      .findOne({ where: { id }, relations: { holder: true, project: true } });
    if (!d) throw new NotFoundException('Device not found');
    return pub(d);
  }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    return this.db
      .auditLogs()
      .find({ where: { entityType: 'device', entityId: id }, order: { id: 'DESC' }, take: 200 });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@Body() dto: DeviceDto, @Req() req: { user: AuthUser }) {
    const d: Device = await this.bus.execute(new CreateDeviceCommand(actor(req), dto));
    return pub(d);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @Param('id') id: string,
    @Body() dto: DevicePatchDto,
    @Req() req: { user: AuthUser },
  ) {
    const d: Device = await this.bus.execute(new UpdateDeviceCommand(actor(req), id, dto));
    return pub(d);
  }

  @Post('import')
  @Roles('admin', 'manager')
  async import(@Query('commit') commit: string, @Req() req: any) {
    const file = await req.file();
    if (!file) throw new BadRequestException('Upload an .xlsx file');
    const buffer: Buffer = await file.toBuffer();
    return this.importer.run(buffer, actor(req), commit === 'true');
  }
}
