import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { IsNull } from 'typeorm';
import { writeAudit } from '../audit/audit';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { NotificationRule } from '../entities/notification.entity';

class RulePatchDto {
  @IsOptional()
  @IsBoolean()
  inapp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

class ApprovalModeDto {
  @IsIn(['all', 'busy_only'])
  mode: 'all' | 'busy_only';
}

@Controller()
export class NotificationsController {
  constructor(private readonly db: AppDbContext) {}

  @Get('notifications')
  async list(@Req() req: { user: AuthUser }) {
    const [items, unread] = await Promise.all([
      this.db.notifications().find({
        where: { userId: req.user.sub },
        order: { id: 'DESC' },
        take: 30,
      }),
      this.db.notifications().count({ where: { userId: req.user.sub, readAt: IsNull() } }),
    ]);
    return { items, unread };
  }

  @Post('notifications/:id/read')
  async readOne(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    // Scoped to the caller: nobody can mark someone else's notification.
    await this.db
      .notifications()
      .update({ id, userId: req.user.sub, readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  }

  @Post('notifications/read-all')
  async readAll(@Req() req: { user: AuthUser }) {
    await this.db
      .notifications()
      .update({ userId: req.user.sub, readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  }

  @Get('notification-rules')
  @Roles('admin', 'manager')
  async rules() {
    return this.db.notificationRules().find({ order: { event: 'ASC' } });
  }

  @Patch('notification-rules/:event')
  @Roles('admin', 'manager')
  async patchRule(
    @Param('event') event: string,
    @Body() dto: RulePatchDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.db.withTransaction(async (ctx) => {
      const rule = await ctx.manager
        .getRepository(NotificationRule)
        .findOne({ where: { event } });
      if (!rule) throw new NotFoundException(`Unknown event "${event}"`);
      const old = { inapp: rule.inapp, email: rule.email };
      if (dto.inapp !== undefined) rule.inapp = dto.inapp;
      if (dto.email !== undefined) rule.email = dto.email;
      await ctx.manager.save(rule);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'notification_rule',
        entityId: event,
        action: 'updated',
        oldValue: old,
        newValue: { inapp: rule.inapp, email: rule.email },
      });
      return rule;
    });
  }

  @Get('settings')
  @Roles('admin', 'manager')
  async settings() {
    const mode = await this.db.settings().findOne({ where: { key: 'approval_mode' } });
    return { approvalMode: mode?.value ?? 'all' };
  }

  @Patch('settings/approval-mode')
  @Roles('admin')
  async setApprovalMode(@Body() dto: ApprovalModeDto, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const setting = await ctx.settings.findOne({ where: { key: 'approval_mode' } });
      if (!setting) throw new BadRequestException('approval_mode setting is missing');
      const old = setting.value;
      setting.value = dto.mode;
      await ctx.settings.save(setting);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'setting',
        entityId: 'approval_mode',
        action: 'changed',
        oldValue: { mode: old },
        newValue: { mode: dto.mode },
      });
      return { approvalMode: setting.value };
    });
  }
}
