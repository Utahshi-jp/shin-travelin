import { AuthGuard } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

/**
 * JWT guard protecting all non-auth routes (requirements ER-2).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
