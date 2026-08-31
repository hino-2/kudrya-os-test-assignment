import type { SUPPORTED_CURRENCIES } from './money.constants';

export type MinorAmount = number;

export type MajorAmount = number;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];
