import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode, ErrorResponse } from './error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const correlationId: string = request.correlationId ?? 'unknown';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const payload: ErrorResponse = {
        code: (res as any)?.code ?? this.mapStatusToCode(status),
        message: (res as any)?.message ?? exception.message,
        details: (res as any)?.details,
        correlationId,
      };
      this.logger.warn({ correlationId, status, code: payload.code, message: payload.message });
      response.status(status).json(payload);
      return;
    }

    const payload: ErrorResponse = {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Unexpected error occurred',
      details: undefined,
      correlationId,
    };
    this.logger.error({ correlationId, error: exception });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(payload);
  }

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        // Why: ValidationPipe は 422 を返すため、要件の共通エラーコード VALIDATION_ERROR に正規化する。
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.VERSION_CONFLICT;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
