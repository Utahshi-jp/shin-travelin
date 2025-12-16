export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VERSION_CONFLICT = 'VERSION_CONFLICT',
  JOB_CONFLICT = 'JOB_CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export type ErrorResponse = {
  code: ErrorCode | string;
  message: string;
  details?: unknown;
  correlationId: string;
};
