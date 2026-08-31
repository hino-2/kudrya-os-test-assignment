import * as crypto from 'node:crypto';

import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { CorrelationStore } from './correlation.store';
import { ACCESS_LOG_SILENT_PATHS, JSON_LOGGER, LOG_EVENT, TRACE_ID_HEADER, TRACE_ID_PATTERN } from './logging.constants';
import type { JsonLogger } from './json-logger';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(
    @Inject(JSON_LOGGER) private readonly logger: JsonLogger,
    private readonly store: CorrelationStore,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(TRACE_ID_HEADER);
    const traceId = incoming !== undefined && TRACE_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();

    res.setHeader(TRACE_ID_HEADER, traceId);

    this.store.run({ trace_id: traceId }, () => {
      const startedAt = Date.now();

      res.on('finish', () => {
        const level = ACCESS_LOG_SILENT_PATHS.includes(req.path) ? 'debug' : 'info';

        this.logger.write({
          level,
          event: LOG_EVENT.HTTP_REQUEST,
          ctx: 'HttpAccess',
          duration_ms: Date.now() - startedAt,
          data: { method: req.method, path: req.originalUrl, status: res.statusCode },
        });
      });

      next();
    });
  }
}
