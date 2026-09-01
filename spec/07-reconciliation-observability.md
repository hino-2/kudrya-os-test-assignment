## 7. Reconciliation, observability, recovery (stage 4)

### 7.1 Structured logging

**Decision: NestJS's built-in `LoggerService` with a custom `JsonLogger`, ~70 lines, zero dependencies.** Rejected: `pino` + `nestjs-pino` — buys throughput and serializers we do not need at this scale, and costs three production dependencies plus a transport decision, against a strict dependency policy. The requirement is "структурированные логи", which is a JSON shape, not a library.

**Exact record shape** — one JSON object per line on stdout:

```json
{
  "ts": "2026-08-31T10:00:00.123Z",
  "level": "info",
  "event": "delivery.completed",
  "ctx": "SupplierFulfilmentService",
  "trace_id": "5c1f3f6e-6b8a-4f2b-9b0e-1f9d2c3a4b5c",
  "order_id": "ord_00123",
  "event_id": null,
  "request_id": "req_ord_00123_A_1",
  "job_id": 4711,
  "duration_ms": 412,
  "data": { "supplier": "A", "source": "supplier", "attempt_no": 1, "code_masked": "A7X1-****-**CD" },
  "msg": "delivery.completed"
}
```

- `msg` duplicates `event` so that a plain `docker logs` tail stays readable without `jq`.
- `err` is added only for `error`/`warn`: `{ "err": { "name": "...", "message": "...", "stack": "..." } }` (stack only when `LOG_STACK=true`).
- **Codes are never logged in full.** `maskCode('A7X1-B2C3-D4CD')` → `A7X1-****-**CD` (`logging/logging.constants.ts`). Full codes exist only in the DB and in the `GET /orders/:id` response.
- `LOG_FORMAT=pretty` switches to a single human line for local development; `json` in Docker and CI.

**Correlation strategy** — `AsyncLocalStorage` (`node:async_hooks`, built-in), no library:

| Field | Source |
|---|---|
| `trace_id` | `CorrelationMiddleware`: `x-request-id` header if present, else `crypto.randomUUID()`. Echoed back in the `x-request-id` response header. Worker jobs start a fresh store with `trace_id` taken from `jobs.trace_id` (persisted at enqueue), so **the webhook's trace id follows the delivery all the way to the supplier call.** |
| `order_id` | `orders.ext_id`, set when an order enters scope |
| `event_id` | webhook `event_id`, set in the webhook handler |
| `request_id` | `delivery_attempts.request_id`, set around the supplier call |
| `job_id` | `jobs.id`, set by the worker |

`AppLoggerService` API (`common/logging/app-logger.service.ts`):

```ts
event(name: LogEventName, data?: Readonly<Record<string, unknown>>, level?: LogLevel): void;
withCorrelation<T>(patch: Partial<ICorrelation>, fn: () => Promise<T>): Promise<T>;
timed<T>(name: LogEventName, data: Readonly<Record<string, unknown>>, fn: () => Promise<T>): Promise<T>;
```

`timed` measures `duration_ms` and emits `<name>` on success / `<name>.failed` at `error` on throw. `withCorrelation` is the only way to enrich the store — no ambient mutation.

**Event catalogue** (`LOG_EVENT` in `logging.constants.ts`) with fixed levels:

| Level | Events |
|---|---|
| `info` | `order.created`, `payment.received`, `payment.applied`, `delivery.enqueued`, `delivery.started`, `delivery.attempt.created`, `delivery.attempt.succeeded`, `delivery.completed`, `delivery.out_of_stock`, `job.claimed`, `job.succeeded`, `ledger.txn_posted`, `sweeper.cycle`, `reconcile.cycle` |
| `warn` | `payment.duplicate`, `payment.orphan`, `payment.ignored_stale`, `payment.ignored_terminal`, `delivery.attempt.timeout`, `delivery.attempt.unknown`, `delivery.attempt.resolving`, `delivery.fallback`, `job.retry_scheduled`, `sweeper.requeued`, `reconcile.drift_repaired`, `db.serialization_retry`, `stub.scenario_forced` |
| `error` | `payment.conflict`, `payment.amount_mismatch`, `delivery.failed`, `delivery.stranded_issuance`, `job.dead`, `ledger.imbalance_detected`, `attempt.inflight_expired` |
| `debug` | `supplier.request`, `supplier.response`, `catalog.query` |

Rule for developers: **every `payment.*` and `delivery.*` path emits exactly one terminal event.** A code path that can end without a log line is a defect. This is what the assignment means by "структурированные логи по платежам и выдаче".

### 7.2 Reconciliation endpoints

Base path `/reconciliation`. All read-only, all `GET`, all admin-token-guarded when `ADMIN_TOKEN` is set.

| Endpoint | Query params | Returns |
|---|---|---|
| `GET /reconciliation/paid-not-delivered` | `older_than_seconds` (int, default 60), `limit` (1..500, default 100) | `{ count, items: [{ order_id, status, total_minor, paid_at, age_seconds, has_open_job, last_attempt_state }] }` |
| `GET /reconciliation/delivered-not-paid` | `limit` | `{ count, items: [{ order_id, status, code_masked, delivered_at, cash_debit_minor }] }` |
| `GET /reconciliation/ledger-balance` | — | `{ balanced: bool, global_imbalance_minor, per_currency: [...], unbalanced_txns: [{txn_id, imbalance_minor}] }` |
| `GET /reconciliation/stock-drift` | `limit` | `{ count, items: [{ sku, counter_available, actual_available, delta }] }` |
| `GET /reconciliation/stranded-issuances` | `limit` | `{ count, items: [{ order_id, supplier, request_id, resolve_attempts, updated_at }] }` |
| `GET /reconciliation/payment-conflicts` | `limit` | `{ count, items: [{ event_id, order_id, status, ignore_reason, received_at }] }` |
| `GET /reconciliation/summary` | — | one object aggregating the counts of all of the above + `{ orphan_events, abandoned_events, dead_jobs, stuck_delivering, amount_mismatches, generated_at }` |

**«Оплачен, но не выдан»** — the exact SQL:

```sql
SELECT o.ext_id AS order_id, o.status, o.total_minor, o.paid_at,
       EXTRACT(EPOCH FROM (now() - o.paid_at))::int AS age_seconds,
       EXISTS (SELECT 1 FROM jobs j
               WHERE j.kind = 'deliver_order' AND j.dedupe_key = 'order:' || o.ext_id
                 AND j.state IN ('pending','running'))            AS has_open_job,
       (SELECT da.state FROM delivery_attempts da
        WHERE da.order_id = o.id ORDER BY da.id DESC LIMIT 1)      AS last_attempt_state
FROM orders o
LEFT JOIN issued_deliveries d ON d.order_id = o.id
WHERE o.paid_at IS NOT NULL
  AND d.id IS NULL
  AND o.status <> 'delivered'
  AND o.status <> 'payment_failed'
  AND o.paid_at < now() - make_interval(secs => $1)
ORDER BY o.paid_at
LIMIT $2;
```

Served by `idx_orders_paid_undelivered` (partial on exactly this predicate), with an anti-join on `issued_deliveries_order_uq`.

**«Выдан, но не оплачен»** — the exact SQL. Two independent notions of "not paid" are checked, because either one alone can be fooled:

```sql
SELECT o.ext_id AS order_id, o.status, d.code, d.delivered_at,
       COALESCE(cash.debit_minor, 0) AS cash_debit_minor
FROM issued_deliveries d
JOIN orders o ON o.id = d.order_id
LEFT JOIN LATERAL (
  SELECT SUM(le.signed_minor) AS debit_minor
  FROM ledger_entries le
  WHERE le.order_id = o.id AND le.account = 'cash'
) cash ON TRUE
WHERE o.paid_at IS NULL
   OR COALESCE(cash.debit_minor, 0) <> o.total_minor
ORDER BY d.delivered_at DESC
LIMIT $1;
```

`o.paid_at IS NULL` catches a delivery that bypassed payment entirely; the ledger comparison catches a delivery whose money was never actually captured (or captured for the wrong amount). In a healthy system both clauses return zero rows — that is asserted in `reconciliation.e2e.spec.ts`.

**Stock drift:**

```sql
SELECT p.sku, s.available_count AS counter_available,
       COALESCE(a.cnt, 0) AS actual_available,
       s.available_count - COALESCE(a.cnt, 0) AS delta
FROM sku_stock s
JOIN products p ON p.id = s.product_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS cnt FROM stock_keys k
  WHERE k.product_id = s.product_id AND k.status = 'available'
) a ON TRUE
WHERE p.fulfillment_mode = 'pool'
  AND s.available_count <> COALESCE(a.cnt, 0)
ORDER BY abs(s.available_count - COALESCE(a.cnt, 0)) DESC
LIMIT $1;
```

### 7.3 The stuck-order sweeper

`reconciliation/sweeper.service.ts`, `@Interval(SWEEPER_INTERVAL_MS)` (default 15 000), guarded by `SWEEPER_ENABLED` and a re-entrancy flag. Six passes per cycle, each in its own short transaction, each capped at `SWEEPER_BATCH_SIZE` (100):

| # | Selects | Threshold | Action |
|---|---|---|---|
| 1 | `jobs` where `state='running' AND locked_at < now() - JOB_LOCK_TTL_MS` | 120 s | → `pending`, `run_at = now()`, `last_error='reclaimed_stale_lock'`. Recovers from a worker crash. |
| 2 | `orders` where `paid_at IS NOT NULL AND status IN ('paid','delivering')`, no `issued_deliveries` row, no live `deliver_order` job, `updated_at < now() - STUCK_ORDER_AGE_SECONDS` | 60 s | enqueue `deliver_order` (`ON CONFLICT DO NOTHING`), WARN `sweeper.requeued` |
| 3 | `orders` where `status='out_of_stock'` and `sku_stock.available_count > 0` for its product | immediate | `RETRY_DELIVERY`, `delivery_generation += 1`, enqueue |
| 4 | `orders` where `status='delivery_failed' AND updated_at < now() - DELIVERY_FAILED_RETRY_SECONDS` and `delivery_generation < MAX_DELIVERY_GENERATIONS` | 300 s / 5 gens | `RETRY_DELIVERY`, enqueue |
| 5 | `delivery_attempts` where `state='unknown' AND next_resolve_at <= now()`; plus `state='in_flight' AND started_at < now() - ATTEMPT_INFLIGHT_TIMEOUT_MS` demoted to `unknown` first | 30 s | enqueue `resolve_unknown_attempt` (`dedupe_key = 'attempt:' || id`) |
| 6 | `payment_events` where `state='orphan'` and an order with that `ext_id` now exists → replay; `state='orphan' AND received_at < now() - ORPHAN_TTL_SECONDS` → `abandoned` | 3600 s | replay / abandon, WARN |

**Why it is safe to run concurrently with the main flow — four reasons, in order of strength:**

1. Every enqueue is `ON CONFLICT (kind, dedupe_key) WHERE state IN ('pending','running') DO NOTHING` — the sweeper can never create a second live job for an order that already has one.
2. Every handler re-validates under `SELECT ... FROM orders ... FOR UPDATE` and re-runs `resolveTransition`; a sweeper-originated job that arrives after the order was already delivered gets `kind: 'noop'` and exits.
3. `delivery_attempts_open_uq` prevents a sweeper-triggered delivery from opening a second concurrent supplier call while one is in flight.
4. `issued_deliveries_order_uq` makes a second delivery fact impossible even if 1–3 all failed.

Pass 2 deliberately requires `updated_at` age **and** the absence of a live job, so it can never race a delivery that is legitimately mid-flight.

### 7.4 The money ledger that always balances

Model as specified in §3.10: **double-entry**, `ledger_txns` (idempotency) + `ledger_entries` (legs), `signed_minor` as a stored generated column so the balance check is a plain `SUM` and cannot be skewed by application-side sign logic.

Rejected alternative: single-entry with signed amounts — "balances" only tautologically, and cannot express where money came from or went; the assignment's phrasing only carries meaning under double-entry.

**Posting API** — the only way entries are ever written:

```ts
// ledger/ledger.service.ts
postTxn(qr: QueryRunner, input: IPostTxnInput): Promise<string | null>;
// IPostTxnInput = { kind: LedgerTxnKind; idempotencyKey: string; orderId: number | null; legs: readonly ILedgerLeg[] }
// returns txn_id, or null when the idempotency key already existed (a genuine no-op)
```

`postTxn` asserts before writing: at least two legs; `SUM(signed) === 0`; single currency; every `amount_minor > 0`. Violation throws `DomainError(LEDGER_UNBALANCED)` and aborts the enclosing transaction — an unbalanced posting can never reach the database.

Writers: only three call sites, all inside an already-open transaction — `PaymentWebhookService` (`payment_captured`), `DeliveryService` finalisation (`delivery_recognized`), `AdminService` (`payment_refunded`).

**The invariant queries** (`GET /reconciliation/ledger-balance`, and asserted in `ledger-balance.e2e.spec.ts`):

```sql
-- 1. every transaction balances — MUST return 0 rows
SELECT txn_id, SUM(signed_minor) AS imbalance_minor
FROM ledger_entries
GROUP BY txn_id
HAVING SUM(signed_minor) <> 0;

-- 2. the whole book balances per currency — MUST return 0 for every currency
SELECT currency, SUM(signed_minor) AS imbalance_minor
FROM ledger_entries
GROUP BY currency;

-- 3. every delivered order has exactly one capture and one recognition — MUST return 0 rows
SELECT o.ext_id,
       COALESCE(SUM(le.signed_minor) FILTER (WHERE le.account = 'cash'), 0)                AS cash_minor,
       COALESCE(-SUM(le.signed_minor) FILTER (WHERE le.account = 'revenue'), 0)            AS revenue_minor,
       COALESCE(SUM(le.signed_minor) FILTER (WHERE le.account = 'customer_prepayment'), 0) AS prepayment_minor
FROM orders o
LEFT JOIN ledger_entries le ON le.order_id = o.id
WHERE o.status = 'delivered'
GROUP BY o.ext_id, o.total_minor
HAVING COALESCE(SUM(le.signed_minor) FILTER (WHERE le.account = 'cash'), 0) <> o.total_minor
    OR COALESCE(-SUM(le.signed_minor) FILTER (WHERE le.account = 'revenue'), 0) <> o.total_minor
    OR COALESCE(SUM(le.signed_minor) FILTER (WHERE le.account = 'customer_prepayment'), 0) <> 0;

-- 4. undelivered-but-paid money sits in the liability account — a positive number, not an error
SELECT -SUM(signed_minor) AS owed_to_customers_minor
FROM ledger_entries WHERE account = 'customer_prepayment';
```

Query 4 is the economically meaningful one: after the criterion-6 test, `owed_to_customers_minor` equals the total of orders sitting in `out_of_stock` — the ledger *explains* the anomaly rather than merely surviving it.

If query 1 or 2 ever returns a row, `StockReconcilerService` emits `ledger.imbalance_detected` at ERROR and `/health/ready` reports degraded.

---

