import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode } from '../shared/error-codes';

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/**
 * Extracts authenticated user from request injected by JwtStrategy.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user) return request.user;
    throw new UnauthorizedException({
      code: ErrorCode.UNAUTHORIZED,
      message: 'Missing authenticated user context',
    });
  },
);
