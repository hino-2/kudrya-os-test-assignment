import { DEFAULT_HTTP_TIMEOUT_MS, HTTP_METHOD, HTTP_REQUEST_FAILED_MESSAGE, HTTP_RESPONSE_NOT_JSON_MESSAGE } from './lib.constants';
import type { IHttpRequestOptions, IHttpResult } from './lib.interfaces';

// Никогда не бросает и не реджектит промис — CLI-скрипты сами решают, что делать с сетевой
// ошибкой (для race.ts транспортный сбой одного из 50 конкурентных вызовов — тоже результат,
// который должен попасть в сводную таблицу, а не оборвать весь прогон необработанным исключением.
export async function httpRequest<T>(url: string, options: IHttpRequestOptions): Promise<IHttpResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: `${HTTP_REQUEST_FAILED_MESSAGE}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const text = await response.text();

  if (text.length === 0) {
    return { ok: response.ok, status: response.status, body: null, error: null };
  }

  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(text) as T, error: null };
  } catch {
    return { ok: response.ok, status: response.status, body: null, error: `${HTTP_RESPONSE_NOT_JSON_MESSAGE}: ${url}` };
  }
}

export function httpGet<T>(url: string, timeoutMs?: number): Promise<IHttpResult<T>> {
  return httpRequest<T>(url, { method: HTTP_METHOD.GET, timeoutMs });
}

export function httpPost<T>(url: string, body: unknown, timeoutMs?: number): Promise<IHttpResult<T>> {
  return httpRequest<T>(url, { method: HTTP_METHOD.POST, body, timeoutMs });
}
