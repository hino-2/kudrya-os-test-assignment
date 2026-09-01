## 13. Dependency budget

### Production (`apps/api`)

| Package | Why it is unavoidable | What it replaces |
|---|---|---|
| `@nestjs/common`, `@nestjs/core` | The framework is a fixed stack decision. | — |
| `@nestjs/platform-express` | HTTP adapter. Express is Nest's default and battle-tested; Fastify would be a gratuitous swap with no measured need. | a hand-rolled `node:http` server |
| `reflect-metadata` | Hard peer requirement of Nest's DI and of `emitDecoratorMetadata`. | — |
| `rxjs` | Hard peer requirement of `@nestjs/core`. Not used in application code. | — |
| `@nestjs/typeorm`, `typeorm` | Fixed stack decision. Used for entity mapping, the `DataSource`, `QueryRunner` transactions and the migration runner. All hot/locking paths use `queryRunner.query` with raw SQL. | hand-rolled migration runner + connection/transaction management |
| `pg` | The PostgreSQL driver. `typeorm` cannot talk to Postgres without it. | — |
| `@nestjs/config` | `.env` loading plus DI-injectable typed config, which every integration test overrides per-app-instance. Its only transitive dependency is `dotenv`. Validation is our own 60-line function — **no `joi`, no `zod`.** | `dotenv` directly + a hand-rolled DI provider |
| `@nestjs/schedule` | Fixed stack decision: it drives the worker loop, the sweeper and the stock reconciler. | `setInterval` plus hand-rolled lifecycle/shutdown handling |
| `class-validator` | Declarative DTO validation behind the global `ValidationPipe`; the Nest-idiomatic path. ~9 endpoints, ~14 DTOs. | ~350 lines of hand-rolled validators with worse error messages |
| `class-transformer` | Required peer of `ValidationPipe` for `transform: true` and query-string coercion. | manual `plainToInstance` equivalents |

**Ten production packages, four of which are framework peers.** Explicitly **not** added, with the built-in used instead:

| Rejected | Built-in used instead |
|---|---|
| `axios` / `node-fetch` / `got` / `undici` (direct) | global `fetch` (Node 22 core) + `AbortSignal.timeout` |
| `uuid` | `crypto.randomUUID()` |
| `pino` / `winston` / `nestjs-pino` | `LoggerService` + a ~70-line `JsonLogger` |
| `bullmq` / `ioredis` / `redis` | the `jobs` table + `FOR UPDATE SKIP LOCKED` |
| `lodash` / `ramda` | ES2023 stdlib |
| `dayjs` / `date-fns` / `luxon` | `Date` + `toISOString()`; all interval maths is done in SQL |
| `joi` / `zod` (for env) | `env.validation.ts` |
| `p-retry` / `async-retry` | `backoff.util.ts` (12 lines, unit-tested) |
| `nestjs-cls` | `AsyncLocalStorage` (`node:async_hooks`) |
| `@nestjs/terminus` | a 40-line `HealthController` |
| `@nestjs/swagger` | not required by the assignment; the API is documented as a table in README §1.5 |
| `helmet` / `compression` / `cors` | no browser client exists |

### Production (`apps/supplier-stub`)

`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`, `class-validator`, `class-transformer` — **all already in the tree**, deduplicated by the workspace root. The stub adds **zero new packages**: persistence is `node:fs`, code generation is `node:crypto`, hanging is `setTimeout` in a promise.

### Production (`tools`)

**None.** `pg` is consumed via the workspace root; HTTP uses global `fetch`; CLI parsing uses `node:util` `parseArgs`.

### Development (root)

| Package | Why | What it replaces |
|---|---|---|
| `typescript` | the language | — |
| `@types/node` | Node built-in typings under `strict` | — |
| `@types/express` | typing `Request` in the correlation middleware | `any` (forbidden under `strict`) |
| `tsx` | **the single TS runner** for `tools/**` scripts and the TypeORM CLI (`tsx node_modules/typeorm/cli.js`) | `ts-node` **and** a separate build step for scripts — one package instead of two |
| `vitest` | fixed stack decision | — |
| `unplugin-swc`, `@swc/core` | Vitest's esbuild cannot emit `emitDecoratorMetadata`, which Nest DI requires; SWC can. Fixed stack decision. | a `ts-jest` toolchain |
| `@nestjs/testing` | `Test.createTestingModule` for booting apps with per-test env overrides | hand-rolled DI container assembly |
| `eslint`, `@eslint/js`, `typescript-eslint` | flat config + the mandated `padding-line-between-statements` rule | — |
| `prettier`, `eslint-config-prettier` | formatting, and turning off ESLint rules that fight it | — |

**Not added:** `@nestjs/cli` (the build is plain `tsc -p tsconfig.build.json`; the CLI only wraps it and pulls a large tree), `supertest` (`app.listen(0)` + global `fetch` gives a more honest race test over real sockets), `testcontainers` (excluded by the stack decision; `docker compose` + a CI service container is used), `ts-node` (replaced by `tsx`), `husky`/`lint-staged` (CI is the gate).

---

