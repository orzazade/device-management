import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { Role, ROLES, User } from '../entities/user.entity';
import { ChangeUserRoleCommand, CreateUserCommand } from './users.commands';

class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsIn(ROLES)
  role: Role;

  @IsString()
  @MinLength(8)
  password: string;
}

class ChangeRoleDto {
  @IsIn(ROLES)
  role: Role;
}

const pub = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
});

const actor = (req: { user: AuthUser }) => ({ id: req.user.sub, name: req.user.name });

@Controller('users')
export class UsersController {
  constructor(
    private readonly db: AppDbContext,
    private readonly bus: CommandBus,
  ) {}

  @Get()
  @Roles('admin', 'manager')
  async list() {
    const users = await this.db.users().find({ order: { createdAt: 'ASC' } });
    return users.map(pub);
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@Body() dto: CreateUserDto, @Req() req: { user: AuthUser }) {
    const user: User = await this.bus.execute(new CreateUserCommand(actor(req), dto));
    return pub(user);
  }

  @Patch(':id/role')
  @Roles('admin')
  async changeRole(
    @Param('id') id: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: { user: AuthUser },
  ) {
    const user: User = await this.bus.execute(
      new ChangeUserRoleCommand(actor(req), id, dto.role),
    );
    return pub(user);
  }
}
