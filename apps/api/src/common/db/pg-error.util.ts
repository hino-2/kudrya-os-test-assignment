import { PG_ERROR_CODE, RETRYABLE_TX_ERROR_CODES } from './db.constants';
import type { IPgError } from './db.interfaces';

function extractPgError(error: unknown): IPgError | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const driverError = (error as { driverError?: unknown }).driverError;
  const candidate = typeof driverError === 'object' && driverError !== null ? driverError : error;

  if (typeof candidate !== 'object' || candidate === null || !('code' in candidate)) {
    return undefined;
  }

  return candidate as IPgError;
}

export function isPgError(error: unknown): error is IPgError {
  return extractPgError(error) !== undefined;
}

export function pgErrorCode(error: unknown): string | undefined {
  return extractPgError(error)?.code;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = extractPgError(error);

  if (pgError?.code !== PG_ERROR_CODE.UNIQUE_VIOLATION) {
    return false;
  }

  return constraint === undefined || pgError.constraint === constraint;
}

export function isRetryableTxError(error: unknown): boolean {
  const code = pgErrorCode(error);

  return code !== undefined && (RETRYABLE_TX_ERROR_CODES as readonly string[]).includes(code);
}

export function isLockTimeout(error: unknown): boolean {
  return pgErrorCode(error) === PG_ERROR_CODE.LOCK_NOT_AVAILABLE;
}
