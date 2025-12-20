import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

type CorrelatedRequest = Request & { correlationId?: string };

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      req.headers['x-correlation-id']?.toString() ?? randomUUID();
    (req as CorrelatedRequest).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
