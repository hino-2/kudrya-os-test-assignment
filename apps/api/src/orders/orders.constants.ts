import type { OrderEvent, OrderStatus, TransitionResult } from './orders.type';

export const ORDER_STATUS = {
  CREATED: 'created',
  PAID: 'paid',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  PAYMENT_FAILED: 'payment_failed',
  OUT_OF_STOCK: 'out_of_stock',
  DELIVERY_FAILED: 'delivery_failed',
} as const;

export const ORDER_EVENT = {
  PAYMENT_PAID: 'PAYMENT_PAID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  DELIVERY_STARTED: 'DELIVERY_STARTED',
  DELIVERY_SUCCEEDED: 'DELIVERY_SUCCEEDED',
  DELIVERY_OUT_OF_STOCK: 'DELIVERY_OUT_OF_STOCK',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETRY_DELIVERY: 'RETRY_DELIVERY',
  ADMIN_FORCE_PAID: 'ADMIN_FORCE_PAID',
  ADMIN_REDELIVER: 'ADMIN_REDELIVER',
} as const;

export const TRANSITION_KIND = {
  APPLY: 'apply',
  NOOP: 'noop',
  CONFLICT: 'conflict',
} as const;

export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);

export const ORDER_EVENT_VALUES = Object.values(ORDER_EVENT);

export const TERMINAL_ORDER_STATUSES = [
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.PAYMENT_FAILED,
] as const;

export const RECOVERABLE_ORDER_STATUSES = [
  ORDER_STATUS.OUT_OF_STOCK,
  ORDER_STATUS.DELIVERY_FAILED,
] as const;

// Отсутствие ячейки означает illegal: resolveTransition бросает ILLEGAL_TRANSITION (409).
export const TRANSITION_TABLE: Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderEvent, TransitionResult>>>>
> = {
  [ORDER_STATUS.CREATED]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.PAID },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.PAYMENT_FAILED },
  },
  [ORDER_STATUS.PAID]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.CONFLICT },
    [ORDER_EVENT.DELIVERY_STARTED]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.DELIVERING },
    [ORDER_EVENT.DELIVERY_OUT_OF_STOCK]: {
      kind: TRANSITION_KIND.APPLY,
      to: ORDER_STATUS.OUT_OF_STOCK,
    },
    [ORDER_EVENT.DELIVERY_FAILED]: {
      kind: TRANSITION_KIND.APPLY,
      to: ORDER_STATUS.DELIVERY_FAILED,
    },
  },
  [ORDER_STATUS.DELIVERING]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.CONFLICT },
    [ORDER_EVENT.DELIVERY_STARTED]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.DELIVERY_SUCCEEDED]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.DELIVERED },
    [ORDER_EVENT.DELIVERY_OUT_OF_STOCK]: {
      kind: TRANSITION_KIND.APPLY,
      to: ORDER_STATUS.OUT_OF_STOCK,
    },
    [ORDER_EVENT.DELIVERY_FAILED]: {
      kind: TRANSITION_KIND.APPLY,
      to: ORDER_STATUS.DELIVERY_FAILED,
    },
  },
  [ORDER_STATUS.DELIVERED]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.CONFLICT },
    [ORDER_EVENT.DELIVERY_STARTED]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.DELIVERY_SUCCEEDED]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.DELIVERY_OUT_OF_STOCK]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.DELIVERY_FAILED]: { kind: TRANSITION_KIND.NOOP },
  },
  [ORDER_STATUS.PAYMENT_FAILED]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.CONFLICT },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.ADMIN_FORCE_PAID]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.PAID },
  },
  [ORDER_STATUS.OUT_OF_STOCK]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.CONFLICT },
    [ORDER_EVENT.DELIVERY_OUT_OF_STOCK]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.RETRY_DELIVERY]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.DELIVERING },
    [ORDER_EVENT.ADMIN_REDELIVER]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.DELIVERING },
  },
  [ORDER_STATUS.DELIVERY_FAILED]: {
    [ORDER_EVENT.PAYMENT_PAID]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.PAYMENT_FAILED]: { kind: TRANSITION_KIND.CONFLICT },
    [ORDER_EVENT.DELIVERY_FAILED]: { kind: TRANSITION_KIND.NOOP },
    [ORDER_EVENT.RETRY_DELIVERY]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.DELIVERING },
    [ORDER_EVENT.ADMIN_REDELIVER]: { kind: TRANSITION_KIND.APPLY, to: ORDER_STATUS.DELIVERING },
  },
};

export const ORDERS_ROUTE = 'orders';

export const ORDER_ID_ROUTE = ':orderId';

export const EXT_ID_REGEX = /^ord_[A-Za-z0-9_-]{1,40}$/;

export const MINTED_EXT_ID_REGEX = /^ord_\d+$/;

// Клиентский идентификатор не должен попадать в пространство order_ext_seq: иначе занятый
// заранее ord_00100 подменил бы собой следующий анонимный заказ.
export const CLIENT_EXT_ID_REGEX = /^ord_(?!\d+$)[A-Za-z0-9_-]{1,40}$/;

export const ORDER_DEFAULT_QUANTITY = 1;

export const BUYER_EMAIL_MAX_LENGTH = 254;

export const ORDER_CREATED_STATUS = 201;

export const ORDER_REPLAY_STATUS = 200;

export const ORDER_PAYMENT_EVENTS_LIMIT = 20;

export const ORDER_REPLAY_LOST_MESSAGE = 'Заказ не найден после конфликта вставки';

export const ORDER_EXT_ID_LOST_MESSAGE = 'Последовательность order_ext_seq не вернула значение';

export const ORDER_EXT_ID_TAKEN_MESSAGE = 'Сгенерированный идентификатор заказа уже занят';

export const ORDER_TRANSACTION_REQUIRED_MESSAGE = 'Операция требует открытой транзакции';

export const ORDER_NEXT_EXT_ID_SQL = `
  SELECT 'ord_' || lpad(nextval('order_ext_seq')::text, 5, '0') AS ext_id
`;

export const ORDER_PRODUCT_SNAPSHOT_SQL = `
  SELECT id, sku, type, price_minor, currency, fulfillment_mode, is_active
  FROM products
  WHERE sku = $1
`;

export const ORDER_INSERT_SQL = `
  INSERT INTO orders (ext_id, product_id, sku, quantity, unit_price_minor, total_minor, currency, buyer_email)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (ext_id) DO NOTHING
  RETURNING *
`;

export const ORDER_SELECT_BY_EXT_ID_SQL = `
  SELECT * FROM orders WHERE ext_id = $1
`;

export const ORDER_LOCK_BY_EXT_ID_SQL = `
  SELECT * FROM orders WHERE ext_id = $1 FOR UPDATE
`;

export const ORDER_TRANSITION_SQL = `
  UPDATE orders
  SET status = $3, updated_at = now(),
      paid_at = COALESCE($4, paid_at),
      delivering_at = COALESCE($5, delivering_at),
      delivered_at = COALESCE($6, delivered_at),
      failure_reason = $7,
      delivery_generation = COALESCE($8, delivery_generation),
      last_payment_event_id = COALESCE($9, last_payment_event_id),
      last_payment_event_at = COALESCE($10, last_payment_event_at)
  WHERE id = $1 AND status = $2
  RETURNING *
`;

export const ORDER_DELIVERY_SQL = `
  SELECT code, source, supplier_code, delivered_at
  FROM issued_deliveries
  WHERE order_id = $1
`;

export const ORDER_PAYMENT_EVENTS_SQL = `
  SELECT event_id, status, state, occurred_at, received_at
  FROM payment_events
  WHERE order_id = $1
  ORDER BY occurred_at DESC
  LIMIT $2
`;

export const ORDER_DELIVERY_ATTEMPTS_SQL = `
  SELECT supplier_code, attempt_no, request_id, state, error_kind, duration_ms
  FROM delivery_attempts
  WHERE order_id = $1
  ORDER BY id
`;

// sweeper pass 2 (§7.3): paid/delivering дольше stuckOrderAgeSeconds, без issued_deliveries и
// без живой deliver_order job — не бьёт по заказу, реально ещё в полёте (см. README §4.3)
export const ORDER_FIND_STUCK_PAID_DELIVERING_SQL = `
  SELECT o.id, o.ext_id, o.delivery_generation
  FROM orders o
  WHERE o.paid_at IS NOT NULL
    AND o.status IN ('paid','delivering')
    AND o.updated_at < now() - ($1 || ' seconds')::interval
    AND NOT EXISTS (SELECT 1 FROM issued_deliveries d WHERE d.order_id = o.id)
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.kind = 'deliver_order' AND j.dedupe_key = 'order:' || o.ext_id AND j.state IN ('pending','running')
    )
  ORDER BY o.updated_at
  FOR UPDATE OF o SKIP LOCKED
  LIMIT $2
`;

// sweeper pass 3: out_of_stock с восполненным остатком — немедленный повтор
export const ORDER_FIND_RETRYABLE_OUT_OF_STOCK_SQL = `
  SELECT o.id, o.ext_id, o.status, o.delivery_generation
  FROM orders o
  JOIN sku_stock s ON s.product_id = o.product_id
  WHERE o.status = 'out_of_stock' AND s.available_count > 0
  ORDER BY o.updated_at
  FOR UPDATE OF o SKIP LOCKED
  LIMIT $1
`;

// sweeper pass 4: delivery_failed старше deliveryFailedRetrySeconds, под потолком поколений
export const ORDER_FIND_RETRYABLE_DELIVERY_FAILED_SQL = `
  SELECT o.id, o.ext_id, o.status, o.delivery_generation
  FROM orders o
  WHERE o.status = 'delivery_failed'
    AND o.updated_at < now() - ($1 || ' seconds')::interval
    AND o.delivery_generation < $2
  ORDER BY o.updated_at
  FOR UPDATE OF o SKIP LOCKED
  LIMIT $3
`;
