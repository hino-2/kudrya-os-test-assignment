import type { CHECK_STATUS, HTTP_METHOD } from './lib.constants';

export type ArgValue = string | boolean;

export type CheckStatus = (typeof CHECK_STATUS)[keyof typeof CHECK_STATUS];

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];
