## 4. Order state machine

### 4.1 Enum values

`orders.status` — `ORDER_STATUS` in `orders/orders.constants.ts`:

```
created | paid | delivering | delivered | payment_failed | out_of_stock | delivery_failed
```

- **Terminal:** `delivered`, `payment_failed`.
- **Recoverable (non-terminal, no automatic progress without an external stimulus):** `out_of_stock`, `delivery_failed`.
- **In-flight:** `created`, `paid`, `delivering`.

`ORDER_EVENT`:

```
PAYMENT_PAID | PAYMENT_FAILED | DELIVERY_STARTED | DELIVERY_SUCCEEDED
| DELIVERY_OUT_OF_STOCK | DELIVERY_FAILED | RETRY_DELIVERY
| ADMIN_FORCE_PAID | ADMIN_REDELIVER
```

### 4.2 Transition table

`TRANSITION_TABLE: Readonly<Record<OrderStatus, Readonly<Partial<Record<OrderEvent, ITransitionRule>>>>>` in `orders.constants.ts`. Result kinds: `apply` (change status), `noop` (idempotent, allowed, no write), `conflict` (allowed at HTTP level but recorded and reported), `illegal` (throws `DomainError(ILLEGAL_TRANSITION)` — a programming bug).

| from | event | to | kind | notes |
|---|---|---|---|---|
| `created` | `PAYMENT_PAID` | `paid` | apply | sets `paid_at`; posts `payment_captured`; enqueues `deliver_order` |
| `created` | `PAYMENT_FAILED` | `payment_failed` | apply | terminal, no ledger entries |
| `created` | `DELIVERY_*` | — | illegal | delivery cannot start before payment |
| `paid` | `PAYMENT_PAID` | — | noop | duplicate/secondary paid event |
| `paid` | `PAYMENT_FAILED` | — | conflict | `payment_events.state='conflict'`, ERROR log, reconciliation report |
| `paid` | `DELIVERY_STARTED` | `delivering` | apply | sets `delivering_at` |
| `paid` | `DELIVERY_OUT_OF_STOCK` | `out_of_stock` | apply | defensive; normal path passes through `delivering` |
| `paid` | `DELIVERY_FAILED` | `delivery_failed` | apply | defensive |
| `delivering` | `PAYMENT_PAID` | — | noop | |
| `delivering` | `PAYMENT_FAILED` | — | conflict | |
| `delivering` | `DELIVERY_STARTED` | — | noop | job retry re-entering |
| `delivering` | `DELIVERY_SUCCEEDED` | `delivered` | apply | terminal; sets `delivered_at`; posts `delivery_recognized` |
| `delivering` | `DELIVERY_OUT_OF_STOCK` | `out_of_stock` | apply | recoverable; sets `failure_reason='out_of_stock'` |
| `delivering` | `DELIVERY_FAILED` | `delivery_failed` | apply | recoverable; `failure_reason` = last supplier error |
| `delivered` | `PAYMENT_PAID` | — | noop | criterion 1/2 |
| `delivered` | `PAYMENT_FAILED` | — | conflict | goods already handed over |
| `delivered` | `DELIVERY_*` | — | noop | criterion 4/5 idempotency |
| `payment_failed` | `PAYMENT_PAID` | — | conflict | terminal by spec; needs `ADMIN_FORCE_PAID` |
| `payment_failed` | `PAYMENT_FAILED` | — | noop | |
| `payment_failed` | `ADMIN_FORCE_PAID` | `paid` | apply | the only escape hatch, admin-guarded, WARN-logged |
| `payment_failed` | `DELIVERY_*` | — | illegal | |
| `out_of_stock` | `RETRY_DELIVERY` / `ADMIN_REDELIVER` | `delivering` | apply | `delivery_generation += 1` |
| `out_of_stock` | `PAYMENT_PAID` | — | noop | |
| `out_of_stock` | `PAYMENT_FAILED` | — | conflict | |
| `out_of_stock` | `DELIVERY_OUT_OF_STOCK` | — | noop | retry found stock still empty |
| `delivery_failed` | `RETRY_DELIVERY` / `ADMIN_REDELIVER` | `delivering` | apply | `delivery_generation += 1` |
| `delivery_failed` | `DELIVERY_FAILED` | — | noop | |
| `delivery_failed` | `PAYMENT_PAID` | — | noop | |
| any | unlisted event | — | illegal | |

### 4.3 Where transitions are enforced

**Exactly one place.** `orders/order-state-machine.ts`:

```ts
export function resolveTransition(from: OrderStatus, event: OrderEvent): ITransitionResult;
// ITransitionResult = { kind: 'apply'; to: OrderStatus } | { kind: 'noop' } | { kind: 'conflict' } — 'illegal' throws
```

and **exactly one writer**, `orders/orders.repository.ts`:

```ts
async transition(
  qr: QueryRunner,
  orderId: number,
  from: OrderStatus,
  to: OrderStatus,
  patch: Partial<IOrderMutablePatch>,
): Promise<IOrderRow | null>;
```

implemented as a compare-and-swap:

```sql
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
RETURNING *;
```

Returning zero rows means another transaction moved the order first — the caller re-reads and re-resolves instead of overwriting. Every status write in the codebase goes through this method; **no service may issue `UPDATE orders SET status = ...` directly** (enforced by review and by keeping the SQL string in `orders.constants.ts`).

---

