export const ADMIN_TOKEN_HEADER = 'x-admin-token';

export const ADMIN_ROUTE = 'admin';

export const ADMIN_SWEEPER_RUN_ROUTE = 'sweeper/run';

export const ADMIN_RESTOCK_ROUTE = 'products/:sku/restock';

export const ADMIN_REDELIVER_ROUTE = 'orders/:orderId/redeliver';

export const RESTOCK_COUNT_MIN = 1;

export const RESTOCK_COUNT_MAX = 10000;

export const REDELIVER_REASON_MAX_LENGTH = 500;

export const ADMIN_SWEEPER_RUN_STATUS = 200;

export const ADMIN_RESTOCK_STATUS = 200;

export const ADMIN_REDELIVER_STATUS = 202;

export const RESTOCK_BODY_INVALID_MESSAGE = 'Тело запроса должно содержать ровно одно из полей: codes или count';

export const RESTOCK_SUPPLIER_CODES_UNSUPPORTED_MESSAGE =
  'Явные коды недопустимы для товара с fulfillment_mode=supplier';
