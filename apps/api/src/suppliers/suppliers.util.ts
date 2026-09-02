import {
  HTTP_STATUS_CLIENT_ERROR_MIN,
  HTTP_STATUS_SERVER_ERROR_MIN,
  SUPPLIER_ERROR_KIND,
  SUPPLIER_GENERATION_MARKER,
  SUPPLIER_ORDER_EXT_PREFIX,
  SUPPLIER_OUTCOME,
  SUPPLIER_OUT_OF_STOCK_REASON,
  SUPPLIER_REFUSED_CODES,
  SUPPLIER_REQUEST_ID_PREFIX,
  SUPPLIER_REQUEST_ID_SEPARATOR,
  SUPPLIER_RESET_CODES,
  SUPPLIER_TIMEOUT_ERROR_NAMES,
  UNKNOWN_SUPPLIER_CODE_MESSAGE_TEMPLATE,
} from './suppliers.constants';
import type {
  IHttpStatusClassification,
  INetworkErrorClassification,
  ISupplierIssueErrorBody,
  ISupplierIssueSuccessBody,
} from './suppliers.interfaces';
import type { SupplierCode } from './suppliers.type';

function formatTemplate(template: string, ...values: readonly unknown[]): string {
  let index = 0;

  return template.replace(/%s/g, () => String(values[index++]));
}

export function buildSupplierRequestId(
  extId: string,
  generation: number,
  supplierCode: SupplierCode,
  attemptNo: number,
): string {
  const shortExtId = extId.startsWith(SUPPLIER_ORDER_EXT_PREFIX)
    ? extId.slice(SUPPLIER_ORDER_EXT_PREFIX.length)
    : extId;

  return [
    `${SUPPLIER_REQUEST_ID_PREFIX}${shortExtId}`,
    `${SUPPLIER_GENERATION_MARKER}${generation}`,
    `${supplierCode}${attemptNo}`,
  ].join(SUPPLIER_REQUEST_ID_SEPARATOR);
}

export function isSupplierSuccessBody(
  body: unknown,
): body is ISupplierIssueSuccessBody & { code: string } {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const candidate = body as ISupplierIssueSuccessBody;

  return typeof candidate.code === 'string' && candidate.code.length > 0;
}

export function extractSupplierCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const candidate = body as ISupplierIssueSuccessBody;

  return typeof candidate.code === 'string' && candidate.code.length > 0 ? candidate.code : null;
}

export function extractSupplierReason(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const candidate = body as ISupplierIssueErrorBody;

  return typeof candidate.reason === 'string' && candidate.reason.length > 0 ? candidate.reason : null;
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === 'string' ? code : null;
}

export function classifySupplierNetworkError(error: unknown): INetworkErrorClassification {
  const name = error instanceof Error ? error.name : null;

  if (name !== null && (SUPPLIER_TIMEOUT_ERROR_NAMES as readonly string[]).includes(name)) {
    return { kind: SUPPLIER_OUTCOME.UNKNOWN, errorKind: SUPPLIER_ERROR_KIND.TIMEOUT };
  }

  // undici wraps low-level socket errors into a TypeError; the actual errno lives one level
  // down on `.cause` — only one level is unwrapped, per the blueprint's contract.
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : null;
  const code = readErrorCode(error) ?? readErrorCode(cause);

  if (code !== null && (SUPPLIER_REFUSED_CODES as readonly string[]).includes(code)) {
    return { kind: SUPPLIER_OUTCOME.UNAVAILABLE, errorKind: SUPPLIER_ERROR_KIND.CONNECTION_REFUSED };
  }

  if (code !== null && (SUPPLIER_RESET_CODES as readonly string[]).includes(code)) {
    return { kind: SUPPLIER_OUTCOME.UNKNOWN, errorKind: SUPPLIER_ERROR_KIND.CONNECTION_RESET };
  }

  // неопознанная сетевая ошибка: неизвестно, ушёл ли запрос на сторону поставщика —
  // безопасный вариант по умолчанию всегда unknown, а не unavailable, чтобы не спровоцировать
  // повторную выдачу поверх уже принятого поставщиком запроса
  return { kind: SUPPLIER_OUTCOME.UNKNOWN, errorKind: SUPPLIER_ERROR_KIND.CONNECTION_RESET };
}

export function classifySupplierHttpStatus(status: number, body: unknown): IHttpStatusClassification {
  const reason = extractSupplierReason(body);

  if (reason === SUPPLIER_OUT_OF_STOCK_REASON) {
    return { kind: SUPPLIER_OUTCOME.OUT_OF_STOCK, errorKind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK, reason };
  }

  if (status >= HTTP_STATUS_SERVER_ERROR_MIN) {
    return { kind: SUPPLIER_OUTCOME.UNAVAILABLE, errorKind: SUPPLIER_ERROR_KIND.HTTP_5XX, reason };
  }

  if (status >= HTTP_STATUS_CLIENT_ERROR_MIN) {
    return { kind: SUPPLIER_OUTCOME.REJECTED, errorKind: SUPPLIER_ERROR_KIND.HTTP_4XX, reason };
  }

  return { kind: SUPPLIER_OUTCOME.UNKNOWN, errorKind: SUPPLIER_ERROR_KIND.BAD_BODY, reason };
}

export function buildUnknownSupplierCodeMessage(code: string): string {
  return formatTemplate(UNKNOWN_SUPPLIER_CODE_MESSAGE_TEMPLATE, code);
}
