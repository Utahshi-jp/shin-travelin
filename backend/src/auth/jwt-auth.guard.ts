import { AuthGuard } from '@nestjs/passport';
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from '../shared/error-codes';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './current-user.decorator';

/**
 * JWT guard protecting all non-auth routes (requirements ER-2).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: unknown,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Authentication failed',
      });
    }

    if (!this.isAuthenticatedUser(user)) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid authentication payload',
      });
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = user;
    return user as TUser;
  }

  private isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<AuthenticatedUser>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.email === 'string' &&
      typeof candidate.displayName === 'string'
    );
  }
}
