import type { ERROR_CODE } from './errors.constants';

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export type ErrorDetails = Readonly<Record<string, unknown>>;
