import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { writeAudit } from '../audit/audit';
import { AuthUser, RequirePermission } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';

class ProjectDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['project', 'squad'])
  kind?: 'project' | 'squad';
}

const word = (k?: string) => (k === 'squad' ? 'Squad' : 'Project');

@Controller('projects')
export class ProjectsController {
  constructor(private readonly db: AppDbContext) {}

  /** kind: 'project' (default — existing callers), 'squad', or 'all'. */
  @RequirePermission('projects.view')
  @Get()
  async list(
    @Req() req: { user: AuthUser },
    @Query('deleted') deleted?: string,
    @Query('kind') kind?: string,
  ) {
    if (deleted === 'true' && !req.user.permissions.has('projects.viewDeleted')) {
      throw new ForbiddenException('You cannot list deleted projects');
    }
    const kinds = kind === 'all' ? ['project', 'squad'] : [kind === 'squad' ? 'squad' : 'project'];
    if (deleted === 'true') {
      const gone = await this.db
        .projects()
        .createQueryBuilder('p')
        .withDeleted()
        .where('p.deletedAt IS NOT NULL')
        .andWhere('p.kind IN (:...kinds)', { kinds })
        .orderBy('p.name')
        .getMany();
      // Deleted projects have no attached devices by definition (delete
      // detaches them) — report null so the UI shows '—', not a fake 0.
      return gone.map((p) => ({ ...p, deviceCount: null }));
    }
    const projects = await this.db
      .projects()
      .find({ where: kinds.map((k) => ({ kind: k as 'project' | 'squad' })), order: { name: 'ASC' } });
    const count = async (col: 'project_id' | 'squad_id') => {
      const rows = await this.db
        .devices()
        .createQueryBuilder('d')
        .select(`d.${col}`, 'gid')
        .addSelect('COUNT(*)', 'n')
        .where(`d.${col} IS NOT NULL`)
        .groupBy(`d.${col}`)
        .getRawMany<{ gid: string; n: string }>();
      return new Map(rows.map((c) => [c.gid, parseInt(c.n, 10)]));
    };
    const byProject = await count('project_id');
    const bySquad = await count('squad_id');
    return projects.map((p) => ({
      ...p,
      deviceCount: (p.kind === 'squad' ? bySquad : byProject).get(p.id) ?? 0,
    }));
  }

  @RequirePermission('projects.delete')
  @Delete(':id')
  async softDelete(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const project = await ctx.projects.findOne({ where: { id } });
      if (!project) throw new NotFoundException('Project not found');
      // Devices keep living — they just lose the project tag. The ids go
      // into the audit row so restore can put them back.
      const col = project.kind === 'squad' ? 'squad_id' : 'project_id';
      const detachedRows: { id: string }[] = await ctx.devices
        .createQueryBuilder()
        .update()
        .set(project.kind === 'squad' ? { squadId: null } : { projectId: null })
        .where(`${col} = :id`, { id })
        .returning('id')
        .execute()
        .then((r) => r.raw);
      await ctx.projects.softDelete(id);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: id,
        action: 'deleted',
        oldValue: {
          name: project.name,
          kind: project.kind,
          devicesDetached: detachedRows.length,
          detachedDeviceIds: detachedRows.map((d) => d.id),
        },
      });
      return { ok: true };
    });
  }

  @RequirePermission('projects.restore')
  @Post(':id/restore')
  async restore(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const project = await ctx.projects.findOne({ where: { id }, withDeleted: true });
      if (!project || !project.deletedAt) throw new NotFoundException('No deleted project with this id');
      await ctx.projects.restore(id);
      // Re-attach the devices the delete detached — but only those that
      // haven't been given to another project in the meantime.
      const deleteRow = await ctx.auditLogs.findOne({
        where: { entityType: 'project', entityId: id, action: 'deleted' },
        order: { id: 'DESC' },
      });
      const detachedIds =
        ((deleteRow?.oldValue as { detachedDeviceIds?: string[] })?.detachedDeviceIds ?? []);
      let reattached = 0;
      if (detachedIds.length) {
        const col = project.kind === 'squad' ? 'squad_id' : 'project_id';
        const res = await ctx.devices
          .createQueryBuilder()
          .update()
          .set(project.kind === 'squad' ? { squadId: id } : { projectId: id })
          .where(`id IN (:...ids) AND ${col} IS NULL AND deleted_at IS NULL`, {
            ids: detachedIds,
          })
          .execute();
        reattached = res.affected ?? 0;
      }
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: id,
        action: 'restored',
        newValue: { name: project.name, devicesReattached: reattached },
      });
      return { ok: true, reattached };
    });
  }

  @RequirePermission('projects.update')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: ProjectDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.db.withTransaction(async (ctx) => {
      const project = await ctx.projects.findOne({ where: { id } });
      if (!project) throw new NotFoundException('Project not found');
      const dup = await ctx.projects
        .createQueryBuilder('p')
        .where('LOWER(p.name) = LOWER(:name) AND p.kind = :kind', {
          name: dto.name,
          kind: project.kind,
        })
        .getOne();
      if (dup && dup.id !== id)
        throw new ConflictException(`${word(project.kind)} "${dto.name}" already exists`);
      const before = { name: project.name, description: project.description };
      project.name = dto.name;
      project.description = dto.description ?? '';
      await ctx.projects.save(project);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: project.id,
        action: 'updated',
        oldValue: before,
        newValue: { name: project.name, description: project.description },
      });
      return project;
    });
  }

  @RequirePermission('projects.create')
  @Post()
  async create(@Body() dto: ProjectDto, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const kind = dto.kind ?? 'project';
      const dup = await ctx.projects
        .createQueryBuilder('p')
        .where('LOWER(p.name) = LOWER(:name) AND p.kind = :kind', { name: dto.name, kind })
        .getOne();
      if (dup) throw new ConflictException(`${word(kind)} "${dto.name}" already exists`);
      const project = await ctx.projects.save({
        name: dto.name,
        description: dto.description ?? '',
        kind,
      });
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: project.id,
        action: 'created',
        newValue: { name: project.name, kind: project.kind },
      });
      return project;
    });
  }
}
