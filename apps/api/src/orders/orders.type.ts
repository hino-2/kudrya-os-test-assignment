import type { ORDER_STATUS } from './orders.constants';

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
