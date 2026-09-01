## 3. Data model

### 3.1 Money representation

**Decision: `BIGINT` integer minor units (kopecks).** Column suffix `_minor` everywhere, no exceptions.

Rationale:
- Exact by construction; no float, no rounding drift when summing a ledger. `NUMERIC(20,2)` is also exact, but forces every arithmetic through PostgreSQL's arbitrary-precision path, arrives in `node-postgres` as a **string** (every read needs a parse, every comparison a decision about how to compare), and invites accidental `parseFloat`. `BIGINT` arrives as a string too by default, so we register a pg type parser for OID 20 that returns `Number` and assert `Number.isSafeInteger` — safe up to 9·10¹⁵ kopecks (~90 trillion RUB), far beyond this domain.
- Rejected alternative: `NUMERIC(20,2)` — exact but string-typed in JS and adds a decimal-handling library or hand-rolled decimal math for zero benefit at RUB scale.

**Boundary rule (this is an assumption — document it in README §5.1):** the payment webhook's `amount` field and `stock/products.json`'s `price` are in **major units** (whole rubles) — the contract example pairs `amount: 500` with `STEAM-TOPUP-500` whose `price` is `500`. Conversion is exactly `amount_minor = amount * 100`, with `@IsInt()` on the DTO so no fractional major amount can enter. The API responds with **both** `amount_minor` (authoritative) and `amount` (display).

Currency: `CHAR(3)`, only `'RUB'` is accepted (`SUPPORTED_CURRENCIES = ['RUB']`). The products.json note explicitly says currency switching is display-only and no conversion is needed.

### 3.2 `products` — catalog

```sql
CREATE TABLE products (
  id                BIGSERIAL     PRIMARY KEY,
  sku               TEXT          COLLATE "C" NOT NULL,
  name              TEXT          NOT NULL,
  type              TEXT          NOT NULL,
  price_minor       BIGINT        NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'RUB',
  image_url         TEXT          NULL,
  fulfillment_mode  TEXT          NOT NULL,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  in_stock          BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT products_sku_uq        UNIQUE (sku),
  CONSTRAINT products_type_ck       CHECK (type IN ('key','topup','subscription','giftcard')),
  CONSTRAINT products_mode_ck       CHECK (fulfillment_mode IN ('pool','supplier')),
  CONSTRAINT products_price_ck      CHECK (price_minor > 0),
  CONSTRAINT products_currency_ck   CHECK (currency = 'RUB'),
  CONSTRAINT products_mode_type_ck  CHECK ((type = 'key') = (fulfillment_mode = 'pool'))
) WITH (fillfactor = 90);
```

`COLLATE "C"` on `sku` is deliberate: it makes keyset comparison byte-ordered and identical between the index and the query, immune to ICU/glibc collation version drift, and makes `sku LIKE 'PREFIX%'` index-usable without `text_pattern_ops`.

`in_stock` is a denormalized boolean maintained in the same transaction as the stock counter. It only flips on 0↔1 crossings, so it is written rarely and is safe as a partial-index predicate on the hot table. See §8.2.

### 3.3 `sku_stock` — storefront counter

```sql
CREATE TABLE sku_stock (
  product_id          BIGINT      PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  available_count     INTEGER     NOT NULL DEFAULT 0,
  reserved_count      INTEGER     NOT NULL DEFAULT 0,
  issued_count        INTEGER     NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reconciled_at  TIMESTAMPTZ NULL,
  CONSTRAINT sku_stock_available_ck CHECK (available_count >= 0),
  CONSTRAINT sku_stock_reserved_ck  CHECK (reserved_count  >= 0),
  CONSTRAINT sku_stock_issued_ck    CHECK (issued_count    >= 0)
) WITH (fillfactor = 70);
```

`fillfactor = 70` because this is the hottest-updated table in the system; leaving free space per page maximises HOT updates and keeps the PK index from bloating.

Separate table (not a column on `products`) so that the write-hot counter never dirties the read-hot catalog pages. For `fulfillment_mode = 'supplier'` products the counter is our **local view of supplier availability**: seeded to `SUPPLIER_VIRTUAL_STOCK` (default 1000), decremented on each successful issue, forced to `0` when both suppliers answer `out_of_stock`, and restored by `POST /admin/products/:sku/restock`.

### 3.4 `stock_keys` — the key pool (one key never goes to two orders)

```sql
CREATE TABLE stock_keys (
  id           BIGSERIAL    PRIMARY KEY,
  product_id   BIGINT       NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  code         TEXT         NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'available',
  order_id     BIGINT       NULL REFERENCES orders(id) ON DELETE RESTRICT,
  batch        TEXT         NOT NULL DEFAULT 'seed',
  reserved_at  TIMESTAMPTZ  NULL,
  issued_at    TIMESTAMPTZ  NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT stock_keys_status_ck CHECK (status IN ('available','reserved','issued')),
  CONSTRAINT stock_keys_code_uq   UNIQUE (product_id, code),
  CONSTRAINT stock_keys_link_ck   CHECK (
      (status = 'available' AND order_id IS NULL)
   OR (status IN ('reserved','issued') AND order_id IS NOT NULL))
);

-- one order can hold at most one key; a key row physically has at most one order_id
CREATE UNIQUE INDEX stock_keys_order_uq
  ON stock_keys (order_id) WHERE order_id IS NOT NULL;

-- serves the FOR UPDATE SKIP LOCKED reservation pick and the drift-count query
CREATE INDEX idx_stock_keys_available
  ON stock_keys (product_id, id) WHERE status = 'available';
```

**Why "one key can never go to two orders" holds:** the assignment column `order_id` lives *on the key row*, so a key trivially has ≤1 order; `stock_keys_order_uq` makes it ≤1 key per order; and the final backstop is `issued_deliveries.stock_key_id UNIQUE`. Three independent DB-level facts, none of which depend on application code being correct.

### 3.5 `orders`

```sql
CREATE SEQUENCE order_ext_seq START 100;

CREATE TABLE orders (
  id                     BIGSERIAL   PRIMARY KEY,
  ext_id                 TEXT        NOT NULL,
  product_id             BIGINT      NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku                    TEXT        NOT NULL,                        -- snapshot
  quantity               INTEGER     NOT NULL DEFAULT 1,
  unit_price_minor       BIGINT      NOT NULL,                        -- snapshot
  total_minor            BIGINT      NOT NULL,
  currency               CHAR(3)     NOT NULL DEFAULT 'RUB',
  status                 TEXT        NOT NULL DEFAULT 'created',
  buyer_email            TEXT        NULL,
  failure_reason         TEXT        NULL,
  delivery_generation    INTEGER     NOT NULL DEFAULT 0,
  last_payment_event_id  TEXT        NULL,
  last_payment_event_at  TIMESTAMPTZ NULL,                            -- webhook created_at, ordering key
  paid_at                TIMESTAMPTZ NULL,
  delivering_at          TIMESTAMPTZ NULL,
  delivered_at           TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_ext_uq      UNIQUE (ext_id),
  CONSTRAINT orders_status_ck   CHECK (status IN
      ('created','paid','delivering','delivered','payment_failed','out_of_stock','delivery_failed')),
  CONSTRAINT orders_qty_ck      CHECK (quantity = 1),
  CONSTRAINT orders_total_ck    CHECK (total_minor = unit_price_minor * quantity AND total_minor > 0),
  CONSTRAINT orders_paid_ck     CHECK (status <> 'created' OR paid_at IS NULL)
);

-- reconciliation: "paid but not delivered", and the sweeper's candidate scan
CREATE INDEX idx_orders_paid_undelivered
  ON orders (paid_at)
  WHERE paid_at IS NOT NULL AND status <> 'delivered' AND status <> 'payment_failed';

-- sweeper: recoverable states aging out
CREATE INDEX idx_orders_recoverable
  ON orders (updated_at)
  WHERE status IN ('out_of_stock','delivery_failed','delivering');

-- operator listing
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);
```

`ext_id` is the public order id used in the webhook contract, format `ord_00123`:
`'ord_' || lpad(nextval('order_ext_seq')::text, 5, '0')`. A client may supply its own `client_order_id` (validated `^ord_(?!\d+$)[A-Za-z0-9_-]{1,40}$`, i.e. anything but the all-digit shape the sequence itself mints) which becomes `ext_id` — this both gives order-creation idempotency and makes criterion 3 reproducible end-to-end (you can send a webhook for an id before creating the order under that id).

`quantity` is pinned to 1 by a CHECK. Multi-line orders are out of scope; making the constraint explicit is honest and prevents half-implemented multi-item logic. Stated in README §9.

### 3.6 `payment_events` — webhook idempotency

```sql
CREATE TABLE payment_events (
  id                  BIGSERIAL   PRIMARY KEY,
  event_id            TEXT        NOT NULL,
  order_ext_id        TEXT        NOT NULL,
  order_id            BIGINT      NULL REFERENCES orders(id) ON DELETE SET NULL,
  status              TEXT        NOT NULL,
  amount_minor        BIGINT      NOT NULL,
  currency            CHAR(3)     NOT NULL,
  occurred_at         TIMESTAMPTZ NOT NULL,          -- webhook `created_at`
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ NULL,
  state               TEXT        NOT NULL DEFAULT 'pending',
  ignore_reason       TEXT        NULL,
  applied_from_status TEXT        NULL,
  applied_to_status   TEXT        NULL,
  trace_id            TEXT        NULL,
  raw_payload         JSONB       NOT NULL,
  CONSTRAINT payment_events_event_uq  UNIQUE (event_id),
  CONSTRAINT payment_events_status_ck CHECK (status IN ('paid','failed')),
  CONSTRAINT payment_events_state_ck  CHECK (state IN
      ('pending','applied','orphan','abandoned','ignored_stale','ignored_already_paid',
       'ignored_terminal','conflict','rejected_amount')),
  CONSTRAINT payment_events_amount_ck CHECK (amount_minor >= 0)
);

-- orphan drain: find events waiting for their order to appear
CREATE INDEX idx_payment_events_orphan
  ON payment_events (order_ext_id, received_at) WHERE state = 'orphan';

-- per-order audit trail on GET /orders/:id and reconciliation
CREATE INDEX idx_payment_events_order ON payment_events (order_id, occurred_at DESC);

-- reconciliation: conflicts needing an operator
CREATE INDEX idx_payment_events_conflict
  ON payment_events (received_at) WHERE state = 'conflict';
```

`payment_events_event_uq` is **the** criterion-2 guarantee. `raw_payload` is stored verbatim so any dispute can be replayed.

### 3.7 `delivery_attempts` — supplier request idempotency

```sql
CREATE TABLE delivery_attempts (
  id               BIGSERIAL   PRIMARY KEY,
  order_id         BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  supplier_code    TEXT        NOT NULL,
  attempt_no       INTEGER     NOT NULL,
  request_id       TEXT        NOT NULL,
  sku              TEXT        NOT NULL,
  state            TEXT        NOT NULL DEFAULT 'pending',
  http_status      INTEGER     NULL,
  response_code    TEXT        NULL,                   -- the code the supplier issued
  error_kind       TEXT        NULL,                   -- SupplierErrorKind
  error_reason     TEXT        NULL,                   -- supplier `reason` or JS error name
  resolve_attempts INTEGER     NOT NULL DEFAULT 0,
  next_resolve_at  TIMESTAMPTZ NULL,
  started_at       TIMESTAMPTZ NULL,
  finished_at      TIMESTAMPTZ NULL,
  duration_ms      INTEGER     NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_attempts_request_uq UNIQUE (request_id),
  CONSTRAINT delivery_attempts_slot_uq    UNIQUE (order_id, supplier_code, attempt_no),
  CONSTRAINT delivery_attempts_supp_ck    CHECK (supplier_code IN ('A','B')),
  CONSTRAINT delivery_attempts_state_ck   CHECK (state IN
      ('pending','in_flight','succeeded','failed','unknown','abandoned_unknown')),
  CONSTRAINT delivery_attempts_ok_ck      CHECK (state <> 'succeeded' OR response_code IS NOT NULL)
);

-- at most ONE non-final attempt per order: prevents two workers opening parallel supplier calls
CREATE UNIQUE INDEX delivery_attempts_open_uq
  ON delivery_attempts (order_id) WHERE state IN ('pending','in_flight','unknown');

-- the resolver job's scan
CREATE INDEX idx_delivery_attempts_resolvable
  ON delivery_attempts (next_resolve_at) WHERE state = 'unknown';

-- reconciliation report: stranded supplier issuances
CREATE INDEX idx_delivery_attempts_stranded
  ON delivery_attempts (updated_at) WHERE state = 'abandoned_unknown';

CREATE INDEX idx_delivery_attempts_order ON delivery_attempts (order_id, id);
```

`delivery_attempts_request_uq` is the criterion-4 guarantee at our side; the supplier's `request_id -> code` map is the guarantee at their side.
`delivery_attempts_open_uq` is the structural reason two workers can never have two live supplier calls for the same order.

### 3.8 `issued_deliveries` — the exactly-once delivery fact

```sql
CREATE TABLE issued_deliveries (
  id                  BIGSERIAL   PRIMARY KEY,
  order_id            BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id          BIGINT      NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku                 TEXT        NOT NULL,
  code                TEXT        NOT NULL,
  source              TEXT        NOT NULL,
  stock_key_id        BIGINT      NULL REFERENCES stock_keys(id) ON DELETE RESTRICT,
  supplier_code       TEXT        NULL,
  delivery_attempt_id BIGINT      NULL REFERENCES delivery_attempts(id) ON DELETE RESTRICT,
  delivered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT issued_deliveries_order_uq  UNIQUE (order_id),
  CONSTRAINT issued_deliveries_code_uq   UNIQUE (code),
  CONSTRAINT issued_deliveries_source_ck CHECK (source IN ('pool','supplier')),
  CONSTRAINT issued_deliveries_shape_ck  CHECK (
      (source = 'pool'     AND stock_key_id IS NOT NULL AND supplier_code IS NULL)
   OR (source = 'supplier' AND stock_key_id IS NULL     AND supplier_code IN ('A','B')
       AND delivery_attempt_id IS NOT NULL))
);

CREATE UNIQUE INDEX issued_deliveries_stock_key_uq
  ON issued_deliveries (stock_key_id) WHERE stock_key_id IS NOT NULL;

CREATE UNIQUE INDEX issued_deliveries_attempt_uq
  ON issued_deliveries (delivery_attempt_id) WHERE delivery_attempt_id IS NOT NULL;

CREATE INDEX idx_issued_deliveries_at ON issued_deliveries (delivered_at DESC);
```

**`issued_deliveries_order_uq` is the single most important constraint in the system.** It is the last-resort backstop for criteria 1, 4 and 5: even if every lock, every state check and every dedupe key failed simultaneously, a second delivery fact for one order is physically impossible. All code paths that insert here use `ON CONFLICT (order_id) DO NOTHING RETURNING *`; an empty result means "someone already delivered", which is treated as success and converges the order to `delivered`.

`issued_deliveries_code_uq` is a global anti-duplication net across pool and supplier sources — if two orders ever receive the same code, the second INSERT fails loudly instead of silently defrauding a customer.

### 3.9 `jobs` — the queue

```sql
CREATE TABLE jobs (
  id           BIGSERIAL   PRIMARY KEY,
  kind         TEXT        NOT NULL,
  dedupe_key   TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  state        TEXT        NOT NULL DEFAULT 'pending',
  attempts     INTEGER     NOT NULL DEFAULT 0,
  max_attempts INTEGER     NOT NULL DEFAULT 8,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at    TIMESTAMPTZ NULL,
  locked_by    TEXT        NULL,
  last_error   TEXT        NULL,
  trace_id     TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ NULL,
  CONSTRAINT jobs_state_ck CHECK (state IN ('pending','running','done','dead')),
  CONSTRAINT jobs_kind_ck  CHECK (kind IN ('deliver_order','resolve_unknown_attempt'))
) WITH (fillfactor = 70);

-- ONE live job per (kind, dedupe_key); leaves the index when done/dead so re-enqueue is possible
CREATE UNIQUE INDEX jobs_live_uq
  ON jobs (kind, dedupe_key) WHERE state IN ('pending','running');

-- the claim query's index; partial so it stays tiny regardless of history size
CREATE INDEX idx_jobs_claim ON jobs (run_at, id) WHERE state = 'pending';

-- stale-lock reclaim
CREATE INDEX idx_jobs_stale ON jobs (locked_at) WHERE state = 'running';
```

`jobs_live_uq` is why 50 concurrent webhooks produce **one** delivery job, not 50. Enqueue is:

```sql
INSERT INTO jobs (kind, dedupe_key, payload, run_at, trace_id)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (kind, dedupe_key) WHERE state IN ('pending','running') DO NOTHING
RETURNING id;
```

(the `WHERE` clause in `ON CONFLICT` is required for PostgreSQL to infer a partial unique index — the developer must not omit it).

Claim:

```sql
UPDATE jobs
SET state='running', locked_at=now(), locked_by=$1, attempts=attempts+1, updated_at=now()
WHERE id IN (
  SELECT id FROM jobs
  WHERE state='pending' AND run_at <= now()
  ORDER BY run_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
RETURNING *;
```

### 3.10 `ledger_txns` / `ledger_entries` — money movements that always balance

**Decision: double-entry, two tables.** Rejected alternative: single-entry with signed amounts — it can only "balance" tautologically (the sum of a list of numbers equals itself); it cannot answer "where did the money come from and where did it go", and the assignment's phrasing ("журнал, который всегда сходится") only means something under double-entry.

```sql
CREATE TABLE ledger_txns (
  txn_id          UUID        PRIMARY KEY,
  kind            TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  order_id        BIGINT      NULL REFERENCES orders(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_txns_idem_uq UNIQUE (idempotency_key),
  CONSTRAINT ledger_txns_kind_ck CHECK (kind IN
      ('payment_captured','delivery_recognized','payment_refunded','delivery_written_off'))
);

CREATE TABLE ledger_entries (
  id               BIGSERIAL   PRIMARY KEY,
  txn_id           UUID        NOT NULL REFERENCES ledger_txns(txn_id) ON DELETE RESTRICT,
  entry_seq        SMALLINT    NOT NULL,
  account          TEXT        NOT NULL,
  direction        TEXT        NOT NULL,
  amount_minor     BIGINT      NOT NULL,
  signed_minor     BIGINT      GENERATED ALWAYS AS
                     (CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) STORED,
  currency         CHAR(3)     NOT NULL,
  order_id         BIGINT      NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_event_id BIGINT      NULL REFERENCES payment_events(id) ON DELETE RESTRICT,
  memo             TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_seq_uq    UNIQUE (txn_id, entry_seq),
  CONSTRAINT ledger_entries_amount_ck CHECK (amount_minor > 0),
  CONSTRAINT ledger_entries_dir_ck    CHECK (direction IN ('debit','credit')),
  CONSTRAINT ledger_entries_acct_ck   CHECK (account IN ('cash','customer_prepayment','revenue'))
);

CREATE INDEX idx_ledger_entries_txn      ON ledger_entries (txn_id);
CREATE INDEX idx_ledger_entries_order    ON ledger_entries (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_ledger_entries_account  ON ledger_entries (account, created_at DESC);
```

`ledger_txns_idem_uq` makes posting idempotent: `payment_captured:{event_id}`, `delivery_recognized:{order_ext_id}:{generation}`. If the same business event is processed twice, the second `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING txn_id` returns nothing and the legs are skipped.

Chart of accounts (deliberately three, so the whole model fits in a paragraph of README §5.1):

| Account | Kind | Meaning |
|---|---|---|
| `cash` | asset | money received from the PSP |
| `customer_prepayment` | liability | goods owed to the customer |
| `revenue` | income | recognized once the code is handed over |

| Business event | Debit | Credit | Amount | Idempotency key |
|---|---|---|---|---|
| `payment_captured` (webhook `paid` applied) | `cash` | `customer_prepayment` | `order.total_minor` | `payment_captured:{event_id}` |
| `delivery_recognized` (delivery fact inserted) | `customer_prepayment` | `revenue` | `order.total_minor` | `delivery_recognized:{ext_id}:{generation}` |
| `payment_refunded` (admin cancels an unfillable order) | `customer_prepayment` | `cash` | `order.total_minor` | `payment_refunded:{ext_id}` |
| webhook `failed` | — | — | — | no entries at all |

### 3.11 Index rationale summary

| Index | Serves |
|---|---|
| `products_sku_uq` | `GET /catalog/:sku`, order creation lookup, seed upserts |
| `idx_products_storefront_instock` / `_all` (§8.1) | the stage-5 hot storefront query |
| `sku_stock` PK | nested-loop join from the catalog keyset scan; `FOR UPDATE` counter row |
| `idx_stock_keys_available` | `FOR UPDATE SKIP LOCKED` reservation pick; drift-count aggregate |
| `stock_keys_order_uq` | uniqueness invariant + "which key did order X get" |
| `orders_ext_uq` | webhook order lookup (`FOR UPDATE`), order creation idempotency |
| `idx_orders_paid_undelivered` | `GET /reconciliation/paid-not-delivered`, sweeper step 2 |
| `idx_orders_recoverable` | sweeper steps 3–4 |
| `payment_events_event_uq` | criterion-2 dedupe |
| `idx_payment_events_orphan` | orphan drain on order creation + sweeper step 6 |
| `idx_payment_events_order` | order detail response, per-order audit |
| `delivery_attempts_request_uq` | criterion-4 idempotency; resolver lookup by request_id |
| `delivery_attempts_open_uq` | at most one live supplier call per order |
| `idx_delivery_attempts_resolvable` | resolver job scan |
| `issued_deliveries_order_uq` | **the exactly-once backstop** + "is this order delivered" checks |
| `jobs_live_uq` | 50 webhooks → 1 job |
| `idx_jobs_claim` | the worker's `SKIP LOCKED` claim; partial keeps it ~ queue depth, not history |
| `ledger_txns_idem_uq` | ledger posting idempotency |
| `idx_ledger_entries_order` | per-order money trail in reconciliation |

---

