import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AuthUser, Roles } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { Role, ROLES, User } from '../entities/user.entity';
import {
  ChangeUserRoleCommand,
  CreateUserCommand,
  UpdateUserCommand,
} from './users.commands';

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

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  newPassword?: string;
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

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { user: AuthUser },
  ) {
    // Deactivating or resetting passwords is the Admin's call alone.
    if ((dto.active !== undefined || dto.newPassword) && req.user.role !== 'admin') {
      dto.active = undefined;
      dto.newPassword = undefined;
    }
    const user: User = await this.bus.execute(new UpdateUserCommand(actor(req), id, dto));
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
