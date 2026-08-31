import { ERROR_CODE } from '../errors/errors.constants';
import { DomainError } from '../errors/domain.error';
import { MINOR_UNITS_PER_MAJOR, SUPPORTED_CURRENCIES } from './money.constants';
import type { CurrencyCode, MajorAmount, MinorAmount } from './money.type';

export function assertInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new DomainError(ERROR_CODE.VALIDATION_FAILED, 'Ожидалось целое число', { field, value });
  }

  return value;
}

export function toMinor(major: MajorAmount, field = 'amount'): MinorAmount {
  const safeMajor = assertInt(major, field);
  const minor = safeMajor * MINOR_UNITS_PER_MAJOR;

  return assertInt(minor, field);
}

export function toMajor(minor: MinorAmount, field = 'amount_minor'): MajorAmount {
  const safeMinor = assertInt(minor, field);

  return safeMinor / MINOR_UNITS_PER_MAJOR;
}

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
