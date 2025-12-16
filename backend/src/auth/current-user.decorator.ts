import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts authenticated user from request injected by JwtStrategy.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
