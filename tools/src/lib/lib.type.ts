import type { CHECK_STATUS, CHECK_VERDICT, HTTP_METHOD } from './lib.constants';

export type ArgValue = string | boolean;

export type CheckStatus = (typeof CHECK_STATUS)[keyof typeof CHECK_STATUS];

export type CheckVerdict = (typeof CHECK_VERDICT)[keyof typeof CHECK_VERDICT];

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];
