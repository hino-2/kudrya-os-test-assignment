## 12. Implementation plan for the developer agents

**Target developer: `backend-developer` only.** There is no frontend in this assignment (`requirements.md:33` — «Фронтенд не нужно»). No `frontend-developer`, no `frontend-code-reviewer`, at any step.

**Two lanes exist and are named**, because some steps can run in parallel:

- **Lane A (primary):** `apps/api/**`, `apps/api/src/migrations/**`, `apps/api/test/**`, root config files, `docker-compose.yml`, `Dockerfile`, `.github/**`, **and `README.md` exclusively**.
- **Lane B (secondary):** `apps/supplier-stub/**` and `tools/**`. **Lane B never edits `README.md`** except in the two steps explicitly granted a section below, and those two steps are never parallel with each other.

**README rule for every step:** the step ends by filling **only** its declared README section(s), in place, under headings that already exist from step 1. A step with `README: —` must not touch the file. Two steps that run in parallel are guaranteed disjoint here.

**Comment rule for every step:** §2.1.1 applies. Rationale goes in README, not in comments.

### Phase 0 — foundation

| # | Step | Deliverable | Acceptance check | README section owned | Parallel |
|---|---|---|---|---|---|
| **1** | Workspace bootstrap | Root `package.json` (workspaces + scripts), `tsconfig.base.json`, `eslint.config.mjs` (incl. `padding-line-between-statements` and `no-restricted-properties` on `process.env`), `.prettierrc.json`, `.gitignore`, `.editorconfig`, `.env.example`, `docker-compose.yml`, `Dockerfile`, `.github/workflows/ci.yml`, **`README.md` with all §2.2.2 headings present and `<!-- TODO -->` placeholders**, `DECISIONS.md` stub | `npm ci` clean; `npm run lint` passes on an empty tree; `docker compose up -d postgres` healthy; `npm run typecheck` passes | creates **all** headings; fills **§1.3 Карта сервисов и портов**, **§1.4 Переменные окружения** | — |
| **2** | API skeleton | `apps/api` package, `main.ts`, `app.module.ts`, `common/config/*`, `common/logging/*` (JsonLogger, AppLogger, AsyncLocalStorage correlation, middleware), `common/errors/*`, `common/db/*` (DataSource, UnitOfWork, pg error codes, BIGINT type parser), `common/money/*`, `common/http/health.controller.ts` | `npm run -w apps/api build`; `GET /health` → 200; a log line is valid JSON containing `trace_id`; boot fails loudly on a missing `DATABASE_URL` | **§5.7** (logging, first two entries), **§1.2** (local run) | — |

### Phase 1 — stage 1: API core

| # | Step | Deliverable | Acceptance check | README section owned | Parallel |
|---|---|---|---|---|---|
| **3** | Schema | Migrations 1–4 verbatim from §3 (all columns, constraints, indexes), all TypeORM entities (mapping only — **constraints live in migrations, never in decorators**) | `npm run migration:run` clean on an empty DB; `migration:revert` clean; a psql `\d+` of every table matches §3; `migration:run` twice is idempotent | **§5.1** (money representation, ext_id, double-entry tables) | — |
| **4** | Catalog + seed | `catalog/*` (controller, service, repository, DTOs, entities wired), `tools/src/seed-catalog.ts` (12 SKUs, 50 keys 20/20/10, `sku_stock`, `in_stock`) | `npm run seed:catalog`; `GET /catalog` returns 12 items with correct `amount_minor`; `GET /catalog/KEY-GTA5` → 200; `GET /catalog/NOPE` → 404 | **§5.6** (pool vs supplier fulfilment modes) | — |
| **5** | Orders + state machine | `orders/*`: `order-state-machine.ts`, `TRANSITION_TABLE`, `OrdersRepository.transition` (CAS UPDATE), `lockForUpdate`, controller, DTOs, ext_id generation, `client_order_id` idempotency; `test/unit/order-state-machine.spec.ts` | `npm run -w apps/api test:unit` green (63 transition cases); `POST /orders` → 201, replay → 200 identical; `GET /orders/:id` → 200; bad sku → 404 | **§5.2** first entry (guarded transitions, single writer) | — |
| **6** | Ledger | `ledger/*`: `postTxn` with pre-write balance assertion, entities, accounts, txn kinds, idempotency keys | Unit test: unbalanced input throws `LEDGER_UNBALANCED`; duplicate idempotency key returns `null` and writes nothing | **§5.1** append (double-entry rationale, chart of accounts) | — |
| **7** | Payment webhook | `payments/*`: controller, `PaymentWebhookService` implementing the §5.1 transaction exactly (ON CONFLICT gate → FOR UPDATE → amount guard → staleness guard → transition → ledger → job enqueue → finalise), DTOs, event states | `POST /webhooks/payment` twice with one `event_id` → `applied` then `duplicate`, zero side effects on the second; unknown order → `orphan`; `failed` → `payment_failed`; amount mismatch → `rejected_amount` | **§5.2** append, **§5.3** (out-of-order policy table, incl. the status-code table from §9.4) | — |
| **8** | Job queue + worker | `jobs/*`: `JobQueueService` (enqueue with the partial-index `ON CONFLICT ... WHERE`, claim with `FOR UPDATE SKIP LOCKED`, complete/fail with persisted backoff), `JobWorkerService` (`@Interval`, re-entrancy guard, `runOnce()`), handler registry, `backoff.util.ts` + its unit test | Unit: backoff bounds. Integration: 20 concurrent `enqueue` calls with one dedupe key → 1 row; two `runOnce()` in parallel never claim the same job | **§5.4** (Postgres job table instead of Redis/BullMQ; rejected alternative) | — |
| **9** | Pool delivery | `delivery/*` orchestrator + `pool-fulfilment.service.ts` (TX-P exactly per §5.6), `inventory/*` (SKIP LOCKED reservation, idempotent re-entry, counter + `in_stock` statement), `deliver-order.handler.ts` | End-to-end for `KEY-GTA5`: order → paid → delivered; exactly 1 `issued_deliveries`, 1 reserved key, `available_count` −1; drained stock → `out_of_stock`, job `done` not `dead` | **—** (its entry is written by step 12) | **‖ 10** |
| **10** | Supplier stub (Lane B) | `apps/supplier-stub/**` complete per §6.6: `/issue` with request_id precedence, `GET /issue/:id`, `/inventory`, `/_control/*`, all scenario modes, file persistence, `test/issue.spec.ts` | `npm run -w apps/supplier-stub test` green; same `request_id` 100× → same code; state survives restart; every mode behaves as tabulated | **§4.4** (stand control: modes + env rates) | **‖ 9** |
| **11** | Webhook & race tools (Lane B) | `tools/src/lib/*`, `tools/src/webhook.ts`, `tools/src/race.ts` (50 distinct `event_id`, `Promise.all`, PASS/FAIL table, post-run SQL checks) | `npm run webhook -- --order ord_1 --status paid --amount 500` works; `npm run race -- --order ord_1 --count 50` prints PASS against a running stack | **§3** (race reproduction, complete) | **after 10** |

Stage 1 is demonstrably delivered after step 9.

### Phase 2 — stage 3: resilient integrations

| # | Step | Deliverable | Acceptance check | README section owned | Parallel |
|---|---|---|---|---|---|
| **12** | Supplier client | `suppliers/*`: `supplier-client.service.ts` (global `fetch` + `AbortSignal.timeout`, the full §6.1 classification table), `supplier-registry.service.ts` (`FALLBACK_CHAIN`), `request-id.util.ts`, constants/types/interfaces; unit tests for classification and request-id | `npm run -w apps/api test:unit` green; every §6.1 row asserted; `buildRequestId('ord_00123','A',1) === 'req_ord_00123_A_1'` | **§5.5** first half (timeout ≠ failure, request_id formula, error classification) **and** step 9's deferred entry in **§5.6** | — |
| **13** | Supplier fulfilment | `supplier-fulfilment.service.ts` (TX-S1 / HTTP outside any transaction / TX-S2 / TX-S3), `attempt-resolver.service.ts` (channel 1 `GET`, channel 2 re-`POST`, `abandoned_unknown`), `resolve-unknown-attempt.handler.ts`, fallback rule per §6.4 | Integration: `issue_then_hang` → 1 attempt, 1 delivery, 1 minted code; closed port for A → 2 attempts, delivery from B, distinct `request_id`s; both `out_of_stock` → order `out_of_stock` | **§5.5** second half (record-before-call, unknown resolution, fallback rule + why B gets a different id, why no circuit breaker), **§4.1**, **§4.2** | — |

### Phase 3 — stage 4: reconciliation, observability, recovery

| # | Step | Deliverable | Acceptance check | README section owned | Parallel |
|---|---|---|---|---|---|
| **14** | Reconciliation endpoints | `reconciliation/*` controller + service with the §7.2 and §7.4 SQL verbatim, DTOs | All seven endpoints return 200 with the documented shapes; on a healthy dataset every anomaly list is empty and `ledger-balance.balanced === true` | **§5.7** append (reconciliation endpoints, the two flagship queries) | **‖ 16** |
| **15** | Sweeper + admin | `sweeper.service.ts` (6 passes), `stock-reconciler.service.ts`, `admin/*` (guard + all 7 endpoints incl. `jobs/drain`) | Stale `running` job reclaimed; stuck `delivering` requeued; `in_flight` demoted; restock + sweeper delivers an `out_of_stock` order; two concurrent `POST /admin/sweeper/run` produce no duplicate delivery | **§4.3** (empty stock and recovery), **§5.7** append (recovery) | — |

### Phase 4 — stage 5: catalog under load

| # | Step | Deliverable | Acceptance check | README section owned | Parallel |
|---|---|---|---|---|---|
| **16** | Storefront indexes + keyset + benchmark | Migration `1756600000005-StorefrontIndexes.ts`, keyset query in `catalog.repository.ts`, cursor encode/decode, `tools/src/seed-bench.ts`, `tools/src/bench-explain.ts` | `npm run seed:bench` → 50 000 products + 500 000 keys; `npm run bench:explain` prints both plans; designed query shows `Index Only Scan` + `Nested Loop`, **no `Sort`, no `SubPlan`, no `Seq Scan`**, `Heap Fetches: 0`; a full pagination walk visits every SKU exactly once | **§7** entirely (7.1–7.5, with the real captured plans pasted in), **§5.8** | **‖ 14** |

### Phase 5 — acceptance tests and close-out

| # | Step | Deliverable | Acceptance check | README section owned | Parallel |
|---|---|---|---|---|---|
| **17** | Acceptance test suite | All six criterion files plus the supporting files from §11.7, and the harness (`pg`, `app`, `supplier-stub`, `seed`, `wait-for`) | `npm run test` fully green locally and in CI; each of the six criteria is a separately runnable file; total integration runtime < 120 s | **§2** entirely (2.1–2.4, incl. the criterion→test-file→command table) | — |
| **18** | Close-out | `.env.example` final pass, `docker compose up` smoke from a clean checkout, CI green, `DECISIONS.md` linking to README §5/§6/§8 | Clean clone → `docker compose up -d && npm run migration:run && npm run seed:catalog && npm run race` → PASS; CI green on a fresh push | **§1.5** (API table), **§6** (scaling), **§8** (time spent), **§9** (out of scope); final consistency pass over §5 | — |

**Parallelism summary:** exactly two windows — `9 ‖ 10` (then `11` after `10`), and `14 ‖ 16`. In the first window, step 9 owns no README section and step 10 owns only §4.4, so the file has a single writer. In the second window, step 14 owns §5.7 and step 16 owns §7 + §5.8 — disjoint headings, and by the step-1 rule both are pure in-section insertions. Everything else is strictly sequential because each step consumes the previous step's public interface.

**Review gate:** `backend-code-reviewer` runs after every step, on that step's changed files only. `frontend-code-reviewer` is never invoked — there are no frontend files in this repository.

---

