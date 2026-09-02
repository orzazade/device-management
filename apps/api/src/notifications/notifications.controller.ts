import {
  BadRequestException,
  Body,
  ConflictException,
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
  @IsIn(['all', 'busy_only', 'holder'])
  mode: 'all' | 'busy_only' | 'holder';
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
    const res = await this.db
      .notifications()
      .update({ id, userId: req.user.sub, readAt: IsNull() }, { readAt: new Date() });
    if (!res.affected) {
      const mine = await this.db.notifications().findOne({ where: { id, userId: req.user.sub } });
      if (!mine) throw new NotFoundException('Not your notification');
    }
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

  /** The outbox Settings promises: staff can SEE queued/failed mail. */
  @Get('email-outbox')
  @Roles('admin', 'manager')
  async emailOutbox() {
    const rows = await this.db.emailOutbox().find({
      order: { id: 'DESC' },
      take: 100,
    });
    const counts = { pending: 0, sent: 0, failed: 0 };
    for (const r of await this.db.emailOutbox().find()) {
      counts[r.state as keyof typeof counts] =
        (counts[r.state as keyof typeof counts] ?? 0) + 1;
    }
    return { counts, rows };
  }

  @Post('email-outbox/:id/retry')
  @Roles('admin', 'manager')
  async retryEmail(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const mail = await ctx.emailOutbox.findOne({ where: { id } });
      if (!mail) throw new NotFoundException('Outbox entry not found');
      if (mail.state === 'sent') {
        throw new ConflictException('This email was already sent');
      }
      await ctx.emailOutbox.update(mail.id, {
        state: 'pending',
        attempts: 0,
        nextAttemptAt: null,
      });
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'email',
        entityId: mail.id,
        action: 'retry_queued',
        newValue: { to: mail.toEmail, subject: mail.subject },
      });
      return { ok: true };
    });
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
