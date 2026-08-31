import { ERROR_DEFAULT_MESSAGE, ERROR_HTTP_STATUS } from './errors.constants';
import type { ErrorCode, ErrorDetails } from './errors.type';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message?: string, details?: ErrorDetails, httpStatus?: number) {
    super(message ?? ERROR_DEFAULT_MESSAGE[code]);

    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus ?? ERROR_HTTP_STATUS[code];

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, DomainError);
    }
  }

  static isDomainError(error: unknown): error is DomainError {
    return error instanceof DomainError;
  }
}
