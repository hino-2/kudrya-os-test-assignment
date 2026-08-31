import type { STOCK_KEY_STATUS } from './inventory.constants';

export type StockKeyStatus = (typeof STOCK_KEY_STATUS)[keyof typeof STOCK_KEY_STATUS];
