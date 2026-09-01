## 8. Catalog under load (stage 5)

### 8.1 The storefront hot query

**Endpoint:** `GET /catalog?type=&in_stock=&limit=&cursor=&q=`

**Pagination — keyset, not offset.** `OFFSET 40000` forces PostgreSQL to produce and discard 40 000 rows; cost grows linearly with page depth and the plan degrades to a full sort. Keyset is O(log n) at any depth and is stable under concurrent inserts. Rejected: offset — simpler API, but the assignment explicitly asks for a query that *stays* fast, which offset cannot be.

Cursor: opaque base64url of `"${sku}${id}"`, decoded and validated against `CURSOR_REGEX` in `catalog.constants.ts`. Sort order is `(sku, id)` ascending — `sku` is `COLLATE "C"`, so ordering is byte-wise and identical in query and index.

**The query** (`catalog/catalog.repository.ts`):

```sql
SELECT p.id, p.sku, p.name, p.type, p.price_minor, p.currency, p.image_url,
       COALESCE(s.available_count, 0) AS available_count
FROM products p
JOIN sku_stock s ON s.product_id = p.id
WHERE p.is_active
  AND ($1::text IS NULL OR p.type = $1)
  AND ($2::bool IS NOT TRUE OR p.in_stock)
  AND ($3::text IS NULL OR p.sku LIKE $3 || '%')
  AND ($4::text IS NULL OR (p.sku, p.id) > ($4, $5))
ORDER BY p.sku, p.id
LIMIT $6;
```

`limit` default 24, max 100. `has_more` is computed by requesting `limit + 1` rows and trimming.

The `(p.sku, p.id) > ($4, $5)` form is a **row-constructor** comparison, not `sku > $4 OR (sku = $4 AND id > $5)` — the former is directly index-usable as a single seek; the latter usually degenerates into a filter.

**Indexes** (migration `1756600000005-StorefrontIndexes.ts`, kept in its own migration so the README can show plans with and without them):

```sql
-- default storefront: in-stock, no type filter
CREATE INDEX idx_products_storefront_instock
  ON products (sku, id)
  INCLUDE (name, type, price_minor, currency, image_url)
  WHERE is_active AND in_stock;

-- category page: in-stock, filtered by type
CREATE INDEX idx_products_storefront_type_instock
  ON products (type, sku, id)
  INCLUDE (name, price_minor, currency, image_url)
  WHERE is_active AND in_stock;

-- "show everything incl. out of stock"
CREATE INDEX idx_products_storefront_all
  ON products (sku, id)
  INCLUDE (name, type, price_minor, currency, image_url)
  WHERE is_active;

CREATE INDEX idx_products_storefront_type_all
  ON products (type, sku, id)
  INCLUDE (name, price_minor, currency, image_url)
  WHERE is_active;
```

Four narrow partial indexes rather than one wide one: each covers exactly one query shape and each is an order of magnitude smaller than the table. `INCLUDE` makes the `products` side an **Index Only Scan** (heap fetches ≈ 0 after `VACUUM ANALYZE`), and the `sku_stock` side is `limit` PK lookups in a nested loop — a constant, not a function of catalog size.

`q` is a **prefix** match on `sku` only (`sku LIKE 'STEAM%'`), which the `COLLATE "C"` index serves directly. Full-text/fuzzy search would need `pg_trgm` or `tsvector`; explicitly out of scope, stated in README §9.

### 8.2 The denormalized stock counter

Two denormalizations, deliberately split by write frequency:

| Field | Table | Frequency | Purpose |
|---|---|---|---|
| `available_count` | `sku_stock` | every issue/restock | exact number shown on the product card |
| `in_stock` | `products` | only on 0↔1 crossings | partial-index predicate for the hot query |

Splitting them is the whole trick: the frequently-written integer lives on a small, `fillfactor=70` side table that nothing scans; the rarely-written boolean lives on the catalog table where it can be an index predicate without causing index churn.

**Decision: maintained by an explicit `UPDATE` inside the same service transaction, not by a trigger.** Rejected: trigger — hides business logic from the code and from Vitest, and would fire 500 000 times during the benchmark seed (requiring `ALTER TABLE ... DISABLE TRIGGER`, i.e. a second, divergent code path exactly where correctness matters least and surprise matters most).

The single statement used by every delivery (pool mode; supplier mode is identical minus the `stock_keys` clause):

```sql
WITH upd AS (
  UPDATE sku_stock
  SET available_count = GREATEST(available_count - 1, 0),
      issued_count    = issued_count + 1,
      updated_at      = now()
  WHERE product_id = $1
  RETURNING product_id, available_count
)
UPDATE products p
SET in_stock = (upd.available_count > 0), updated_at = now()
FROM upd
WHERE p.id = upd.product_id AND p.in_stock <> (upd.available_count > 0);
```

Read-modify-write happens **inside SQL**, so it is atomic under READ COMMITTED; no counter is ever read into JavaScript and written back. The second `UPDATE` is a no-op unless the boolean actually flips, so `products` pages stay clean.

**Drift detection and repair** — `reconciliation/stock-reconciler.service.ts`, `@Interval(STOCK_RECONCILE_INTERVAL_MS)` (default 60 000), also exposed as `POST /admin/reconcile/stock`:

```sql
WITH actual AS (
  SELECT product_id, count(*)::int AS cnt
  FROM stock_keys WHERE status = 'available'
  GROUP BY product_id
)
UPDATE sku_stock s
SET available_count = COALESCE(a.cnt, 0), updated_at = now(), last_reconciled_at = now()
FROM products p
LEFT JOIN actual a ON a.product_id = p.id
WHERE s.product_id = p.id
  AND p.fulfillment_mode = 'pool'
  AND s.available_count <> COALESCE(a.cnt, 0)
RETURNING s.product_id, s.available_count;

-- then, for the products just repaired:
UPDATE products p
SET in_stock = (s.available_count > 0), updated_at = now()
FROM sku_stock s
WHERE s.product_id = p.id AND p.in_stock <> (s.available_count > 0);
```

Every repaired row emits `reconcile.drift_repaired` at WARN with `{sku, from, to}` — drift must be visible, not silently fixed. Supplier-mode products are excluded (no local ground truth exists for them). The aggregate is served by `idx_stock_keys_available`.

### 8.3 The benchmark

`tools/src/seed-bench.ts` — idempotent, `TRUNCATE`s only `BENCH-%` data, runs inside one transaction, ends with `VACUUM ANALYZE`:

```sql
INSERT INTO products (sku, name, type, price_minor, currency, image_url, fulfillment_mode, is_active, in_stock)
SELECT 'BENCH-' || lpad(g::text, 6, '0'),
       'Bench товар ' || g,
       t.type,
       ((100 + (g % 5000)) * 100)::bigint,
       'RUB',
       'assets/bench.png',
       CASE WHEN t.type = 'key' THEN 'pool' ELSE 'supplier' END,
       TRUE,
       TRUE
FROM generate_series(1, 50000) g
CROSS JOIN LATERAL (
  SELECT (ARRAY['key','topup','subscription','giftcard'])[1 + (g % 4)] AS type
) t
ON CONFLICT (sku) DO NOTHING;

INSERT INTO sku_stock (product_id, available_count)
SELECT p.id, CASE WHEN p.fulfillment_mode = 'pool' THEN 40 ELSE 1000 END
FROM products p WHERE p.sku LIKE 'BENCH-%'
ON CONFLICT (product_id) DO UPDATE SET available_count = EXCLUDED.available_count;

-- 12 500 pool SKUs x 40 = 500 000 keys
INSERT INTO stock_keys (product_id, code, status, batch)
SELECT p.id,
       'BK-' || to_char(p.id, 'FM000000') || '-' || to_char(k, 'FM0000'),
       'available',
       'bench'
FROM products p
CROSS JOIN generate_series(1, 40) k
WHERE p.sku LIKE 'BENCH-%' AND p.fulfillment_mode = 'pool'
ON CONFLICT (product_id, code) DO NOTHING;

VACUUM ANALYZE products;
VACUUM ANALYZE sku_stock;
VACUUM ANALYZE stock_keys;
```

The `VACUUM ANALYZE` is not optional: without a current visibility map the designed plan degrades from `Index Only Scan (Heap Fetches: 0)` to one with heap fetches, and the whole point of the `INCLUDE` columns is lost.

`tools/src/bench-explain.ts` runs both queries under `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` five times each (first run discarded as cache warm-up), prints the plans, and writes a ready-to-paste Markdown block for README §7.

**Query A — naive** (aggregate on the fly + offset pagination):

```sql
SELECT p.id, p.sku, p.name, p.type, p.price_minor, p.currency, p.image_url,
       (SELECT count(*) FROM stock_keys k
        WHERE k.product_id = p.id AND k.status = 'available') AS available_count
FROM products p
WHERE p.is_active
ORDER BY p.sku
OFFSET 40000 LIMIT 24;
```

Expected plan nodes, to be stated in the README: `Limit` → `Sort (Sort Method: external merge, Disk: ~N kB)` → `Seq Scan on products (rows=50000)` with a correlated `SubPlan 1` containing `Aggregate` → `Index Only Scan using idx_stock_keys_available` executed **50 000 times**. `Buffers: shared hit + read` in the hundreds of thousands. Execution time in the hundreds of milliseconds to seconds. The three pathologies to name explicitly: the aggregate runs for every catalog row rather than for the 24 returned; the sort materialises the entire catalog; `OFFSET` discards 40 000 finished rows.

**Query B — designed** (§8.1, `type=NULL`, `in_stock=true`, cursor at the 40 000th SKU):

Expected plan nodes: `Limit (rows=25)` → `Nested Loop` → outer `Index Only Scan using idx_products_storefront_instock` with `Index Cond: ((sku, id) > (...))`, `Heap Fetches: 0`, `rows=25`; inner `Index Scan using sku_stock_pkey`, `loops=25`. **No `Sort` node** (the index already provides the order), **no `SubPlan`**, **no `Seq Scan`**. `Buffers: shared hit` in the low tens. Execution time sub-millisecond, and — the point worth stating — **independent of both catalog size and page depth**, which the script demonstrates by running it at cursor depth 1 and ~49 000.

README §7.4 must state the one-sentence explanation: *ordering comes from the index instead of a sort, the cursor replaces the discarded prefix, the partial predicate keeps only sellable rows in the index, `INCLUDE` removes the heap visit, and the counter is read once per returned row instead of once per catalog row.*

---

