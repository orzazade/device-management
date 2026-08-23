import {
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { writeAudit } from '../audit/audit';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';

class ProjectDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly db: AppDbContext) {}

  @Get()
  async list(@Req() req: { user: AuthUser }, @Query('deleted') deleted?: string) {
    if (deleted === 'true' && ['admin', 'manager'].includes(req.user.role)) {
      const gone = await this.db
        .projects()
        .createQueryBuilder('p')
        .withDeleted()
        .where('p.deletedAt IS NOT NULL')
        .orderBy('p.name')
        .getMany();
      return gone.map((p) => ({ ...p, deviceCount: 0 }));
    }
    const projects = await this.db.projects().find({ order: { name: 'ASC' } });
    const counts = await this.db
      .devices()
      .createQueryBuilder('d')
      .select('d.project_id', 'projectId')
      .addSelect('COUNT(*)', 'n')
      .where('d.project_id IS NOT NULL')
      .groupBy('d.project_id')
      .getRawMany<{ projectId: string; n: string }>();
    const byId = new Map(counts.map((c) => [c.projectId, parseInt(c.n, 10)]));
    return projects.map((p) => ({ ...p, deviceCount: byId.get(p.id) ?? 0 }));
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async softDelete(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const project = await ctx.projects.findOne({ where: { id } });
      if (!project) throw new NotFoundException('Project not found');
      // Devices keep living — they just lose the project tag.
      const detached = await ctx.devices
        .createQueryBuilder()
        .update()
        .set({ projectId: null })
        .where('project_id = :id', { id })
        .execute();
      await ctx.projects.softDelete(id);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: id,
        action: 'deleted',
        oldValue: { name: project.name, devicesDetached: detached.affected ?? 0 },
      });
      return { ok: true };
    });
  }

  @Post(':id/restore')
  @Roles('admin', 'manager')
  async restore(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const project = await ctx.projects.findOne({ where: { id }, withDeleted: true });
      if (!project || !project.deletedAt) throw new NotFoundException('No deleted project with this id');
      await ctx.projects.restore(id);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: id,
        action: 'restored',
        newValue: { name: project.name },
      });
      return { ok: true };
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @Param('id') id: string,
    @Body() dto: ProjectDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.db.withTransaction(async (ctx) => {
      const project = await ctx.projects.findOne({ where: { id } });
      if (!project) throw new NotFoundException('Project not found');
      const dup = await ctx.projects.findOne({ where: { name: dto.name } });
      if (dup && dup.id !== id) throw new ConflictException(`Project "${dto.name}" already exists`);
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

  @Post()
  @Roles('admin', 'manager')
  async create(@Body() dto: ProjectDto, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const dup = await ctx.projects.findOne({ where: { name: dto.name } });
      if (dup) throw new ConflictException(`Project "${dto.name}" already exists`);
      const project = await ctx.projects.save({
        name: dto.name,
        description: dto.description ?? '',
      });
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'project',
        entityId: project.id,
        action: 'created',
        newValue: { name: project.name },
      });
      return project;
    });
  }
}
