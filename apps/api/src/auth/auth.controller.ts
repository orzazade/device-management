import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthUser, Public } from './auth.guard';
import { IDENTITY_PROVIDER, IdentityProvider } from './identity-provider';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.identity.verify(dto.email, dto.password);
    if (!user) throw new UnauthorizedException('Wrong email or password');
    const payload: AuthUser = {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  @Get('me')
  me(@Req() req: { user: AuthUser }) {
    const { sub, name, email, role } = req.user;
    return { id: sub, name, email, role };
  }
}
