import {
  JOB_DEDUPE_ORDER_PREFIX,
  JOB_DUPLICATE_HANDLER_MESSAGE_TEMPLATE,
  JOB_LAST_ERROR_MAX_LENGTH,
  JOB_MISSING_HANDLER_MESSAGE_TEMPLATE,
  JOB_UNKNOWN_ERROR_MESSAGE,
} from './jobs.constants';
import type { IBackoffOptions, IJobRetryHint } from './jobs.interfaces';

function formatTemplate(template: string, ...values: readonly unknown[]): string {
  let index = 0;

  return template.replace(/%s/g, () => String(values[index++]));
}

export function buildDeliverOrderDedupeKey(extId: string): string {
  return `${JOB_DEDUPE_ORDER_PREFIX}${extId}`;
}

export function buildMissingHandlerMessage(kind: string): string {
  return formatTemplate(JOB_MISSING_HANDLER_MESSAGE_TEMPLATE, kind);
}

export function buildDuplicateHandlerMessage(kind: string): string {
  return formatTemplate(JOB_DUPLICATE_HANDLER_MESSAGE_TEMPLATE, kind);
}

export function buildJobErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.length > 0 ? message : JOB_UNKNOWN_ERROR_MESSAGE;

  return text.slice(0, JOB_LAST_ERROR_MAX_LENGTH);
}

function isBackoffOptions(value: unknown): value is IBackoffOptions {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as IBackoffOptions;

  return typeof candidate.baseMs === 'number' && typeof candidate.maxMs === 'number';
}

// позволяет ошибке домена (например, исчерпанному supplier-циклу) явно подсказать
// воркеру собственный интервал повторной попытки вместо стандартного backoff'а джобы
export function readJobBackoffHint(error: unknown): IBackoffOptions | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = (error as Partial<IJobRetryHint>).retryBackoff;

  return isBackoffOptions(candidate) ? candidate : null;
}
