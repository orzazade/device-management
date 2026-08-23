import { Body, Controller, ConflictException, Get, Post, Req } from '@nestjs/common';
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
  async list() {
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
