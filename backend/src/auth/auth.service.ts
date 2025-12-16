import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../shared/error-codes';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/**
 * AuthService handles credential validation and JWT issuance; duplicates are blocked to meet AR-1/AR-2.
 */
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new ConflictException({ code: ErrorCode.VERSION_CONFLICT, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({ data: { email: dto.email, displayName: dto.displayName, passwordHash } });
    return this.buildTokenResponse(user.id, user.email, user.displayName);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid credentials' });
    }
    return this.buildTokenResponse(user.id, user.email, user.displayName);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true } });
  }

  private buildTokenResponse(id: string, email: string, displayName: string) {
    const accessToken = this.jwt.sign({ sub: id, email });
    return { user: { id, email, displayName }, accessToken };
  }
}
