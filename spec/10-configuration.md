## 10. Configuration

**Decision: `@nestjs/config` with a hand-written validator.** `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] })`, wrapped by a typed `AppConfigService` exposing structured getters (`db`, `supplier`, `jobs`, `sweeper`, `logging`, `admin`) — no raw `process.env` access anywhere outside `env.validation.ts`, enforced by an ESLint `no-restricted-properties` rule. Rejected: `joi`/`zod` for validation (a 60-line hand-written validator with explicit Russian error messages is smaller and clearer than the schema plus its dependency); rejected: fully hand-rolled config on Node 22's `process.loadEnvFile()` (saves one tiny dependency but loses DI-integrated, testable config overrides, which every integration test needs).

`validateEnv` fails fast at boot with a single aggregated error listing every bad variable — never a partial start.

### 10.1 `apps/api`

| Var | Type | Default | Meaning |
|---|---|---|---|
| `NODE_ENV` | `development\|test\|production` | `development` | environment |
| `PORT` | int | `3000` | HTTP port |
| `DATABASE_URL` | url | — | **required**; `postgres://user:pass@host:5432/db` |
| `DB_POOL_SIZE` | int 1..100 | `20` | TypeORM pool max |
| `DB_STATEMENT_TIMEOUT_MS` | int | `10000` | session `statement_timeout` — a runaway query can never hold a lock forever |
| `DB_LOCK_TIMEOUT_MS` | int | `5000` | session `lock_timeout` — bounds `FOR UPDATE` waits under the 50-way race |
| `DB_TX_RETRY_ATTEMPTS` | int | `3` | retries on SQLSTATE `40001`/`40P01` |
| `LOG_LEVEL` | `debug\|info\|warn\|error` | `info` | minimum level |
| `LOG_FORMAT` | `json\|pretty` | `json` | output format |
| `LOG_STACK` | bool | `false` | include stack traces |
| `SUPPLIER_A_BASE_URL` | url | `http://localhost:4001` | supplier A |
| `SUPPLIER_B_BASE_URL` | url | `http://localhost:4002` | supplier B |
| `SUPPLIER_REQUEST_TIMEOUT_MS` | int 100..30000 | `2000` | `AbortSignal.timeout` per call |
| `SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER` | int 1..5 | `2` | definitive-failure retries per supplier |
| `SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS` | int 1..10 | `5` | resolution attempts before `abandoned_unknown` |
| `SUPPLIER_RETRY_BASE_MS` | int | `200` | in-call backoff base |
| `SUPPLIER_RETRY_MAX_MS` | int | `2000` | in-call backoff cap |
| `SUPPLIER_JOB_BUDGET_MS` | int | `10000` | wall-clock budget for one delivery job |
| `SUPPLIER_VIRTUAL_STOCK` | int | `1000` | seeded `available_count` for supplier-mode SKUs |
| `WORKER_ENABLED` | bool | `true` | run the job loop in this process |
| `WORKER_ID` | string | `hostname:pid` | written to `jobs.locked_by` |
| `JOB_POLL_INTERVAL_MS` | int 20..60000 | `200` | claim loop period |
| `JOB_BATCH_SIZE` | int 1..100 | `5` | jobs claimed per cycle |
| `JOB_MAX_ATTEMPTS` | int 1..20 | `8` | before a job is `dead` |
| `JOB_RETRY_BASE_MS` | int | `500` | job backoff base |
| `JOB_RETRY_MAX_MS` | int | `30000` | job backoff cap |
| `JOB_LOCK_TTL_MS` | int | `120000` | stale-lock reclaim threshold |
| `SWEEPER_ENABLED` | bool | `true` | run the sweeper here |
| `SWEEPER_INTERVAL_MS` | int | `15000` | sweeper period |
| `SWEEPER_BATCH_SIZE` | int | `100` | rows per pass |
| `STUCK_ORDER_AGE_SECONDS` | int | `60` | paid-but-undelivered threshold |
| `DELIVERY_FAILED_RETRY_SECONDS` | int | `300` | `delivery_failed` retry age |
| `MAX_DELIVERY_GENERATIONS` | int | `5` | auto-retry generations cap |
| `ATTEMPT_INFLIGHT_TIMEOUT_MS` | int | `30000` | `in_flight` → `unknown` demotion age |
| `ORPHAN_TTL_SECONDS` | int | `3600` | orphan → `abandoned` age |
| `STOCK_RECONCILE_INTERVAL_MS` | int | `60000` | drift-repair period |
| `ADMIN_API_ENABLED` | bool | `true` | expose `/admin/*` |
| `ADMIN_TOKEN` | string | `dev-admin-token` | `x-admin-token` value; empty disables the guard |
| `CATALOG_DEFAULT_LIMIT` | int | `24` | catalog page size |
| `CATALOG_MAX_LIMIT` | int | `100` | catalog page cap |

### 10.2 `apps/supplier-stub`

| Var | Type | Default | Meaning |
|---|---|---|---|
| `SUPPLIER_ID` | `A\|B` | `A` | identity; prefixes codes and log lines |
| `PORT` | int | `4001` | HTTP port (B: `4002`) |
| `STUB_INVENTORY_SIZE` | int | `100` | codes this instance can mint |
| `STUB_FAIL_RATE` | float 0..1 | `0.2` (A) / `0.1` (B) | `normal`-mode 5xx probability |
| `STUB_TIMEOUT_RATE` | float 0..1 | `0.2` (A) / `0.05` (B) | `normal`-mode hang probability |
| `STUB_SLOW_RATE` | float 0..1 | `0.3` (A) / `0.2` (B) | `normal`-mode slow-but-successful probability |
| `STUB_LATENCY_MS_MIN` | int | `500` | slow-mode floor (must stay < client timeout) |
| `STUB_LATENCY_MS_MAX` | int | `1500` | slow-mode ceiling |
| `STUB_HANG_MS` | int | `6000` | hang duration (must exceed client timeout) |
| `STUB_PERSIST_PATH` | path | `./.stub-state-${SUPPLIER_ID}.json` | `request_id → code` persistence; empty disables |
| `STUB_CONTROL_ENABLED` | bool | `true` | expose `/_control/*` |
| `LOG_LEVEL` / `LOG_FORMAT` | | as API | |

### 10.3 `tools`

`API_BASE_URL` (`http://localhost:3000`), `SUPPLIER_A_BASE_URL`, `SUPPLIER_B_BASE_URL`, `ADMIN_TOKEN`, `DATABASE_URL` (seed scripts only), plus per-script CLI flags parsed with `node:util` `parseArgs` — no CLI-parsing dependency.

`.env.example` lists every variable above, grouped by service, each with a one-line Russian comment. Docker Compose sets rates to the defaults above; **CI and integration tests force all three rates to `0`.**

---

