import type { ArgValue, CheckStatus, HttpMethod } from './lib.type';

export interface IParsedArgs {
  [key: string]: ArgValue;
}

export interface IHttpResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  error: string | null;
}

export interface IHttpRequestOptions {
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ICheckRow {
  name: string;
  status: CheckStatus;
  detail: string;
}
