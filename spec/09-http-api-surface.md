## 9. HTTP API surface

**Validation: `class-validator` + `class-transformer` behind a global `ValidationPipe`** — confirmed, and counted in the dependency budget (§13). Configuration:

```ts
new ValidationPipe({
  whitelist: true,              // strip unknown fields
  forbidNonWhitelisted: true,   // ...except on the webhook (see below)
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  stopAtFirstError: false,
})
```

The webhook DTO is the one exception: it uses a controller-scoped pipe with `forbidNonWhitelisted: false`, because a payment provider adding a field to its payload must not turn into a 400 storm.

Rejected alternative: hand-rolled validators — for ~9 endpoints they would cost more code than the two dependencies, and would lose the declarative DTO shape that doubles as documentation.

**Unified error envelope** (`common/errors/domain-error.filter.ts`):

```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Товар не найден",
    "details": { "sku": "NOPE" },
    "trace_id": "5c1f3f6e-..."
  }
}
```

`ERROR_CODE` (`errors.constants.ts`): `VALIDATION_FAILED`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`, `ORDER_NOT_FOUND`, `ORDER_ALREADY_EXISTS`, `ILLEGAL_TRANSITION`, `ORDER_ALREADY_DELIVERED`, `ORDER_NOT_RECOVERABLE`, `LEDGER_UNBALANCED`, `UNAUTHORIZED`, `ADMIN_DISABLED`, `INTERNAL_ERROR`.

### 9.1 Health

| | |
|---|---|
| `GET /health` | `200 {"status":"ok","service":"api","version":"1.0.0","uptime_s":123}`. No DB access — liveness only. |
| `GET /health/ready` | `200 {"status":"ok","db":"ok","worker":"running","ledger":"balanced"}` or `503 {"status":"degraded",...}`. Runs `SELECT 1`, checks the worker heartbeat and the cached ledger-balance flag. |

### 9.2 Catalog

**`GET /catalog`**

| Field | Rules |
|---|---|
| `type` | optional, `@IsIn(['key','topup','subscription','giftcard'])` |
| `in_stock` | optional, `@IsBooleanString()`, default `true` |
| `limit` | optional int, `@Min(1) @Max(100)`, default 24 |
| `cursor` | optional, `@Matches(CURSOR_REGEX)` (base64url) |
| `q` | optional, `@Length(1,64) @Matches(/^[A-Za-z0-9_-]+$/)` — SKU prefix |

`200`:
```json
{ "items": [ { "sku":"STEAM-TOPUP-500","name":"Пополнение Steam 500 ₽","type":"topup",
               "amount_minor":50000,"amount":500,"currency":"RUB",
               "image":"assets/steam.png","available_count":1000,"in_stock":true } ],
  "next_cursor": "U1RFQU0t...", "has_more": true, "limit": 24 }
```
Errors: `400 VALIDATION_FAILED`.

**`GET /catalog/:sku`** — `sku` `@Matches(/^[A-Za-z0-9._-]{1,64}$/)`. `200` one item; `404 PRODUCT_NOT_FOUND`.

### 9.3 Orders

**`POST /orders`**

| Field | Rules |
|---|---|
| `sku` | required, `@IsString() @Matches(/^[A-Za-z0-9._-]{1,64}$/)` |
| `client_order_id` | optional, `@Matches(/^ord_(?!\d+$)[A-Za-z0-9_-]{1,40}$/)` — becomes `ext_id`, doubles as the idempotency key; must not fall inside the `order_ext_seq` namespace (all-digit suffix) |
| `quantity` | optional, `@IsInt() @Equals(1)`, default 1 |
| `buyer_email` | optional, `@IsEmail() @MaxLength(254)` |

`201` (new) / `200` (idempotent replay of the same `client_order_id`, byte-identical body):
```json
{ "order_id":"ord_00123","status":"created","sku":"STEAM-TOPUP-500",
  "quantity":1,"amount_minor":50000,"amount":500,"currency":"RUB",
  "created_at":"2026-08-31T10:00:00.000Z" }
```
Errors: `400 VALIDATION_FAILED`; `404 PRODUCT_NOT_FOUND`; `409 PRODUCT_INACTIVE`.
Side effect: any `orphan` payment events for that `ext_id` are drained **in the same transaction** (§5.3).

An order is created regardless of stock. Stock is checked at delivery time, because the assignment's `out_of_stock` status is explicitly *post-payment* (`paid → delivering → out_of_stock`). Refusing at creation would make criterion 6 untestable.

**`GET /orders/:orderId`** — `orderId` matches `EXT_ID_REGEX`. `200`:

```json
{ "order_id":"ord_00123","status":"delivered","recoverable":false,"terminal":true,
  "sku":"STEAM-TOPUP-500","quantity":1,"amount_minor":50000,"amount":500,"currency":"RUB",
  "created_at":"...","paid_at":"...","delivered_at":"...","failure_reason":null,
  "delivery": { "code":"A7X1-B2C3-D4CD","source":"supplier","supplier":"A","delivered_at":"..." },
  "payment_events":[{"event_id":"evt_1","status":"paid","state":"applied","occurred_at":"...","received_at":"..."}],
  "delivery_attempts":[{"supplier":"A","attempt_no":1,"request_id":"req_ord_00123_A_1",
                        "state":"succeeded","error_kind":null,"duration_ms":412}] }
```

`delivery` is `null` until delivered. `recoverable` is `true` for `out_of_stock`/`delivery_failed`. `payment_events` is capped at the 20 most recent (so the criterion-1 order with 50 events stays readable; the full set is asserted via SQL in tests). **The full code appears only here**, never in a log. Errors: `404 ORDER_NOT_FOUND`.

### 9.4 Payment webhook

**`POST /webhooks/payment`** — no signature check (explicitly excluded by the requirements; noted in README §9).

| Field | Rules |
|---|---|
| `event_id` | required, `@IsString() @Length(1,128)` |
| `order_id` | required, `@Matches(EXT_ID_REGEX)` |
| `status` | required, `@IsIn(['paid','failed'])` |
| `amount` | required, `@IsInt() @Min(0)` — **major units** (§3.1) |
| `currency` | required, `@IsIn(['RUB'])` |
| `created_at` | required, `@IsISO8601()` |

`200` always for every business outcome:
```json
{ "accepted": true, "result": "applied", "order_status": "paid", "event_id": "evt_a1b2c3" }
```
`result` ∈ `applied | duplicate | orphan | ignored_stale | ignored_already_paid | ignored_terminal | conflict | rejected_amount`.

Status-code policy — this table goes verbatim into README §5.2:

| Situation | Status | Why |
|---|---|---|
| Any business outcome, incl. duplicate/orphan/conflict | `200` | Accepted and durably recorded; a retry would change nothing |
| Malformed body (schema violation) | `400` | Retrying will not fix a bad payload; the PSP should alert instead of loop |
| Unexpected internal error (DB down, bug) | `500` | The contract says `5xx` triggers redelivery — exactly what we want when we failed to persist |

The controller is deliberately thin: parse → enrich correlation → one service call → map the result. Nothing that can throw for a business reason lives in it.

### 9.5 Reconciliation

As tabulated in §7.2. All `GET`, all `200`, guarded by `AdminTokenGuard` when `ADMIN_TOKEN` is set; `401 UNAUTHORIZED` otherwise.

### 9.6 Admin / recovery

All under `/admin`, all require `x-admin-token: $ADMIN_TOKEN`, all return `403 ADMIN_DISABLED` when `ADMIN_API_ENABLED=false`.

| Endpoint | Body | Behaviour | Codes |
|---|---|---|---|
| `POST /admin/products/:sku/restock` | `{ "codes": ["A-B-C"] }` **or** `{ "count": 25 }` (`@IsInt() @Min(1) @Max(10000)`) | pool: insert `stock_keys`, bump `sku_stock`, set `in_stock`. supplier: set `available_count`, call the stub's `/_control/restock`. One transaction. | `200 {added, available_count}`; `404`; `400` |
| `POST /admin/orders/:orderId/redeliver` | `{ "reason": "..." }` optional | `ADMIN_REDELIVER`: only from `out_of_stock`/`delivery_failed`; `delivery_generation += 1`; enqueue. **Refuses if `issued_deliveries` already has a row.** | `202 {enqueued:true, generation}`; `409 ORDER_ALREADY_DELIVERED`; `409 ORDER_NOT_RECOVERABLE` |
| `POST /admin/orders/:orderId/force-paid` | `{ "event_id": "evt_x" }` — the conflicting event to resolve | `ADMIN_FORCE_PAID` from `payment_failed`; posts `payment_captured`; enqueues delivery; marks the event resolved. WARN log. | `202`; `409 ILLEGAL_TRANSITION` |
| `POST /admin/orders/:orderId/refund` | `{ "reason": "..." }` | Posts `payment_refunded` for an order stuck in `out_of_stock`. Order status unchanged (audit-only). | `200`; `409` |
| `POST /admin/jobs/drain` | `{ "max_cycles": 20 }` optional | Runs the worker loop synchronously until the queue is empty or `max_cycles` is reached. **Demo/test convenience only.** | `200 {cycles, processed}` |
| `POST /admin/sweeper/run` | — | One sweeper cycle, synchronously; returns per-pass counts. | `200` |
| `POST /admin/reconcile/stock` | — | One drift-repair pass; returns repaired rows. | `200 {repaired}` |

**Guard:** `AdminTokenGuard` — constant-time compare (`crypto.timingSafeEqual`) of header `x-admin-token` against `ADMIN_TOKEN`.

---

