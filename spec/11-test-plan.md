## 11. Test plan

**Runner: Vitest + `unplugin-swc`** (`@swc/core`) — NestJS DI requires `emitDecoratorMetadata`, which esbuild cannot emit and SWC can. Two Vitest projects in `apps/api/vitest.config.ts`:

| Project | Include | Env | Concurrency |
|---|---|---|---|
| `unit` | `test/unit/**/*.spec.ts` | none | parallel |
| `integration` | `test/integration/**/*.e2e.spec.ts` | real PostgreSQL from `docker compose` (`DATABASE_URL` required) | `singleThread: true`, `fileParallelism: false`, `testTimeout: 30000` |

Integration tests run **serially** and share one database. Rejected alternative: testcontainers — excluded by the stack decision, and `docker compose up -d postgres` plus a CI service container is simpler and faster.

**Harness** (`test/helpers/`):

- `pg.helper.ts` — `resetDatabase(ds)`: `TRUNCATE issued_deliveries, delivery_attempts, ledger_entries, ledger_txns, payment_events, jobs, stock_keys, sku_stock, orders, products RESTART IDENTITY CASCADE;` plus `ALTER SEQUENCE order_ext_seq RESTART 100`. Called in `beforeEach`. Rejected alternative: transactional rollback per test — impossible here, because the concurrency tests need *committed* rows visible to 50 separate connections.
- `app.harness.ts` — `startApi(overrides)`: boots the Nest app with env overrides, `app.listen(0)`, returns `{ baseUrl, dataSource, stop() }`. Default test overrides: `JOB_POLL_INTERVAL_MS=25`, `SWEEPER_INTERVAL_MS=250`, `SUPPLIER_REQUEST_TIMEOUT_MS=500`, `STUCK_ORDER_AGE_SECONDS=1`.
- `supplier-stub.harness.ts` — `startStubs()`: boots two stub apps on port 0 in-process, returns `{ a: {baseUrl, control}, b: {...}, stop() }`. **Real HTTP over loopback, so timeouts are real network timeouts** — the only thing shared with the API is the OS. `apps/api` declares `@store/supplier-stub` as a `devDependency` for this.
- `seed.helper.ts` — loads `stock/products.json` and `stock/keys.json`, assigns `fulfillment_mode`, distributes the 50 keys 20/20/10 across the three `key` SKUs, initialises `sku_stock`/`in_stock`.
- `wait-for.ts` — `waitFor(predicate, {timeoutMs=10000, intervalMs=25})`; throws with the last observed value on timeout so failures are diagnosable.

CI runs the API and both stubs **in-process**, so no external process management is needed.

### 11.1 Criterion 1 — 50 concurrent `paid` webhooks

**File:** `apps/api/test/integration/webhook-race.e2e.spec.ts`

Setup: reset DB, seed, start stubs with all rates `0`, start API with `WORKER_ENABLED=true`, `JOB_POLL_INTERVAL_MS=25`. `POST /orders {sku:'STEAM-TOPUP-500', client_order_id:'ord_race_1'}`. Build 50 payloads with distinct `event_id` (`evt_race_${i}`), identical `order_id`, `status:'paid'`, `amount:500`, `currency:'RUB'`, and **distinct `created_at`** shuffled around a base instant (so the staleness guard is exercised, not bypassed).

Fire: `await Promise.all(payloads.map(p => fetch(baseUrl + '/webhooks/payment', {method:'POST', ...})))`.

Assertions:
1. All 50 responses are `200`; **exactly one** has `result === 'applied'`; the other 49 are `ignored_already_paid` or `ignored_stale`.
2. `SELECT count(*) FROM payment_events WHERE order_ext_id='ord_race_1'` = **50**.
3. `SELECT count(*) FROM payment_events WHERE order_ext_id='ord_race_1' AND state='applied'` = **1**.
4. `SELECT count(*) FROM jobs WHERE kind='deliver_order' AND dedupe_key='order:ord_race_1'` = **1**.
5. `await waitFor(() => order.status === 'delivered')`.
6. `SELECT count(*) FROM issued_deliveries WHERE order_id=$1` = **1**. ← the headline assertion.
7. `SELECT count(*) FROM delivery_attempts WHERE order_id=$1` = **1**.
8. Stub A `GET /_control/state`: exactly one record for `order_id='ord_race_1'`.
9. `SELECT count(*) FROM ledger_txns WHERE order_id=$1` = **2** (`payment_captured` + `delivery_recognized`), 4 entries, `SUM(signed_minor)=0` globally, `HAVING SUM(signed_minor)<>0` returns zero rows. Cash was debited **once** (`50000`), not 50 times.
10. Same test, second `describe` block for a `pool` SKU (`KEY-CS2-PRIME`): additionally `SELECT count(*) FROM stock_keys WHERE order_id=$1` = **1**, and `sku_stock.available_count` dropped by exactly 1.

The whole scenario runs 5 times in a loop with a fresh order each iteration, so a lucky interleaving cannot hide a bug.

**Why this is a valid race test:** 50 real TCP connections to a real listening server, 50 real PostgreSQL backends, 50 distinct `event_id`s so the cheap dedupe cannot mask the bug, distinct `created_at` so the staleness guard is genuinely exercised, and assertions made on **committed database state** rather than on response bodies. `Promise.all` dispatches all 50 before the first completes; the contention point (`SELECT ... FOR UPDATE` on one `orders` row) is provably reached concurrently — the test additionally asserts `max(processed_at) - min(processed_at) > 0` to confirm queuing actually occurred rather than accidental serialisation. In-process concurrency is valid here because the contention point is a **PostgreSQL row lock**, which is process-agnostic: 50 sockets from one client process contend identically to 50 from fifty.

`tools/src/race.ts` performs the same run from a **separate OS process** against `docker compose` (`npm run race -- --order ord_00123 --count 50`) and prints a PASS/FAIL table. It is the README §3 repro; the Vitest file is the CI gate. Both matter: the external script proves it across process boundaries; the in-process test makes it a regression gate.

### 11.2 Criterion 2 — repeated `event_id`

**File:** `webhook-idempotency.e2e.spec.ts`

Setup: order `ord_idem_1`. Send `evt_idem_1` (`paid`) once; wait for `delivered`. Snapshot: row counts of all ten tables, `orders.updated_at`, `issued_deliveries.code`, `SUM(signed_minor)`, `sku_stock.available_count`.

Send the **byte-identical** payload 10 more times, sequentially and then 10 more via `Promise.all`.

Assertions: every response `200` with `result === 'duplicate'`; every snapshotted value **unchanged**, including `orders.updated_at` (proving no write occurred at all, not merely an idempotent write); `count(payment_events WHERE event_id='evt_idem_1')` = 1; `payment_events.received_at` unchanged (`ON CONFLICT DO NOTHING`, not `DO UPDATE`); stub `_control/state` unchanged.

Second case: the same `event_id` with a **different** `status`/`amount` still returns `duplicate` and changes nothing — the `event_id` is the identity, the body is not.

Third case: a duplicate arriving *before* the first is applied — the same `event_id` sent twice concurrently; assert exactly one `payment_events` row and one `applied`.

### 11.3 Criterion 3 — out-of-order and early webhooks

**File:** `webhook-out-of-order.e2e.spec.ts`

| Case | Setup | Assertion |
|---|---|---|
| **Before the order exists** | `POST /webhooks/payment` for `ord_early_1` with no such order | `200 {result:'orphan'}`; `payment_events.state='orphan'`, `order_id IS NULL`; no order created |
| **Orphan drained on order creation** | then `POST /orders {sku, client_order_id:'ord_early_1'}` | response `201`; `waitFor(status==='delivered')`; the orphan event is now `state='applied'`, `order_id` set; exactly 1 `issued_deliveries` row |
| **Orphan drained by the sweeper** | same, but with the order inserted directly via SQL so the in-transaction drain is bypassed | `POST /admin/sweeper/run`; then `waitFor(delivered)` |
| **`failed` after `paid`** | apply `paid`, wait `delivered`, then send `failed` with a **later** `created_at` | `200 {result:'conflict'}`; `orders.status` still `delivered`; `payment_events.state='conflict'`; `GET /reconciliation/payment-conflicts` returns it; 1 `issued_deliveries` row; ledger balanced |
| **`paid` after `failed`** | apply `failed` (→ `payment_failed`), then `paid` | `200 {result:'conflict'}`; status still `payment_failed`; **zero** ledger entries; **zero** `issued_deliveries`; conflict reported |
| **Recovery from that conflict** | `POST /admin/orders/ord_x/force-paid {event_id}` | `202`; `waitFor(delivered)`; exactly 1 delivery; ledger balanced |
| **Stale `created_at`** | apply `paid` at `T`, then send another `paid` (distinct `event_id`) with `created_at = T - 60s` | `200 {result:'ignored_stale'}`; nothing changes |
| **Amount mismatch** | `paid` with `amount: 999` for a 500 order | `200 {result:'rejected_amount'}`; status still `created`; zero ledger entries |

Determinism: fixed ISO timestamps, no `Date.now()` in assertions, sweeper invoked explicitly via the admin endpoint rather than waited for.

### 11.4 Criterion 4 — the timeout trap

**File:** `supplier-timeout-trap.e2e.spec.ts` — the most important test in the suite.

Setup: stubs with all rates `0`; `SUPPLIER_REQUEST_TIMEOUT_MS=500`, `STUB_HANG_MS=2000`, `SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS=5`, `WORKER_ENABLED=true`. Order `ord_trap_1` on a **supplier-mode** SKU (`STEAM-TOPUP-500`).

Force determinism:
```
POST {stubA}/_control/reset
POST {stubA}/_control/scenario  {"mode":"issue_then_hang","times":1}
```
The stub **mints and persists the code first, then hangs** — the supplier genuinely issued, our client genuinely times out.

Run: send `paid`; `await waitFor(() => order.status === 'delivered', {timeoutMs: 15000})`.

Assertions:
1. `SELECT count(*) FROM issued_deliveries WHERE order_id=$1` = **1**.
2. `SELECT count(*) FROM delivery_attempts WHERE order_id=$1` = **1** — the retry reused the row, it did not create a second one.
3. That attempt: `supplier_code='A'`, `attempt_no=1`, `request_id='req_ord_trap_1_A_1'`, final `state='succeeded'`, `resolve_attempts >= 1`.
4. Stub A `GET /_control/state`: **exactly one** record; its `request_id` is `req_ord_trap_1_A_1`; its `code` **equals** `issued_deliveries.code`. ← proves no second code was minted upstream.
5. Stub A `available` decreased by exactly **1**.
6. Log capture contains `delivery.attempt.timeout` then `delivery.attempt.unknown` then `delivery.attempt.resolved`, all with the same `request_id`, and **no** `delivery.fallback` — an unresolved `unknown` must never fall back to B.
7. Ledger: exactly 2 txns, 4 entries, balanced.

Second case — **crash-equivalent**: insert a `delivery_attempts` row directly in `in_flight` with `started_at = now() - 1 minute` after making the stub mint that `request_id` out of band; run `POST /admin/sweeper/run`; assert the attempt is demoted to `unknown`, resolved via `GET /issue/:request_id`, and produces exactly one delivery. This proves crash and timeout converge on the same recovery path.

Third case — **resolution says "not issued"**: `{"mode":"timeout","times":1}` (hangs **without** minting). Assert the resolver's `GET /issue/:request_id` returns `404`, the attempt becomes `failed(error_kind='timeout_not_issued')`, `attempt_no=2` is created on supplier A with `request_id='req_ord_x_A_2'`, and exactly one delivery results.

### 11.5 Criterion 5 — A unavailable, fallback to B

**File:** `supplier-fallback.e2e.spec.ts`

Setup: start API with `SUPPLIER_A_BASE_URL='http://127.0.0.1:59999'` (a guaranteed-closed loopback port → a real, instant `ECONNREFUSED`) and `SUPPLIER_B_BASE_URL` pointing at the live stub B. Rejected alternative: a stub mode simulating unavailability — a closed port is deterministic with zero moving parts and exercises the real `ECONNREFUSED` classification branch.

Run: order `ord_fb_1` on a supplier-mode SKU; send `paid`; `waitFor(delivered)`.

Assertions:
1. `count(issued_deliveries WHERE order_id=$1)` = **1**; `source='supplier'`; `supplier_code='B'`.
2. `delivery_attempts` for the order: exactly **2** rows — `('A',1,'req_ord_fb_1_A_1','failed','network_refused')` and `('B',1,'req_ord_fb_1_B_1','succeeded')`.
3. B's `request_id` is **different** from A's — asserted explicitly, with the reason recorded in README §5.5.
4. Stub B `_control/state`: exactly one record for the order. Stub A was never reached (it is not even running on that port).
5. Log capture contains `delivery.fallback` with `{from:'A', to:'B', reason:'network_refused'}` at WARN.
6. Total elapsed from `paid` to `delivered` < 2 s — proves `network_refused` skips backoff rather than burning the retry budget.
7. Ledger balanced; exactly one `delivery_recognized` txn.

Second case — **both suppliers down**: both base URLs point at closed ports. Assert `waitFor(status==='delivery_failed')`, `recoverable: true` in `GET /orders/:id`, `GET /orders/:id` returns `200` (never 5xx), no `issued_deliveries` row, and the `payment_captured` ledger txn exists while `delivery_recognized` does not (so `owed_to_customers_minor` equals the order total). Then bring B up, `POST /admin/orders/:id/redeliver`, assert delivery — exactly one.

Third case — **`out_of_stock` from A, success from B**: `POST {stubA}/_control/scenario {"mode":"out_of_stock","times":1}`. Assert fallback to B and exactly one delivery.

Fourth case — **A `unknown`, then abandoned, then B**: stub A forced to hang on `/issue` and on the lookup channel, with `SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS=2`. Assert the attempt reaches `abandoned_unknown`, `delivery.stranded_issuance` is logged at ERROR, `GET /reconciliation/stranded-issuances` reports it, B then delivers, and `count(issued_deliveries) = 1`.

### 11.6 Criterion 6 — empty stock, recoverable, no crash

**File:** `out-of-stock-recovery.e2e.spec.ts`

**Pool case.** Setup: `DELETE FROM stock_keys WHERE product_id = (SELECT id FROM products WHERE sku='KEY-GTA5')` and set `sku_stock.available_count=0`, `products.in_stock=false`. Order `ord_oos_1` on `KEY-GTA5`, send `paid`, `waitFor(status==='out_of_stock')`.

Assertions:
1. `GET /orders/ord_oos_1` → **`200`** (not 4xx, not 5xx) with `status:'out_of_stock'`, `recoverable:true`, `terminal:false`, `delivery:null`.
2. `count(issued_deliveries WHERE order_id=$1)` = **0**; `count(stock_keys WHERE order_id=$1)` = **0** (nothing was half-reserved).
3. The `deliver_order` job is `state='done'`, **not** `dead` — an expected business outcome must not consume the retry budget.
4. Ledger: `payment_captured` exists, `delivery_recognized` does not; `GET /reconciliation/ledger-balance` → `balanced:true`; `owed_to_customers_minor` = `total_minor`.
5. `GET /catalog?in_stock=true` does **not** contain `KEY-GTA5`; `GET /catalog?in_stock=false` does, with `available_count: 0`.
6. `GET /reconciliation/paid-not-delivered?older_than_seconds=0` contains the order.
7. The process is alive: `GET /health` → `200`; no unhandled rejection was recorded (the test installs `process.on('unhandledRejection')` and fails on any).

Recovery: `POST /admin/products/KEY-GTA5/restock {"count": 3}` → `200 {added:3}`. Then `POST /admin/sweeper/run`, `waitFor(status==='delivered')`.

8. Exactly **1** `issued_deliveries` row; exactly **1** `stock_keys` row with `order_id=$1, status='issued'`; `sku_stock.available_count` = 2; `products.in_stock` = true; `delivery_generation` = 1.
9. Ledger balanced; `owed_to_customers_minor` back to 0.
10. `GET /reconciliation/paid-not-delivered` no longer contains the order.

**Supplier case.** Both stubs forced to `out_of_stock`; assert the order reaches `out_of_stock`, both attempts recorded (`A`,1 and `B`,1) with `error_kind='out_of_stock'`, `sku_stock.available_count` forced to 0, and identical recovery via `/_control/restock` + `POST /admin/products/:sku/restock` + sweeper.

**Concurrent drain.** 10 orders for a SKU with only 3 keys, all paid concurrently: assert exactly 3 `delivered` and 7 `out_of_stock`; `count(issued_deliveries)` = 3; **no key appears twice** (`SELECT stock_key_id, count(*) FROM issued_deliveries GROUP BY 1 HAVING count(*)>1` returns zero rows); `available_count` = 0. This is the direct test of "один ключ не может уйти в два заказа".

### 11.7 Supporting tests

| File | Covers |
|---|---|
| `unit/order-state-machine.spec.ts` | The full transition table as a data-driven `test.each` over all 7 statuses × 9 events = 63 cases. Terminal/recoverable classification. `ILLEGAL_TRANSITION` throws. |
| `unit/backoff.util.spec.ts` | Monotonic growth, cap respected, jitter bounded to `[exp/2, exp)`, never returns 0, deterministic with an injected `rnd`. |
| `unit/request-id.util.spec.ts` | Exact format `req_ord_00123_A_1`; stable across 1000 calls; differs by supplier and by attempt; matches the DB `UNIQUE` shape. |
| `unit/money.util.spec.ts` | `toMinor(500)===50000`; rejects non-integer, negative, `NaN`, `Infinity`, and values beyond `Number.MAX_SAFE_INTEGER / 100`; `toMajor` round-trips. |
| `unit/supplier-error-classification.spec.ts` | Every row of the §6.1 table: which observation maps to which `error_kind` and which attempt state. Especially `5xx`+body → `failed` vs `5xx`+garbage → `unknown`. |
| `integration/order-lifecycle.e2e.spec.ts` | Stage 1 happy path for both modes; `created→paid→delivering→delivered`; `created→payment_failed`; `GET /orders` shapes; 404s. |
| `integration/ledger-balance.e2e.spec.ts` | All four §7.4 invariant queries after a mixed workload of 30 orders (delivered / failed / out_of_stock / conflicted). |
| `integration/reconciliation.e2e.spec.ts` | `paid-not-delivered` and `delivered-not-paid` both return the seeded anomalies and nothing else; `summary` counts match; `stock-drift` detects a manually corrupted counter and `POST /admin/reconcile/stock` repairs it. |
| `integration/sweeper.e2e.spec.ts` | Stale `running` job reclaim; stuck `delivering` requeue; `in_flight` → `unknown` demotion; orphan TTL abandonment; `MAX_DELIVERY_GENERATIONS` cutoff; **and that running the sweeper concurrently with 10 live deliveries produces no duplicate delivery**. |
| `integration/catalog-keyset.e2e.spec.ts` | Full pagination walk over 300 seeded SKUs visits every SKU exactly once in `sku COLLATE "C"` order; cursor stability under a concurrent insert; `in_stock` filter correctness; `limit` bounds; invalid cursor → `400`; an `EXPLAIN` assertion that the designed plan contains `Index Only Scan` and **not** `Seq Scan`/`Sort`. |
| `apps/supplier-stub/test/issue.spec.ts` | Same `request_id` → same code (100 repeats); `GET /issue/:id` 200/404; inventory exhaustion → `409 out_of_stock`; a known `request_id` still returns its code when inventory is exhausted; every scenario mode behaves as tabulated; `issue_then_hang` **stores before hanging**; persistence survives a restart. |

**CI gate:** `lint` → `typecheck` → `test:unit` → `migration:run` → `test:integration`. Integration uses a `postgres:16-alpine` service container; all stub rates forced to `0`; `SUPPLIER_REQUEST_TIMEOUT_MS=500` and `STUB_HANG_MS=2000` to keep the suite under ~90 s.

---

