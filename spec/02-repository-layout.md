## 2. Repository layout

**Decision: npm workspaces monorepo, three workspaces.** Rejected alternative: a single package with two entrypoints (`main.ts` + `supplier-main.ts`) — simpler to bootstrap, but it merges the dependency graphs, makes "run lint/test scoped to one workspace" impossible (required by the project's parallel-agent rule), and blurs the boundary that the assignment explicitly wants demonstrable (kill supplier A, API survives).

```
kudrya-os-test-assignment/
├── package.json                              # root: workspaces, orchestration scripts only
├── package-lock.json
├── tsconfig.base.json                        # strict TS settings shared by all workspaces
├── eslint.config.mjs                         # flat config, incl. padding-line-between-statements
├── .prettierrc.json
├── .editorconfig
├── .gitignore
├── .env.example                              # every env var of every service, documented
├── docker-compose.yml                        # postgres + api + supplier-a + supplier-b
├── Dockerfile                                # multi-stage, one image, entrypoint chosen by CMD
├── README.md                                 # FIRST-CLASS DELIVERABLE — see §2.2 for exact sections
├── DECISIONS.md                              # thin: links to README §5, §6, §8
├── stock/
│   ├── products.json                         # given, 12 SKUs
│   └── keys.json                             # given, 50 keys
├── .github/workflows/ci.yml                  # lint, typecheck, unit, integration (postgres service)
│
├── apps/api/
│   ├── package.json                          # @store/api
│   ├── tsconfig.json / tsconfig.build.json
│   ├── vitest.config.ts                      # unplugin-swc, projects: unit + integration
│   ├── src/
│   │   ├── main.ts                           # bootstrap, ValidationPipe, JsonLogger, shutdown hooks
│   │   ├── app.module.ts                     # composition root
│   │   │
│   │   ├── common/
│   │   │   ├── config/
│   │   │   │   ├── config.module.ts          # @nestjs/config forRoot({ validate, isGlobal })
│   │   │   │   ├── app-config.service.ts     # typed getters over ConfigService
│   │   │   │   ├── env.validation.ts         # hand-written validator (no joi/zod)
│   │   │   │   ├── config.constants.ts       # env var names + defaults
│   │   │   │   ├── config.type.ts            # AppEnv, EnvRaw
│   │   │   │   └── config.interfaces.ts      # IDbConfig, ISupplierConfig, IJobConfig...
│   │   │   ├── logging/
│   │   │   │   ├── logging.module.ts
│   │   │   │   ├── json-logger.ts            # implements LoggerService, one JSON line per record
│   │   │   │   ├── app-logger.service.ts     # .event(name, data, level) API, reads correlation
│   │   │   │   ├── correlation.store.ts      # AsyncLocalStorage<ICorrelation>
│   │   │   │   ├── correlation.middleware.ts # trace_id from x-request-id or randomUUID
│   │   │   │   ├── logging.constants.ts      # LOG_EVENT.* catalogue, LOG_LEVELS
│   │   │   │   ├── logging.type.ts           # LogLevel, LogEventName
│   │   │   │   └── logging.interfaces.ts     # ILogRecord, ICorrelation
│   │   │   ├── db/
│   │   │   │   ├── database.module.ts        # TypeOrmModule.forRootAsync
│   │   │   │   ├── data-source.ts            # DataSource for TypeORM CLI + app
│   │   │   │   ├── unit-of-work.service.ts   # withTransaction(fn(qr)), READ COMMITTED
│   │   │   │   ├── pg-error.util.ts          # isUniqueViolation(e), PG error codes
│   │   │   │   ├── db.constants.ts           # PG_ERROR_CODE.*, ISOLATION_LEVEL
│   │   │   │   ├── db.type.ts
│   │   │   │   └── db.interfaces.ts
│   │   │   ├── money/
│   │   │   │   ├── money.util.ts             # toMinor / toMajor / assertInt
│   │   │   │   ├── money.constants.ts        # MINOR_UNITS_PER_MAJOR, SUPPORTED_CURRENCIES
│   │   │   │   └── money.type.ts             # MinorAmount, CurrencyCode
│   │   │   ├── errors/
│   │   │   │   ├── domain.error.ts           # DomainError(code, message, details, httpStatus)
│   │   │   │   ├── domain-error.filter.ts    # ExceptionFilter -> unified error envelope
│   │   │   │   ├── errors.constants.ts       # ERROR_CODE.*
│   │   │   │   └── errors.interfaces.ts      # IErrorEnvelope
│   │   │   └── http/
│   │   │       ├── health.controller.ts      # GET /health, GET /health/ready
│   │   │       └── health.interfaces.ts
│   │   │
│   │   ├── catalog/
│   │   │   ├── catalog.module.ts
│   │   │   ├── catalog.controller.ts         # GET /catalog, GET /catalog/:sku
│   │   │   ├── catalog.service.ts
│   │   │   ├── catalog.repository.ts         # raw keyset SQL
│   │   │   ├── entities/product.entity.ts
│   │   │   ├── entities/sku-stock.entity.ts
│   │   │   ├── dto/list-catalog.query.dto.ts
│   │   │   ├── dto/catalog-item.response.dto.ts
│   │   │   ├── dto/catalog-page.response.dto.ts
│   │   │   ├── catalog.constants.ts          # DEFAULT_LIMIT, MAX_LIMIT, CURSOR_SEPARATOR
│   │   │   ├── catalog.type.ts               # ProductType, FulfillmentMode, CatalogCursor
│   │   │   └── catalog.interfaces.ts         # ICatalogFilter, ICatalogRow
│   │   │
│   │   ├── orders/
│   │   │   ├── orders.module.ts
│   │   │   ├── orders.controller.ts          # POST /orders, GET /orders/:orderId
│   │   │   ├── orders.service.ts
│   │   │   ├── orders.repository.ts          # lockForUpdate, transition (CAS UPDATE)
│   │   │   ├── order-state-machine.ts        # THE single guarded transition function
│   │   │   ├── entities/order.entity.ts
│   │   │   ├── dto/create-order.request.dto.ts
│   │   │   ├── dto/order.response.dto.ts
│   │   │   ├── orders.constants.ts           # ORDER_STATUS, ORDER_EVENT, TRANSITION_TABLE, EXT_ID_REGEX
│   │   │   ├── orders.type.ts                # OrderStatus, OrderEvent, TransitionResult
│   │   │   └── orders.interfaces.ts          # IOrderRow, ITransitionRule
│   │   │
│   │   ├── payments/
│   │   │   ├── payments.module.ts
│   │   │   ├── payment-webhook.controller.ts # POST /webhooks/payment
│   │   │   ├── payment-webhook.service.ts    # the exactly-once ingest transaction
│   │   │   ├── payment-events.repository.ts
│   │   │   ├── entities/payment-event.entity.ts
│   │   │   ├── dto/payment-webhook.request.dto.ts
│   │   │   ├── dto/payment-webhook.response.dto.ts
│   │   │   ├── payments.constants.ts         # PAYMENT_EVENT_STATE, PAYMENT_STATUS, IGNORE_REASON
│   │   │   ├── payments.type.ts
│   │   │   └── payments.interfaces.ts
│   │   │
│   │   ├── ledger/
│   │   │   ├── ledger.module.ts
│   │   │   ├── ledger.service.ts             # postTxn(qr, {idempotencyKey, kind, legs})
│   │   │   ├── entities/ledger-txn.entity.ts
│   │   │   ├── entities/ledger-entry.entity.ts
│   │   │   ├── ledger.constants.ts           # ACCOUNT.*, DIRECTION.*, LEDGER_TXN_KIND.*
│   │   │   ├── ledger.type.ts                # Account, Direction
│   │   │   └── ledger.interfaces.ts          # ILedgerLeg, IPostTxnInput, IBalanceRow
│   │   │
│   │   ├── inventory/
│   │   │   ├── inventory.module.ts
│   │   │   ├── stock.service.ts              # reserveKey, releaseKey, applyIssue, restock
│   │   │   ├── stock.repository.ts           # SKIP LOCKED reservation SQL, counter SQL
│   │   │   ├── entities/stock-key.entity.ts
│   │   │   ├── inventory.constants.ts        # STOCK_KEY_STATUS
│   │   │   ├── inventory.type.ts
│   │   │   └── inventory.interfaces.ts       # IReservedKey
│   │   │
│   │   ├── suppliers/
│   │   │   ├── suppliers.module.ts
│   │   │   ├── supplier-client.service.ts    # fetch + AbortSignal.timeout + error classification
│   │   │   ├── supplier-registry.service.ts  # A/B base URLs, ordered fallback chain
│   │   │   ├── request-id.util.ts            # buildRequestId()
│   │   │   ├── backoff.util.ts               # nextDelayMs()
│   │   │   ├── suppliers.constants.ts        # SUPPLIER_CODE, SUPPLIER_ERROR_KIND, FALLBACK_CHAIN
│   │   │   ├── suppliers.type.ts             # SupplierCode, SupplierErrorKind
│   │   │   └── suppliers.interfaces.ts       # IIssueRequest, IIssueOk, IIssueError, ISupplierOutcome
│   │   │
│   │   ├── delivery/
│   │   │   ├── delivery.module.ts
│   │   │   ├── delivery.service.ts           # orchestrator: mode dispatch + finalization
│   │   │   ├── pool-fulfilment.service.ts    # pool mode, single TX
│   │   │   ├── supplier-fulfilment.service.ts# supplier mode, TX1 / HTTP / TX2 / TX3
│   │   │   ├── attempt-resolver.service.ts   # unknown -> succeeded|not_issued|abandoned
│   │   │   ├── delivery-attempts.repository.ts
│   │   │   ├── issued-deliveries.repository.ts
│   │   │   ├── entities/delivery-attempt.entity.ts
│   │   │   ├── entities/issued-delivery.entity.ts
│   │   │   ├── delivery.constants.ts         # ATTEMPT_STATE, DELIVERY_OUTCOME, FAIL_REASON
│   │   │   ├── delivery.type.ts
│   │   │   └── delivery.interfaces.ts        # IDeliveryContext, IDeliveryResult
│   │   │
│   │   ├── jobs/
│   │   │   ├── jobs.module.ts
│   │   │   ├── job-queue.service.ts          # enqueue (ON CONFLICT), claim, complete, fail
│   │   │   ├── job-worker.service.ts         # @Interval loop, re-entrancy guard, runOnce()
│   │   │   ├── job-handler.registry.ts
│   │   │   ├── handlers/deliver-order.handler.ts
│   │   │   ├── handlers/resolve-unknown-attempt.handler.ts
│   │   │   ├── entities/job.entity.ts
│   │   │   ├── jobs.constants.ts             # JOB_KIND, JOB_STATE, defaults
│   │   │   ├── jobs.type.ts
│   │   │   └── jobs.interfaces.ts            # IJobRow, IJobHandler, IDeliverOrderPayload
│   │   │
│   │   ├── reconciliation/
│   │   │   ├── reconciliation.module.ts
│   │   │   ├── reconciliation.controller.ts  # GET /reconciliation/*
│   │   │   ├── reconciliation.service.ts     # the report SQL
│   │   │   ├── sweeper.service.ts            # @Interval stuck-order sweeper
│   │   │   ├── stock-reconciler.service.ts   # @Interval counter drift repair
│   │   │   ├── dto/*.response.dto.ts
│   │   │   ├── reconciliation.constants.ts   # thresholds, SQL fragment names
│   │   │   ├── reconciliation.type.ts
│   │   │   └── reconciliation.interfaces.ts
│   │   │
│   │   ├── admin/
│   │   │   ├── admin.module.ts
│   │   │   ├── admin.controller.ts           # restock, redeliver, force-paid, drain, run-sweeper
│   │   │   ├── admin.service.ts
│   │   │   ├── admin-token.guard.ts
│   │   │   ├── dto/*.dto.ts
│   │   │   ├── admin.constants.ts            # ADMIN_TOKEN_HEADER
│   │   │   └── admin.interfaces.ts
│   │   │
│   │   └── migrations/
│   │       ├── 1756600000001-InitCore.ts          # products, sku_stock, stock_keys, orders, seq
│   │       ├── 1756600000002-InitPayments.ts      # payment_events, ledger_txns, ledger_entries
│   │       ├── 1756600000003-InitDelivery.ts      # delivery_attempts, issued_deliveries
│   │       ├── 1756600000004-InitJobs.ts          # jobs
│   │       └── 1756600000005-StorefrontIndexes.ts # stage-5 hot-path indexes (droppable for demo)
│   └── test/
│       ├── helpers/pg.helper.ts               # truncate + reset sequences between tests
│       ├── helpers/app.harness.ts             # boots Nest on port 0, returns baseUrl + DataSource
│       ├── helpers/supplier-stub.harness.ts   # boots two stub apps in-process on port 0
│       ├── helpers/wait-for.ts                # waitFor(predicate, timeoutMs, intervalMs)
│       ├── helpers/seed.helper.ts             # loads stock/*.json into the test DB
│       ├── unit/order-state-machine.spec.ts
│       ├── unit/backoff.util.spec.ts
│       ├── unit/request-id.util.spec.ts
│       ├── unit/money.util.spec.ts
│       ├── unit/supplier-error-classification.spec.ts
│       └── integration/
│           ├── webhook-race.e2e.spec.ts            # criterion 1
│           ├── webhook-idempotency.e2e.spec.ts     # criterion 2
│           ├── webhook-out-of-order.e2e.spec.ts    # criterion 3
│           ├── supplier-timeout-trap.e2e.spec.ts   # criterion 4
│           ├── supplier-fallback.e2e.spec.ts       # criterion 5
│           ├── out-of-stock-recovery.e2e.spec.ts   # criterion 6
│           ├── order-lifecycle.e2e.spec.ts         # stage 1
│           ├── ledger-balance.e2e.spec.ts          # stage 4
│           ├── reconciliation.e2e.spec.ts          # stage 4
│           ├── sweeper.e2e.spec.ts                 # stage 4
│           └── catalog-keyset.e2e.spec.ts          # stage 5
│
├── apps/supplier-stub/
│   ├── package.json                          # @store/supplier-stub
│   ├── tsconfig.json / tsconfig.build.json
│   ├── vitest.config.ts
│   └── src/
│       ├── main.ts                           # bootstrap, PORT from env
│       ├── stub.module.ts
│       ├── issue.controller.ts               # POST /issue, GET /issue/:requestId, GET /inventory
│       ├── control.controller.ts             # POST /_control/scenario|reset|restock, GET /_control/state
│       ├── health.controller.ts              # GET /health
│       ├── issue-store.service.ts            # request_id -> code, file-backed
│       ├── scenario.service.ts               # random + forced scenario resolution
│       ├── code-generator.util.ts            # XXXX-XXXX-XXXX from crypto
│       ├── dto/issue.request.dto.ts
│       ├── dto/issue.response.dto.ts
│       ├── dto/set-scenario.request.dto.ts
│       ├── stub.constants.ts                 # STUB_MODE, DEFAULTS, CODE_ALPHABET
│       ├── stub.type.ts                      # StubMode, SupplierId
│       └── stub.interfaces.ts                # IIssueRecord, IScenarioOverride, IStubState
│
└── tools/
    ├── package.json                          # @store/tools
    ├── tsconfig.json
    └── src/
        ├── lib/http.ts                        # tiny fetch wrapper + retry-free POST
        ├── lib/args.ts                        # node:util parseArgs wrapper
        ├── webhook.ts                         # send ONE webhook per contract
        ├── race.ts                            # 50 concurrent webhooks + assertion (criteria 1,2)
        ├── seed-catalog.ts                    # stock/*.json -> DB (+ supplier stub inventory)
        ├── seed-bench.ts                      # 50k SKU / 500k keys via generate_series
        ├── bench-explain.ts                   # EXPLAIN (ANALYZE, BUFFERS) naive vs designed
        └── demo-fallback.ts                   # scripted criterion-5 demo against docker-compose
```

**Root `package.json` scripts** (orchestration only; every real command is workspace-scoped):

```
"lint"                 -> eslint .
"typecheck"            -> npm run -ws typecheck
"build"                -> npm run -ws build
"test:unit"            -> npm run -w apps/api test:unit && npm run -w apps/supplier-stub test
"test:integration"     -> npm run -w apps/api test:integration
"test"                 -> npm run test:unit && npm run test:integration
"migration:run"        -> npm run -w apps/api migration:run
"migration:revert"     -> npm run -w apps/api migration:revert
"seed:catalog"         -> tsx tools/src/seed-catalog.ts
"seed:bench"           -> tsx tools/src/seed-bench.ts
"bench:explain"        -> tsx tools/src/bench-explain.ts
"race"                 -> tsx tools/src/race.ts
"webhook"              -> tsx tools/src/webhook.ts
"demo:fallback"        -> tsx tools/src/demo-fallback.ts
```

### 2.1 Code-style and documentation conventions

#### 2.1.1 Comment policy — minimal

**Developers write a comment ONLY when the code cannot carry the information itself.** Exactly three admissible reasons:

1. A **non-obvious invariant** that the reader cannot derive from the surrounding lines (e.g. "этот `attempt_no` не инкрементируется после таймаута — иначе будет вторая выдача").
2. A **subtle concurrency or ordering constraint** (e.g. "порядок блокировок: orders → delivery_attempts, иначе дедлок").
3. A **workaround** whose reason is invisible in the code (e.g. "ON CONFLICT требует WHERE-предикат, иначе PostgreSQL не выведет частичный индекс").

Concretely, in this codebase the legitimate comment sites are roughly: why `ON CONFLICT` must repeat the partial-index predicate; why a timeout must not advance `attempt_no`; why no transaction may be open across `fetch`; why B gets a different `request_id`.

Explicitly forbidden:
- comments restating what the next line does;
- section banners (`// ---- helpers ----`);
- JSDoc/docblocks on self-explanatory functions, DTOs, controllers, constants files, entities;
- `@param`/`@returns` blocks — TypeScript signatures already state that;
- commented-out code.

If a comment feels needed to explain *what* a function does, rename the function instead. **Design rationale does not go into comments — it goes into `README.md` (§2.2).**

Language, single rule for the whole repo:

| Artifact | Language |
|---|---|
| Identifiers, file names, event names in logs, `error.code` values, DB object names, JSON field names | English |
| The rare code comments permitted above | Russian |
| Human-readable `error.message` returned to API clients | Russian |
| `README.md`, `DECISIONS.md` | Russian (the grader is Russian-speaking) |
| Everything passing between agents (blueprints, hand-off notes, reviewer reports) | English |

#### 2.1.2 File-layout rules (hard requirements)

- Module-level constants → `*.constants.ts` per module. Never inline in an implementation file. This includes SQL string literals, default numbers, header names, enum-like `as const` objects, regexes.
- `type` aliases → `*.type.ts` per module. `interface` declarations → `*.interfaces.ts` per module. Never inline in an implementation file. Applies to controllers, services, modules, config, entity helper types, job payloads, DTO-adjacent shapes, guards, filters, handlers.
- Sole exception: a `*.spec.ts` may declare a test-only helper type inline.
- Blank line after a block of variable declarations and after every closing brace of a block (`if`/`for`/`while`/`switch`/`try`). Consecutive declarations need no blanks between them. Enforced by ESLint:

```js
'padding-line-between-statements': ['error',
  { blankLine: 'always', prev: 'block-like', next: '*' },
  { blankLine: 'always', prev: ['const','let','var'], next: '*' },
  { blankLine: 'any',    prev: ['const','let','var'], next: ['const','let','var'] },
]
```

- TypeScript `strict: true` with no relaxations. Entity and DTO fields use definite assignment (`code!: string`), not `strictPropertyInitialization: false`.

### 2.2 `README.md` — first-class deliverable

`README.md` is the artefact the grader reads first. It is where **every design decision is documented briefly** — one or two lines each, always naming the rejected alternative. It is not a design document; it is a decision log plus a runbook. Target length: 250–350 lines.

#### 2.2.1 Mapping to the requirements' "Что нужно от вас в ответе"

| Requirement (`requirements.md:55-60`) | README section |
|---|---|
| 1. Исходники + README (запуск и прогон тестов) | §1 Быстрый старт, §2 Тесты |
| 2. Как воспроизвести проверку гонок | §3 Воспроизведение гонки (50 вебхуков) |
| 2. Как воспроизвести отказ/фолбэк поставщика | §4 Воспроизведение отказа поставщика и фолбэка A→B |
| 3. Короткая записка: ключевые решения | §5 Ключевые решения |
| 3. Как масштабировали бы под нагрузку | §6 Масштабирование |
| (Этап 5 «коротко объяснить план выполнения») | §7 Каталог под нагрузкой: EXPLAIN ANALYZE |
| 4. Сколько времени ушло по факту | §8 Затраченное время |

#### 2.2.2 Exact section structure

```markdown
# Ядро магазина цифровых товаров

<3–5 строк: что это, какие процессы поднимаются, какие этапы задания закрыты>

## 1. Быстрый старт
### 1.1 Через docker compose        # docker compose up -d; migrate; seed; curl smoke
### 1.2 Локально (Node 22 + внешний Postgres)
### 1.3 Карта сервисов и портов     # таблица: api :3000, supplier-a :4001, supplier-b :4002, postgres :5432
### 1.4 Переменные окружения        # ссылка на .env.example + 6–8 самых важных
### 1.5 API — карта эндпоинтов      # таблица: метод, путь, назначение, коды ответов

## 2. Тесты
### 2.1 Юнит-тесты                  # npm run test:unit — что покрывают
### 2.2 Интеграционные тесты        # npm run test:integration — требуют postgres из compose
### 2.3 Карта критериев приёмки     # таблица: критерий 1..6 -> файл теста -> команда запуска одного теста
### 2.4 Линт / typecheck / CI

## 3. Воспроизведение гонки (50 параллельных вебхуков)
   # команда npm run race -- --order ord_00123 --count 50
   # что скрипт делает, какой вывод ожидать, какие SQL-проверки выполняются после
   # ссылка на автотест webhook-race.e2e.spec.ts
   # почему это валидная проверка гонки (реальный HTTP, реальный Postgres, 50 разных event_id)

## 4. Воспроизведение отказа поставщика и фолбэка A→B
### 4.1 Поставщик A недоступен (docker compose stop supplier-a) -> фолбэк на B
### 4.2 Ловушка таймаута: поставщик выдал код, но ответ не дошёл
   # POST /_control/scenario {"mode":"issue_then_hang","times":1} на стенде A
   # какой request_id пойдёт повторно, как проверить что код один
### 4.3 Пустой остаток и восстановление       # drain -> out_of_stock -> restock -> delivered
### 4.4 Управление стендами                   # таблица режимов _control/scenario и env-долей отказов

## 5. Ключевые решения
   # ~20 пунктов, каждый строго в формате:
   # **<Решение>.** <1–2 строки почему.> Отвергнуто: <альтернатива> — <причина в полстроки>.
### 5.1 Данные и деньги            # BIGINT minor units; двойная запись; ext_id
### 5.2 Exactly-once               # FOR UPDATE на orders; UNIQUE(event_id); UNIQUE(order_id) в issued_deliveries; READ COMMITTED
### 5.3 Вебхуки вне порядка        # orphan / conflict / stale — политика по каждому случаю
### 5.4 Очередь и фоновые задачи   # таблица jobs + SKIP LOCKED вместо Redis/BullMQ
### 5.5 Интеграции и таймауты      # таймаут ≠ отказ; record-before-call; формула request_id; правило фолбэка; почему без circuit breaker
### 5.6 Модель остатков            # pool vs supplier; чем гарантируется «один ключ — один заказ»
### 5.7 Наблюдаемость и сверка     # JSON-логи без сторонней библиотеки; корреляция; эндпоинты сверки
### 5.8 Каталог                    # keyset вместо offset; денормализованный счётчик и флаг in_stock
### 5.9 Зависимости                # таблица из §13 спецификации, коротко

## 6. Масштабирование
   # 8–12 строк: шардирование воркеров, LISTEN/NOTIFY вместо polling, партиционирование
   # payment_events/jobs/ledger_entries по времени, вынос очереди в отдельный сервис,
   # реплика для каталога, кэш витрины, outbox для внешних вызовов, лимиты на поставщика

## 7. Каталог под нагрузкой: EXPLAIN ANALYZE
### 7.1 Стенд                       # 50 000 SKU, ~500 000 ключей, npm run seed:bench
### 7.2 Наивный запрос              # SQL + план + Execution Time + Buffers
### 7.3 Спроектированный запрос     # SQL + план + Execution Time + Buffers
### 7.4 Разбор                      # почему Seq Scan+SubPlan+Sort ушёл, что дал keyset и частичный индекс
### 7.5 Как воспроизвести           # npm run seed:bench && npm run bench:explain

## 8. Затраченное время
   # таблица по этапам 1..5 + итог

## 9. Что осталось за рамками
   # подпись вебхука, мультитоварные заказы, реальные возвраты, circuit breaker, multi-currency
```

**Rule for §5 entries:** exactly the format `**<Decision>.** <why, 1–2 lines.> Отвергнуто: <alternative> — <reason>.` No entry longer than three lines. Every decision that a reviewer could question must have an entry; a decision documented only in code comments is a defect.

#### 2.2.3 README ownership (collision avoidance)

- **`README.md` is owned exclusively by the API lane** (`apps/api` + `migrations` + `tools`). The `apps/supplier-stub` lane never edits it.
- Every implementation step in §12 declares **which README sections it owns**. A step may only edit its declared sections.
- **Two steps that run in parallel are guaranteed by §12 to own disjoint README sections, and at most one of any parallel pair owns any README section at all.**
- Step 1 creates `README.md` with **all headings from §2.2.2 present and empty** (a `<!-- TODO -->` placeholder under each). Later steps fill their own sections in place — never restructure, never reorder headings. This makes every later edit a pure in-section insertion, which cannot conflict.

`DECISIONS.md` is a thin file: it links to `README.md` §5, §6 and §8. It exists because the assignment asks for a "записка" as a separate deliverable; duplicating content between the two files is forbidden.

---

