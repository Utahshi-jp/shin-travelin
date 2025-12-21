import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, ErrorResponse } from './error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const correlationId: string = request.correlationId ?? 'unknown';

    if (exception instanceof HttpException) {
      const status = exception.getStatus() as HttpStatus;
      const rawResponse = exception.getResponse();
      const responseBody = this.asErrorBody(rawResponse);
      const payload: ErrorResponse = {
        code: responseBody?.code ?? this.mapStatusToCode(status),
        message:
          this.extractMessage(responseBody) ??
          (typeof rawResponse === 'string' ? rawResponse : exception.message),
        details: responseBody?.details,
        correlationId,
      };
      this.logger.warn({
        correlationId,
        status,
        code: payload.code,
        message: payload.message,
      });
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

  private asErrorBody(
    input: unknown,
  ): (Partial<ErrorResponse> & { message?: string | string[] }) | null {
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      return input as Partial<ErrorResponse> & { message?: string | string[] };
    }
    return null;
  }

  private extractMessage(
    body: (Partial<ErrorResponse> & { message?: string | string[] }) | null,
  ): string | undefined {
    if (!body) return undefined;
    const { message } = body;
    if (typeof message === 'string' && message.trim().length) {
      return message;
    }
    if (Array.isArray(message) && message.length) {
      return message.map((value) => String(value)).join('; ');
    }
    return undefined;
  }

  private mapStatusToCode(status: HttpStatus): ErrorCode {
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
