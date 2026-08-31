import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppLoggerService } from '../logging/app-logger.service';
import { CorrelationStore } from '../logging/correlation.store';
import { LOG_EVENT } from '../logging/logging.constants';
import { ERROR_CODE, ERROR_DEFAULT_MESSAGE, ERROR_HTTP_STATUS, HTTP_STATUS_FALLBACK_CODE, INTERNAL_ERROR_MESSAGE } from './errors.constants';
import { DomainError } from './domain.error';
import type { IErrorBody, IErrorEnvelope, IValidationPipeResponse } from './errors.interfaces';
import type { ErrorCode } from './errors.type';

@Injectable()
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  constructor(
    private readonly store: CorrelationStore,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('DomainErrorFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const req = httpContext.getRequest<Request>();
    const res = httpContext.getResponse<Response>();
    const body = this.buildBody(exception);
    const status = this.resolveStatus(exception, body.error.code);

    this.log(body, req, exception, status);

    res.status(status).json(body);
  }

  private buildBody(exception: unknown): IErrorEnvelope {
    if (DomainError.isDomainError(exception)) {
      return this.envelope(exception.code, exception.message, exception.details);
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (this.isValidationPipeResponse(response)) {
        return this.envelope(ERROR_CODE.VALIDATION_FAILED, ERROR_DEFAULT_MESSAGE[ERROR_CODE.VALIDATION_FAILED], {
          fields: response.message,
        });
      }

      const status = exception.getStatus();
      const code = HTTP_STATUS_FALLBACK_CODE[status] ?? ERROR_CODE.INTERNAL_ERROR;

      return this.envelope(code, ERROR_DEFAULT_MESSAGE[code]);
    }

    return this.envelope(ERROR_CODE.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE);
  }

  private envelope(code: ErrorCode, message: string, details?: Record<string, unknown>): IErrorEnvelope {
    const body: IErrorBody = { code, message, trace_id: this.store.traceId() };

    if (details !== undefined) {
      body.details = details;
    }

    return { error: body };
  }

  private isValidationPipeResponse(response: unknown): response is IValidationPipeResponse {
    return (
      typeof response === 'object' &&
      response !== null &&
      Array.isArray((response as { message?: unknown }).message) &&
      (response as { message: unknown[] }).message.every((item) => typeof item === 'string')
    );
  }

  private statusFor(code: ErrorCode): number {
    return ERROR_HTTP_STATUS[code];
  }

  private resolveStatus(exception: unknown, code: ErrorCode): number {
    if (DomainError.isDomainError(exception)) {
      return exception.httpStatus;
    }

    if (exception instanceof HttpException && !this.isValidationPipeResponse(exception.getResponse())) {
      return exception.getStatus();
    }

    return this.statusFor(code);
  }

  private log(body: IErrorEnvelope, req: Request, exception: unknown, status: number): void {
    const data = { status, code: body.error.code, method: req.method, path: req.originalUrl };

    if (status >= 500) {
      this.logger.error(LOG_EVENT.HTTP_ERROR, exception, data);

      return;
    }

    this.logger.event(LOG_EVENT.HTTP_ERROR, data, 'warn');
  }
}
