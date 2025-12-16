import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const correlationId: string = req.correlationId ?? 'unknown';
    const userId: string | undefined = req.user?.id;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const latencyMs = Date.now() - start;
        const res = context.switchToHttp().getResponse();
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
