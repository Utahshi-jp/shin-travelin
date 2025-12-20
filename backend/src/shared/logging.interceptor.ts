import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

type RequestWithContext = Request & {
  correlationId?: string;
  user?: { id?: string };
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<RequestWithContext>();
    const res = httpContext.getResponse<Response>();
    const correlationId: string = req.correlationId ?? 'unknown';
    const userId: string | undefined = req.user?.id;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const latencyMs = Date.now() - start;
        this.logger.log({
          method: req.method,
          path: req.url,
          status: res.statusCode,
          latencyMs,
          correlationId,
          userId,
        });
      }),
    );
  }
}
