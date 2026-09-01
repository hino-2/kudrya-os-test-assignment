## 1. Solution overview

Three OS processes (plus PostgreSQL), all in one repo:

| Process | Port | Role |
|---|---|---|
| `apps/api` | 3000 | REST API, payment webhook, in-process job worker, sweeper, reconciliation |
| `apps/supplier-stub` (instance A) | 4001 | Supplier A stub — `/issue`, `/issue/:request_id`, control API |
| `apps/supplier-stub` (instance B) | 4002 | Supplier B stub — same image, different `SUPPLIER_ID`/port |
| `postgres` | 5432 | Single source of truth: data + job queue + ledger |

The worker runs **inside** the API process (`@nestjs/schedule` interval loop over a `jobs` table with `FOR UPDATE SKIP LOCKED`). It is horizontally safe: N API replicas can run the loop simultaneously without double-processing, because claiming is a single atomic `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`.

```mermaid
flowchart TB
    C[Client] -->|GET /catalog<br/>POST /orders<br/>GET /orders/:id| API[apps/api :3000]
    PSP[Payment stub<br/>tools/src/webhook.ts<br/>tools/src/race.ts] -->|POST /webhooks/payment<br/>at-least-once, out-of-order| API
    OPS[Operator / tests] -->|GET /reconciliation/*<br/>POST /admin/*| API

    API -->|TX: FOR UPDATE on orders<br/>INSERT payment_events ON CONFLICT<br/>INSERT jobs ON CONFLICT| DB[(PostgreSQL)]

    subgraph API_PROC [api process]
      API
      W[JobWorkerService<br/>@Interval 200ms]
      SW[SweeperService<br/>@Interval 15s]
      RC[StockReconciler<br/>@Interval 60s]
    end

    W -->|SELECT ... FOR UPDATE SKIP LOCKED| DB
    SW --> DB
    RC --> DB
    W -->|POST /issue  request_id=req_ord_X_A_1<br/>AbortSignal.timeout 2000ms| SA[supplier-stub A :4001]
    W -.->|fallback, request_id=req_ord_X_B_1| SB[supplier-stub B :4002]
    W -->|GET /issue/:request_id<br/>unknown resolution| SA
```

**Happy path (supplier-mode SKU):**

```
POST /orders {sku}                -> orders(created)          [1 TX]
POST /webhooks/payment {paid}     -> payment_events(applied)
                                     orders(created->paid)
                                     ledger_txns + 2 entries
                                     jobs(deliver_order, pending)   [1 TX, returns 200 in ~5ms]
worker claims job                 -> orders(paid->delivering)
                                     delivery_attempts(in_flight, request_id) [TX1]
                                  -> HTTP POST /issue                          [NO TX HELD]
                                  -> delivery_attempts(succeeded, code)        [TX2]
                                  -> issued_deliveries(UNIQUE order_id)
                                     orders(delivering->delivered)
                                     sku_stock--, ledger 2 entries             [TX3]
```

---

