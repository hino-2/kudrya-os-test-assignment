# Ядро магазина цифровых товаров

Бэкенд магазина цифровых товаров (ключи и пул-товары для геймеров): REST API с приёмом заказов,
вебхуком оплаты, фоновой доставкой через поставщиков-заглушек, сверкой и восстановлением после
сбоев. Поднимается три процесса Node.js (`apps/api`, две инстанции `apps/supplier-stub`) поверх
одной базы PostgreSQL. Ниже — журнал решений и инструкции по запуску; список закрытых этапов
задания обновляется по мере реализации (см. §8).

## 1. Быстрый старт

### 1.0 Автоматизированный запуск всех контейнеров (рекомендуется)

Проект содержит готовые скрипты для запуска всех контейнеров с одной командой.

**На Windows (PowerShell):**

```powershell
.\start.ps1
```

**На Linux/macOS (Bash):**

```bash
chmod +x start.sh
./start.sh
```

Скрипты автоматически:

- Проверят наличие `.env` (создадут из `.env.example`, если нужно)
- Запустят `docker compose up -d`
- Дождутся готовности PostgreSQL и API
- Выведят адреса всех сервисов и примеры проверок

**Миграции запускаются автоматически внутри контейнера `api`** при его старте (через `docker-entrypoint.sh`).

**Сидинг каталога — только по команде:**

```bash
./start.sh --seed  # поднять контейнеры и засеять каталог
```

Флаг `--seed` добавляет в БД:

- **12 товаров (SKU)**: 3 с выдачей из пула ключей (`KEY-*`) и 9 с выдачей через поставщиков (`STEAM-*`)
- **50 ключей для пула**: раскладка 20/20/10 по трём товарам типа `key`

Без флага `--seed` — БД инициализируется пуста (только схема, без товаров и ключей).

> Сидинг выполняется хостовым `npm run seed:catalog`, поэтому перед `--seed` нужен `npm ci` в корне проекта.

### 1.1 Через docker compose (ручной запуск)

```bash
cp .env.example .env
docker compose up -d
npm ci  # устанавливает зависимости на хосте для CLI-инструментов (race, webhook)

# опционально, засевает каталог (если нужны начальные товары)
npm run seed:catalog
```

`docker-compose.yml` поднимает `postgres` (порт `5432`), `api` (`3000`) и два экземпляра
`supplier-stub` — `supplier-a` (`4001`) и `supplier-b` (`4002`), собранные из одного образа с
разными `SUPPLIER_ID`/`PORT`. `api` и оба стенда ждут health-чек `postgres` (`pg_isready`) перед
стартом.

**Миграции запускаются автоматически внутри контейнера `api`** при его запуске, поэтому отдельно `npm run migration:run` не нужен.

Проверка, что стенд поднялся:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/health/ready
curl -s http://localhost:3000/catalog | head -c 300
npm run race -- --sku KEY-GTA5 --count 50
```

Полный чистый прогон с нуля (то, что гоняет CI-эквивалент вручную):

```bash
docker compose down -v   # если стенд поднимался раньше — снести том с данными
docker compose up -d && npm run migration:run && npm run seed:catalog && npm run race
```

### 1.2 Локально (Node 22 + внешний Postgres)

- **Требования:** Node.js >= 22.12 (нужен `require()` ESM-модулей — Nest 12 публикуется только как ESM, а воркспейсы собираются в CommonJS), npm 10+, доступный PostgreSQL 16. Быстрый способ поднять только базу: `docker compose up -d postgres`.
- **Конфигурация:** `cp .env.example .env`; обязательна ровно одна переменная — `DATABASE_URL` (`postgres://postgres:postgres@localhost:5432/store`), остальные имеют значения по умолчанию (см. §1.4). При отсутствии или неверном значении любой переменной процесс не стартует и печатает одним сообщением весь список проблем.
- **Установка:** `npm ci` в корне (npm workspaces — отдельная установка по пакетам не нужна).
- **Сборка и запуск API:** `npm run -w apps/api build`, затем `npm run -w apps/api start` (то же, что `node apps/api/dist/main.js`). Режим разработки с перезапуском: `npm run -w apps/api start:dev`.
- **Схема и данные:** `npm run migration:run`, затем `npm run seed:catalog` (12 SKU и 50 ключей). _(Команды доступны начиная с этапов 3–4 плана; здесь они описаны как часть итогового сценария.)_
- **Заглушки поставщиков:** `npm run -w apps/supplier-stub build` и два процесса с `SUPPLIER_ID=A PORT=4001` / `SUPPLIER_ID=B PORT=4002`; в чистом локальном сценарии их можно не поднимать, тогда доставка supplier-режима будет падать в фолбэк-ошибку.
- **Проверка живости:** `curl -i http://localhost:3000/health` -> `200 {"status":"ok","service":"api",...}`; `curl http://localhost:3000/health/ready` -> `200` при доступной БД, `503` при деградации.
- **Корреляция запроса:** свой `x-request-id` подхватывается и возвращается в ответном заголовке; он же попадает в поле `trace_id` всех лог-строк этого запроса — удобно грепать `docker logs`/stdout.
- **Логи локально:** `LOG_FORMAT=pretty LOG_LEVEL=debug` даёт человекочитаемые строки; в Docker и CI формат `json`.
- **Порты и переменные:** см. §1.3 и §1.4.

### 1.3 Карта сервисов и портов

| Сервис                           | Порт   | Роль                                                                               |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `apps/api`                       | `3000` | REST API, вебхук оплаты, воркер фоновых задач (в том же процессе), sweeper, сверка |
| `apps/supplier-stub` (инстанс A) | `4001` | Заглушка поставщика A — `/issue`, `/issue/:request_id`, control API                |
| `apps/supplier-stub` (инстанс B) | `4002` | Заглушка поставщика B — тот же образ, другие `SUPPLIER_ID`/порт                    |
| `postgres`                       | `5432` | Единственный источник истины: данные, очередь задач, бухгалтерская книга           |

Воркер фоновых задач, sweeper и сверка остатков работают **внутри** процесса `apps/api`
(`@nestjs/schedule`) и не являются отдельными портами/процессами.

### 1.4 Переменные окружения

Полный список переменных для всех трёх сервисов с значениями по умолчанию и комментариями —
в [`.env.example`](./.env.example). Ниже — самые важные для быстрого старта:

| Переменная                                              | Сервис               | Назначение                                                                                                 |
| ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                          | `apps/api`           | строка подключения к PostgreSQL, обязательна                                                               |
| `PORT`                                                  | все                  | HTTP-порт сервиса (`3000` / `4001` / `4002`)                                                               |
| `SUPPLIER_A_BASE_URL`, `SUPPLIER_B_BASE_URL`            | `apps/api`           | базовые URL заглушек поставщиков                                                                           |
| `SUPPLIER_REQUEST_TIMEOUT_MS`                           | `apps/api`           | таймаут одного вызова к поставщику                                                                         |
| `ADMIN_TOKEN`                                           | `apps/api`           | значение заголовка `x-admin-token` для `/admin/*`                                                          |
| `SUPPLIER_ID`                                           | `apps/supplier-stub` | идентификатор стенда: `A`/`B`                                                                              |
| `STUB_FAIL_RATE`, `STUB_TIMEOUT_RATE`, `STUB_SLOW_RATE` | `apps/supplier-stub` | доли отказов/таймаутов/медленных ответов в режиме `normal`; в CI и интеграционных тестах принудительно `0` |
| `API_BASE_URL`                                          | `tools`              | базовый URL API для CLI-скриптов (`webhook`, `race`, `demo:fallback`)                                      |

### 1.5 API — карта эндпоинтов

Единый конверт ошибки: `{"error":{"code","message","details","trace_id"}}`. Глобальный
`ValidationPipe`: `whitelist:true, forbidNonWhitelisted:true, transform:true,
transformOptions:{enableImplicitConversion:false}, stopAtFirstError:false` — кроме DTO вебхука
оплаты, где `forbidNonWhitelisted:false` (провайдер платежа может добавить поле, это не должно
приводить к массовым 400).

| Метод и путь                  | Назначение                                                                                                                                                    | Коды                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /health`                 | liveness                                                                                                                                                      | `200`                                                       |
| `GET /health/ready`           | readiness (проверка соединения с БД)                                                                                                                          | `200` / `503`                                               |
| `GET /catalog`                | список товаров: `type`, `in_stock`, `limit`, `cursor`, `q`                                                                                                    | `200`                                                       |
| `GET /catalog/:sku`           | карточка товара                                                                                                                                               | `200` / `404`                                               |
| `POST /orders`                | создать заказ (`sku`, `client_order_id`, `quantity`, `buyer_email`); наличие проверяется не при создании, а при доставке — иначе критерий 6 непроверяем       | `201` (новый) / `200` (повтор по `client_order_id`)         |
| `GET /orders/:orderId`        | карточка заказа + `delivery` + до 20 последних `payment_events` + `delivery_attempts`                                                                         | `200` / `404`                                               |
| `POST /webhooks/payment`      | вебхук платёжного провайдера; `result`: `applied`/`duplicate`/`orphan`/`ignored_stale`/`ignored_already_paid`/`ignored_terminal`/`conflict`/`rejected_amount` | `200`/`201`/`409`/`422` (см. `spec/09-http-api-surface.md`) |
| `POST /admin/sweeper/run`     | форсировать один внеочередной прогон всех 6 проходов sweeper (см. §4.3)                                                                                      | `200`                                                       |
| `POST /admin/products/:sku/restock` | пополнить остаток SKU: `codes` (явный список, только `fulfillment_mode=pool`) либо `count` (сгенерировать коды для pool / долить виртуальный остаток для supplier) — ровно одно из двух | `200` / `400` / `404` |
| `POST /admin/orders/:orderId/redeliver` | форсировать повторную доставку заказа в статусе `out_of_stock`/`delivery_failed`; `:orderId` — это `ext_id` заказа                                     | `202` / `404` / `409`                                       |

Все `/admin/*` требуют заголовок `x-admin-token`, сверяемый с `ADMIN_TOKEN` константным по времени
сравнением (`AdminTokenGuard`). `ADMIN_API_ENABLED=false` отключает весь `/admin/*` целиком —
`403 ADMIN_DISABLED` независимо от токена. Пустой `ADMIN_TOKEN` (`ADMIN_TOKEN=`) снимает саму
проверку токена (`guardDisabled`) — удобно для локальной отладки, недопустимо в проде. Полные схемы
тел запроса/ответа, валидаторы полей и таблица кодов по каждому результату вебхука — в
`spec/09-http-api-surface.md`. Из полного набора admin-эндпоинтов по `spec/12-implementation-plan.md`
(шаг 15: ещё `force-paid`, `refund`, `jobs/drain`, `reconcile/stock`, `GET /reconciliation/*`)
реализованы только три выше — остальные не входили в согласованный скоуп восстановления (см. §9).

## 2. Тесты

### 2.1 Юнит-тесты

```bash
npm run test:unit
```

Vitest-проект `unit` (`apps/api/test/unit/**/*.spec.ts`, без окружения, параллельно): 22 файла —
чистые функции и мапперы без БД и HTTP (`money.util`, `mask.util`, `correlation.store`,
`pg-error.util`, `app-logger.service`, `json-logger`, `env.validation`, `catalog-mapper`,
`catalog-util`, `seed-sql-parity`, `order-state-machine`, `orders-util`, `orders-mapper`,
`orders-ext-id`, `ledger-util`, `ledger.service`, `backoff.util`, `job-worker.service`,
`delivery.dispatch`, `jobs.util`, `supplier-plan.util`, `suppliers.util`) плюс
`apps/supplier-stub/test/issue.spec.ts` для логики заглушки поставщика.

### 2.2 Интеграционные тесты

```bash
npm run test:integration
```

Требует поднятую PostgreSQL (`TEST_DATABASE_URL`/`DATABASE_URL`). Пять Vitest-проектов, каждый —
отдельный процесс (`npm run test:integration` гоняет их последовательно):

- `integration` (`*.e2e.spec.ts`) — HTTP через `supertest`-подобный `app.harness.ts`, изоляция
  между тестами через `pg.helper.ts` (`TRUNCATE ... RESTART IDENTITY CASCADE` + сброс
  последовательностей в `beforeEach`; транзакционный rollback не подходит — тестам конкурентности
  на 50 соединениях нужны закоммиченные строки, видимые всем).
- `integration-worker` (`*.worker.spec.ts`) — то же плюс реальный воркер фоновых задач.
- `integration-sweeper` (`*.sweeper.spec.ts`) — то же плюс форсированные тесные пороги sweeper'а.
- `integration-admin-disabled` (`*.admin-disabled.spec.ts`) — `ADMIN_API_ENABLED=false`.
- `integration-admin-open` (`*.admin-open.spec.ts`) — пустой `ADMIN_TOKEN` (гвард выключен).

Последние четыре форсируют переменные окружения в собственном `setupFiles`
(`env.setup.worker-enabled.ts` / `env.setup.sweeper.ts` / `env.setup.admin-disabled.ts` /
`env.setup.admin-open.ts`) **до** первого импорта `AppModule` тестовым файлом, а не через
`startApi(envOverrides)` внутри самого теста. Причина — ограничение `@nestjs/config`: в проекте
`fileParallelism:false`, поэтому все файлы одного Vitest-проекта делят один воркер-процесс;
`ConfigModule.forRoot()` резолвит и кэширует конфигурацию на уровне статических метаданных класса
при первом компиляции `AppModule` в процессе, и `startApi(envOverrides)` в более позднем тесте того
же процесса на уже зарезолвленные ключи не влияет, хотя сам `process.env` мутируется корректно.
Отсюда и правило для новых тестов, которым нужен нестандартный env: не подмешивать его через
`envOverrides` в файле проекта `integration`/`integration-worker`, а заводить для него отдельный
Vitest-проект со своим `include`-глобом и `setupFiles`, по образцу уже перечисленных выше.

Каждый серийный проект (`fileParallelism:false`, `testTimeout:30000`) — общая БД внутри своего
набора тестов, гонки между файлами одного проекта недопустимы; параллельно с ним могут идти только
другие проекты (раздельные процессы `npm run test:integration`).

16 файлов: `catalog.e2e`, `seed-catalog-cli.e2e`, `orders.e2e`, `ledger.e2e`,
`payment-webhook.e2e`, `pool-delivery.e2e`, `pool-delivery.worker`, `job-queue.e2e`,
`job-worker-scheduled.worker`, `supplier-delivery-fallback.worker`, `supplier-delivery.worker`,
`webhook-race.worker`, `admin-recovery.e2e`, `sweeper-recovery.sweeper`, `admin-disabled.admin-disabled`,
`admin-open.admin-open`. Стенды поставщиков в этих тестах поднимаются как настоящий HTTP по
loopback (`supplier-stub.harness.ts`) — таймауты в тестах критерия 4 это реальные сетевые
таймауты, а не мок.

### 2.3 Карта критериев приёмки

Реальная организация тестов отличается от изначального плана в `spec/11-test-plan.md`
(там — один файл на критерий): часть критериев объединена в один файл, где это естественно
вытекает из общего сценария (один вебхук-эндпоинт).

| Критерий                                 | Файл                                        | Что покрыто                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Гонка параллельных вебхуков           | `webhook-race.worker.spec.ts`               | 50 параллельных `POST /webhooks/payment` с разными `event_id` на один заказ — ровно одна проводка, одна выдача                                                                                                                                                   |
| 2. Идемпотентность вебхука               | `payment-webhook.e2e.spec.ts`               | повтор того же `event_id` → `duplicate`; 50 параллельных с разными `event_id`                                                                                                                                                                                    |
| 3. Вебхук не по порядку / до заказа      | `payment-webhook.e2e.spec.ts`               | вебхук на неизвестный заказ → `orphan`; `failed`-после-`paid` → `conflict`; несовпадение суммы → `rejected_amount`; устаревшее событие → `ignored_stale`                                                                                                         |
| 4. Таймаут поставщика и ретраи           | `supplier-delivery.worker.spec.ts`, `sweeper-recovery.sweeper.spec.ts` (проходы 5a/5b)          | повтор доставки после таймаута; `out_of_stock` от обоих поставщиков; `delivery_failed` после исчерпания бюджета 5xx-ретраев; демоция зависшего `in_flight` и редрайв `unknown`-попыток через sweeper                            |
| 5. Фолбэк поставщика A → B               | `supplier-delivery-fallback.worker.spec.ts` | недоступность A → доставка через B                                                                                                                                                                                                                               |
| 6. Восстановление после нехватки остатка | `pool-delivery.e2e.spec.ts`, `admin-recovery.e2e.spec.ts`, `sweeper-recovery.sweeper.spec.ts` (проходы 2/3/4) | доставка из пула, идемпотентный повторный вызов, `out_of_stock` при пустом пуле, повтор уже выданного заказа, пропуск устаревшего поколения задачи, ресток через `/admin/products/:sku/restock`, автоматический и ручной (`/admin/orders/:orderId/redeliver`) повтор доставки |

Восстановление через sweeper и admin-эндпоинты (этап 4 задания) реализовано частично — см. §4.3
и §9 для точного списка того, что входит и что осталось за рамками (полный набор
admin-эндпоинтов из `spec/12-implementation-plan.md`, сверка остатков как отдельный отчёт).

Вспомогательные (не привязанные к одному критерию) интеграционные тесты: `catalog.e2e`,
`orders.e2e`, `ledger.e2e`, `seed-catalog-cli.e2e`, `job-queue.e2e`, `job-worker-scheduled.worker`,
`pool-delivery.worker` — механика очереди задач, каталога, заказов и бухгалтерской книги.

### 2.4 Линт / typecheck / CI

```bash
npm run lint
npm run typecheck
```

ESLint flat config (`eslint.config.mjs`): `@eslint/js` + `typescript-eslint` рекомендованные
наборы, кастомное правило `no-restricted-properties`, запрещающее прямой доступ к `process.env`
(сообщение: используйте `AppConfigService`/типизированные геттеры конфигурации) — с исключением
для файлов конфигурации/тестовых хелперов/`tools/**`/`data-source.ts`, которым нужен прямой
доступ; `padding-line-between-statements` (пустая строка после блоков и объявлений
`const/let/var`); `eslint-config-prettier` подключён последним, чтобы не конфликтовать
с Prettier.

CI (`.github/workflows/ci.yml`) — 4 независимые джобы на каждый push/PR: `lint`, `typecheck`,
`unit`, `integration`. Джоба `integration` поднимает `postgres:16-alpine` как service-контейнер
с health-check ретраями и окружением `TEST_DATABASE_URL`/`DATABASE_URL`/`STUB_FAIL_RATE=0`/
`STUB_TIMEOUT_RATE=0`/`STUB_SLOW_RATE=0` (детерминированные стенды поставщиков в CI). Каждая джоба:
`actions/checkout@v4` → `actions/setup-node@v4` (Node 22, кеш npm) → `npm ci` → соответствующий
корневой скрипт. Итоговый гейт перед мержем: `lint → typecheck → test:unit → migration:run →
test:integration`.

## 3. Воспроизведение гонки (50 параллельных вебхуков)

Критерий 2 задания — «одновременный вебхук с одним и тем же `event_id` (или разными `event_id`
на один заказ) не должен привести к двойной проводке или двойной выдаче». Ниже — как
воспроизвести это как через CLI-инструменты `tools/`, так и автоматическим CI-тестом.

### 3.1 Автоматический прогон (CI-гейт)

`apps/api/test/integration/webhook-race.worker.spec.ts` — тест, который и является основной
проверкой этого критерия: поднимает `apps/api` и стенд поставщика на тестовых портах, создаёт
заказ, шлёт 50 параллельных `POST /webhooks/payment` с разными `event_id` на один и тот же
`order_id` (созданное время события — с детерминированным джиттером вокруг общей отметки,
без `Math.random()`, см. `apps/api/test/helpers/race.helper.ts`), затем проверяет ровно одну
проводку захвата платежа, ровно одну джобу доставки, ровно одну выдачу (`issued_deliveries`)
и сходимость книги. Запуск:

```bash
npm run test:integration -- webhook-race
```

### 3.2 Ручной прогон через CLI (`tools/`)

Для ручного воспроизведения (например, против поднятого `docker compose` стенда) есть два
инструмента в `tools/src`:

- `npm run webhook -- ...` — отправляет один вебхук оплаты (`POST /webhooks/payment`) с
  заданными полями; полезен для точечной проверки отдельных `result` (`applied`, `duplicate`,
  `orphan`, `rejected_amount` и т.д.).
- `npm run race -- ...` — воспроизводит саму гонку: создаёт (или использует существующий) заказ,
  принудительно переводит стенд поставщика A в предсказуемый сценарий `ok` на время прогона
  (восстанавливая `normal` по завершении), шлёт N параллельных вебхуков оплаты с разными
  `event_id` на один заказ и печатает таблицу PASS/FAIL по HTTP-ответам, факту доставки и (по
  умолчанию) прямым SQL-проверкам через `DATABASE_URL`.
- `npm run demo:fallback -- ...` — сквозная HTTP-демонстрация сценария §4.1 (отказ поставщика A →
  фолбэк на B): принудительно выставляет заглушкам сценарии (B всегда `ok`, A — по `--fail-mode
error_5xx|bad_request|stopped`), создаёт/оплачивает заказ, дожидается терминального статуса и
  печатает таблицу PASS/FAIL по 11 проверкам (режим SKU, оплата, доставка от B, состав
  `delivery_attempts`, счётчики выдачи заглушек), восстанавливая сценарии в `normal` по
  завершении. Полный список опций — `npm run demo:fallback -- --help`.

Шаги:

```bash
docker compose up -d
npm run seed:catalog

# создать новый заказ на SKU из пула ключей и прогнать гонку из 50 вебхуков
npm run race -- --sku KEY-GTA5 --count 50

# то же самое против SKU режима supplier (проверяет ещё и путь через поставщика)
npm run race -- --sku STEAM-TOPUP-500 --count 50

# прогнать гонку против уже существующего заказа с известной суммой
npm run race -- --order ord_00123 --count 50
```

`npm run race` печатает 16 строк проверок:

| Группа                              | Проверки                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP-ответы (4)                     | все ответы `200`; ровно один `result: applied`; ноль `duplicate`/`conflict`/`rejected_amount`/`orphan`; остальные результаты — только `applied`/`ignored_stale`/`ignored_already_paid`                                                                                                                                                                                                                         |
| Доставка (3)                        | `GET /orders/:orderId` отвечает; заказ дошёл до терминального статуса за отведённое время; в ответе присутствует `delivery.code`                                                                                                                                                                                                                                                                               |
| SQL (9, пропускаются при `--no-db`) | ровно `--count` строк в `payment_events`; ровно одна `applied` без посторонних состояний; ровно одна джоба `deliver_order`; джоба в состоянии `done`; ровно одна строка в `issued_deliveries`; ровно 2 `ledger_txns` и 4 `ledger_entries`; книга сходится (`sum(signed_minor) = 0`); ровно один дебет `cash` и согласованность источника выдачи (`stock_keys` для `pool` / `delivery_attempts` для `supplier`) |

Полезные флаги: `--no-db` (пропустить SQL-проверки — годится без прямого доступа к БД),
`--no-stub-control` (не трогать `/_control/scenario` стенда, если хаос нужно оставить как
есть), `--reset-stubs` (сбросить состояние стенда перед прогоном), `--api`/`--timeout-ms` —
переопределить `API_BASE_URL`/таймаут HTTP. Полный список — `npm run race -- --help` и
`npm run webhook -- --help`.

Ненулевой код выхода `race` (хотя бы одна строка `FAIL`) означает регресс инварианта exactly-once
и должен считаться провалом прогона в CI/ручной проверке ровно так же, как провал юнит- или
интеграционного теста.

## 4. Воспроизведение отказа поставщика и фолбэка A→B

### 4.1 Поставщик A недоступен (docker compose stop supplier-a) -> фолбэк на B

Шаги воспроизведения (docker compose):

1. `docker compose up -d postgres api supplier-a supplier-b`
2. `docker compose stop supplier-a` — порт A закрыт, ОС отвечает `ECONNREFUSED` на любой `connect()`.
3. Создать заказ на SKU с `fulfilment_mode='supplier'` и оплатить его (`POST /orders`, затем `POST /webhooks/payment`).
4. Джоба `deliver_order` берёт заказ, `SupplierClient.issue` к A получает `ECONNREFUSED` → `classifySupplierNetworkError` даёт `{ kind: 'unavailable', errorKind: 'connection_refused' }` (определённый исход, см. §5.5).
5. `pickSupplier` видит определённую неудачу по A и сразу (в той же claim-джобы, без отдельного ретрая) переходит к B — `POST /issue` к B отрабатывает штатно.
6. Заказ переходит в `delivered`; в `delivery_attempts` — две строки: `A/attempt_no=1/failed/connection_refused` и `B/attempt_no=1/succeeded`, с разными `request_id` (см. таблицу §5.5).
7. Проверить: `SELECT supplier_code, state, error_kind FROM delivery_attempts da JOIN orders o ON o.id=da.order_id WHERE o.ext_id=$1 ORDER BY da.id;`

Шаги 2–7 выше воспроизводятся одной командой — `npm run demo:fallback -- --fail-mode stopped`
(вариант `--fail-mode stopped` соответствует ручной остановке `docker compose stop supplier-a`;
есть также `error_5xx`/`bad_request`, эмулирующие ту же определённую неудачу без остановки
контейнера). По умолчанию используется `error_5xx`, а не `refuse` (эмуляция `ECONNRESET`): такой
обрыв классифицируется как `error_kind='unknown'` и по дизайну НЕ переключает `pickSupplier` на
B — демо с ним либо зависло бы в ожидании `delivered`, либо ошибочно сообщило о провале там, где
система ведёт себя штатно (см. §4.2/§5.5 про `unknown`-исходы и `settleUnknown`).

Тем же сценарием (без docker) покрыт `apps/api/test/integration/supplier-delivery-fallback.worker.spec.ts` — там A стартует на фиксированном тестовом порту и сразу останавливается, что даёт настоящий `ECONNREFUSED` от ОС (не эмулируемый заглушкой сценарий), и проверяет ровно эти два ряда в `delivery_attempts` плюс запись в `issued_deliveries` с `supplier_code='B'`.

Если оба поставщика недоступны (или оба вернули `out_of_stock`), `pickSupplier` возвращает `null`, `finalizeExhausted` переводит заказ в статус `out_of_stock`, а джоба завершается без `retry_required` — это конечное состояние заказа, не временный сбой.

### 4.2 Ловушка таймаута: поставщик выдал код, но ответ не дошёл

Заглушка поддерживает сценарий `issue_then_hang` (через `_control/scenario` либо `STUB_TIMEOUT_RATE`): код резервируется и сохраняется в `StubStateStore` под присланным `request_id` ДО того, как заглушка зависает и не отдаёт HTTP-ответ — именно так на практике выглядит «поставщик выдал код, но ответ потерян» (обрыв сети на обратном пути, рестарт API до чтения ответа и т.п.).

Шаги воспроизведения:

1. Включить сценарий на A: `POST {supplier-a}/_control/scenario` с `{"mode":"issue_then_hang"}` (см. §4.4 «Управление стендами» — там же curl-примеры).
2. Создать и оплатить заказ на SKU с `fulfilment_mode='supplier'`.
3. Джоба уходит в A; `AbortSignal.timeout(SUPPLIER_REQUEST_TIMEOUT_MS)` (по умолчанию 2000мс) срабатывает раньше, чем A отвечает → `classifySupplierNetworkError` даёт `{ kind: 'unknown', errorKind: 'timeout' }`.
4. `settleUnknown` (не `pickSupplier`!) обрабатывает исход: попытка остаётся привязанной к A с тем же `request_id`, переходит в `state='unknown'`, `resolve_attempts=1`, `next_resolve_at` выставлен по `computeNextRunAt`; джоба получает `DeliveryRetryRequiredError` и уходит на переклейм — заказ НЕ переключается на B, потому что исход не определённый (см. таблицу §5.5).
5. На повторном claim (после `next_resolve_at`) `resumeOrAbandonOpenAttempt` находит эту же `unknown`-попытку и повторяет `POST /issue` к A с тем же `request_id`. Заглушка по контракту возвращает ранее зарезервированный код (не чеканит новый) — попытка переходит в `succeeded`, заказ — в `delivered`, выдан ровно один код.
6. Если A так и не отвечает `SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS` раз (по умолчанию 5) подряд, попытка помечается `abandoned_unknown`, и следующая попытка доставки (если останется бюджет `SUPPLIER_JOB_BUDGET_MS`) уходит к B — при этом `abandoned_unknown`-попытка по A остаётся в базе как незакрытый вопрос (возможен задвоенный код, если A всё-таки ответит позже) — сверка ожидается через `GET /reconciliation/*` (шаг 14), не через эту таблицу.
7. Проверить: `SELECT state, resolve_attempts, request_id FROM delivery_attempts WHERE ...` — `request_id` не меняется между шагами 3 и 5, что и доказывает идемпотентный реплей, а не повторную выдачу.

Ключевой инвариант: таймаут никогда напрямую не двигает выбор поставщика (`pickSupplier` в эту ветку не вызывается) — только `settleUnknown`/повторный `POST` с тем же `request_id` способны его закрыть, потому что только это безопасно при уже состоявшейся выдаче на стороне поставщика.

### 4.3 Пустой остаток и восстановление

`SweeperService` (`apps/api/src/reconciliation/sweeper.service.ts`) — `@Interval`-таск на
`SWEEPER_INTERVAL_MS` (по умолчанию 15 000 мс), выключаемый через `SWEEPER_ENABLED=false`.
`runOnce()` последовательно гоняет 6 проходов, каждый — своя короткая транзакция (`UnitOfWorkService`),
с батчем не больше `SWEEPER_BATCH_SIZE` строк и блокировкой строк через `SKIP LOCKED` там, где
проход конкурирует с воркером/другим тиком за одни и те же заказы/попытки — поэтому параллельный
`POST /admin/sweeper/run` и фоновый тик не дублируют доставку и не видят одну и ту же строку дважды:

1. **Реклейм зависших джобов** — `state='running'` дольше `JOB_LOCK_TTL_MS` возвращает в очередь
   (тот же TTL, что использует сам `JobWorkerService`).
2. **Довешивание зависших заказов** — `paid`/`delivering` дольше `STUCK_ORDER_AGE_SECONDS` без
   `issued_deliveries` и без живой `deliver_order`-джобы ставит доставку в очередь заново, не трогая
   статус заказа.
3. **Повтор `out_of_stock`** — как только остаток пополнен (см. ресток ниже), заказ ретраится
   немедленно, без порога давности.
4. **Повтор `delivery_failed`** — старше `DELIVERY_FAILED_RETRY_SECONDS`, под потолком
   `MAX_DELIVERY_GENERATIONS` (иначе заказ так и остаётся в `delivery_failed` — не бесконечный ретрай).
5. **Попытки доставки**: 5a — `in_flight` дольше `ATTEMPT_INFLIGHT_TIMEOUT_MS` демотится в `unknown`
   (воркер, скорее всего, умер после TX-S1-коммита, не дождавшись ответа поставщика); 5b — `unknown`
   попытки, готовые к повторному дозвону, редрайвятся.
6. **Orphan-события оплаты**: 6a — заказ для orphan-события уже появился → реплей через тот же
   `applyPersistedEvent`, что и живой вебхук, в одной транзакции с блокировкой строки; 6b — событие
   старше `ORPHAN_TTL_SECONDS` без заказа → абандон (`payment_events.state='abandoned'`).

**Два сознательных отклонения от `spec/09-http-api-surface.md`/`spec/12-implementation-plan.md`,
задокументированные здесь по правилу «решения — в README»:**

- Проход 5b redrive-ит `unknown`-попытки через ту же `deliver_order`-джобу, а не через отдельный
  `resolve_unknown_attempt`-обработчик — такого обработчика в проекте нет, а повторный `/issue` с тем
  же `request_id` идемпотентен на стороне поставщика (`RESUME_DELIVERY_ATTEMPT_SQL`), так что отдельный
  путь не нужен: он дал бы тот же результат ценой лишнего кода.
- Проход 4 (`retryDeliveryFailed`) увеличивает `delivery_generation` при ретрае, хотя таблица
  проходов в спеке этого явно не показывает — без этого инкремента заказ поколения N ретраился бы
  под тем же поколением, и старая/новая `deliver_order`-джоба не различались бы по dedupe-ключу
  (`buildDeliverOrderDedupeKey` включает `ext_id`, но проверка устаревшего поколения в `job-worker`
  опирается на `delivery_generation` из payload) — без бампа критерий 6 «пропуск устаревшего
  поколения задачи» ломался бы именно на пути восстановления.

`POST /admin/orders/:orderId/redeliver` — второй, ручной путь восстановления поверх тех же
инвариантов: сначала проверяет `issued_deliveries` (уже есть доставка → `409
ORDER_ALREADY_DELIVERED`, даже если статус заказа почему-то не отражает этого), потом
`RECOVERABLE_ORDER_STATUSES` (`out_of_stock`, `delivery_failed`; иначе `409
ORDER_NOT_RECOVERABLE`), затем бампает `delivery_generation` и ставит `deliver_order` в очередь —
по сути форсирует то же, что проход 3/4 сделал бы сам по расписанию, но сразу.

`POST /admin/products/:sku/restock` пополняет остаток: для `fulfillment_mode=pool` — либо
добавляет `codes` явным списком, либо генерирует `count` штук новых кодов в `sku_stock`; для
`fulfillment_mode=supplier` — только `count` (явные `codes` для supplier — `400
VALIDATION_FAILED`, у supplier-режима нет собственных кодов в БД, это чужой остаток), увеличивает
виртуальный остаток и **после коммита** (не внутри транзакции) уведомляет соответствующий
supplier-стенд через `SupplierClient.restockOne()` — этот вызов обёрнут в try/catch и только
логирует ошибку, никогда не бросает: ресток в своей БД не должен откатываться из-за того, что
stub-сервис поставщика недоступен или не поднят.

Важно: `OrdersService.createInTransaction` не разгребает orphan-`payment_events` при создании
заказа — единственный путь разгрести orphan-событие, пришедшее раньше заказа, это проход 6a
sweeper'а (по расписанию или через `POST /admin/sweeper/run`). Это сознательное упрощение: не
дублировать логику реплея в двух местах ради разницы в задержке на один тик sweeper'а (≤ `SWEEPER_INTERVAL_MS`).

Тесты: `apps/api/test/integration/sweeper-recovery.sweeper.spec.ts` (все 6 проходов, включая
отрицательные кейсы — что́ проход НЕ должен трогать) и
`apps/api/test/integration/admin-recovery.e2e.spec.ts` (все три admin-эндпоинта + `AdminTokenGuard`)
плюс `admin-disabled.admin-disabled.spec.ts` / `admin-open.admin-open.spec.ts` для двух режимов
гварда — подробнее об организации этих файлов в §2.2.

### 4.4 Управление стендами

Оба стенда поставщика (`apps/supplier-stub`, поднимается дважды — под `SUPPLIER_ID=A` и `SUPPLIER_ID=B`) —
это не просто «всегда 200 OK», а управляемый источник хаоса: в режиме `normal` (по умолчанию) на каждый
`/issue` бросается кубик по ставкам `STUB_FAIL_RATE` / `STUB_TIMEOUT_RATE` / `STUB_SLOW_RATE`, а через
`/_control/*` можно принудительно включить любой из десяти сценариев на N следующих запросов — это то,
чем `apps/api` и воспроизводит фолбэк A→B и ловушку таймаута из 4.1–4.2.

**Порядок проверки в `normal`-режиме фиксирован** (`timeout → error_5xx → slow → ok`) — при всех трёх
ставках `0` результат всегда `ok`. Именно поэтому CI и интеграционные тесты `apps/api` принудительно
выставляют все три ставки в `0` (см. `.env.example`) — стенд ведёт себя детерминированно, хаос включается
только точечно через `/_control/scenario`.

| Режим               | Что делает `/issue`                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `normal`            | бросает кубик по ставкам (см. выше)                                                                                          |
| `ok`                | сразу отдаёт `200` с кодом                                                                                                   |
| `slow`              | отдаёт `200` после случайной задержки `STUB_LATENCY_MS_MIN..STUB_LATENCY_MS_MAX`                                             |
| `timeout`           | ждёт `STUB_HANG_MS`, ответа не будет никогда (соединение зависает)                                                           |
| `issue_then_hang`   | код выпускается и сохраняется **до** зависания — это и есть ловушка 4.2: код у поставщика есть, ответ до `apps/api` не дошёл |
| `error_5xx`         | `500` с JSON `{ "status": "error", "reason": "upstream_unavailable" }`                                                       |
| `error_5xx_garbage` | `500` с не-JSON телом (HTML) — проверка, что `apps/api` не падает на разборе ответа                                          |
| `out_of_stock`      | `409` с `{ "status": "error", "reason": "out_of_stock" }`, не трогая остаток                                                 |
| `bad_request`       | `400` с `{ "status": "error", "reason": "sku_unknown" }`                                                                     |
| `refuse`            | обрыв TCP-соединения без ответа (`ECONNRESET`), не HTTP-ошибка                                                               |

Известный `request_id` (уже выданный ранее) всегда отдаёт сохранённый код повторно — это работает
даже поверх `out_of_stock`: правило приоритета «повтор важнее пустого остатка» проверяется отдельным тестом.

Управляющие эндпоинты — только для разработки/тестов, без авторизации, выключаются через
`STUB_CONTROL_ENABLED=false` (тогда отвечают `404`, как будто их не существует):

```bash
# включить конкретный сценарий на 3 следующих вызова /issue (без times — залипает навсегда)
curl -s -X POST http://localhost:4001/_control/scenario -H 'content-type: application/json' \
  -d '{"mode":"error_5xx","times":3}'

# обнулить остаток (мгновенно даёт out_of_stock на следующих /issue)
curl -s -X POST http://localhost:4001/_control/restock -d '{"count":0}' -H 'content-type: application/json'

# сбросить сценарий и остаток к исходному состоянию
curl -s -X POST http://localhost:4001/_control/reset

# текущее состояние стенда (сценарий, остаток, счётчик выданных кодов)
curl -s http://localhost:4001/_control/state
```

Состояние (выданные коды, остаток) переживает перезапуск процесса — пишется на диск по
`STUB_PERSIST_PATH` после каждой мутации; пустое значение переменной отключает персист (стенд стартует
каждый раз с чистого листа, что и используют интеграционные тесты `apps/supplier-stub`).

## 5. Ключевые решения

### 5.1 Данные и деньги

- **`BIGINT` в минорных единицах (копейках), суффикс `_minor` у каждой денежной колонки.** Точность по построению, суммирование книги без дрейфа; парсер типов `pg` на OID 20 возвращает `Number` и проверяет `Number.isSafeInteger`. Отвергнуто: `NUMERIC(20,2)` — тоже точен, но приезжает в JS строкой и тянет десятичную библиотеку или ручную арифметику ради нулевого выигрыша на рублёвых суммах; `float`/`double` — неточен в принципе.
- **Допущение о единицах на границе: `amount` вебхука и `price` из `products.json` — рубли, не копейки; перевод ровно `amount * 100`.** Основание — контракт: `amount: 500` в паре с `STEAM-TOPUP-500`, у которого `price: 500`; в ответах API отдаётся и `amount_minor` (авторитетное), и `amount` (для показа). Отвергнуто: трактовать их как копейки — при расхождении ошибка была бы тихой; выбранный вариант отваливается громко (`rejected_amount`) и правится одной строкой.
- **Валюта — `CHAR(3)` с `CHECK (currency = 'RUB')`.** Переключатель валют в исходных данных объявлен «только для отображения», конвертации нет нигде. Отвергнуто: мультивалютность с курсами — таблица курсов и политика округления ради функциональности, которой в задании нет.
- **Публичный идентификатор заказа `ext_id` формата `ord_00123` из отдельной последовательности `order_ext_seq`; клиент может задать свой `client_order_id`, и тогда он становится `ext_id`.** Даёт идемпотентность создания заказа и позволяет воспроизвести «вебхук пришёл раньше заказа» (критерий 3). Пространства имён разделены: клиентский идентификатор проверяется как `^ord_(?!\d+$)[A-Za-z0-9_-]{1,40}$` и не может принять всецифровую форму, которую выдаёт последовательность, — иначе занятый заранее `ord_00100` подменил бы собой следующий анонимный заказ. Коллизия выданного последовательностью `ext_id` означает рассинхронизацию `order_ext_seq` с данными (например, дамп восстановлен без `setval`) и отвечает `500`, а не отдаёт чужой заказ. Отвергнуто: повторять `nextval` при коллизии — не спасает от обратного эффекта, когда клиент заранее занимает `ord_00105` и заставляет последовательность прыгать через выданные значения. Отвергнуто: публиковать `bigserial id` — раскрывает объём продаж и лишает идемпотентности; UUID — нечитаем в логах и примерах контракта.
- **Двойная запись двумя таблицами: `ledger_txns` (шапка, `UNIQUE (idempotency_key)`) и `ledger_entries` (проводки, `UNIQUE (txn_id, entry_seq)`, генерируемая колонка `signed_minor`).** Сумма `signed_minor` по проводке обязана быть нулём — «журнал всегда сходится» проверяемо, а идемпотентный ключ делает повторную обработку события безопасной. Отвергнуто: одна таблица со знаковыми суммами — «сходится» тавтологически и не отвечает, откуда и куда ушли деньги.
- **Схема живёт в миграциях, сущности TypeORM — только маппинг (`synchronize: false`).** Частичные уникальные индексы, `COLLATE "C"`, `fillfactor`, `GENERATED … STORED` и составные `CHECK` в декораторах не выражаются, поэтому DDL написан руками и является источником истины. Отвергнуто: `synchronize`/`migration:generate` по декораторам — молча теряет ровно те ограничения, на которых держится exactly-once.
- **План счетов из трёх счетов: `cash` (актив), `customer_prepayment` (обязательство), `revenue` (доход).** Этого достаточно, чтобы отличить деньги, которые уже получены, от денег, которые ещё не отработаны товаром. Отвергнуто: полноценный план счетов или счета на каждый SKU — объём без пользы для задания.
- **Три проводки: `payment_captured` (Dt `cash` / Kt `customer_prepayment`), `delivery_recognized` (Dt `customer_prepayment` / Kt `revenue`), `payment_refunded` (Dt `customer_prepayment` / Kt `cash`); сумма всегда `orders.total_minor`.** Вебхук `failed` не пишет ни одной проводки. Отвергнуто: признавать выручку в момент оплаты — тогда непоставленный заказ выглядел бы как доход, и «должны покупателю» неоткуда было бы взять.
- **`postTxn` — единственный писатель, проверка до записи.** Минимум две записи, суммы целые и положительные, одна валюта, `SUM(signed) = 0`; нарушение — `DomainError(LEDGER_UNBALANCED)`, которая рвёт объемлющую транзакцию, поэтому несходящаяся проводка физически не попадает в БД. Отвергнуто: проверка триггером/`CHECK` после вставки — ошибка обнаружилась бы уже после записи и без контекста бизнес-события.
- **Идемпотентность на уровне ключа, а не кода: `UNIQUE (idempotency_key)` + `ON CONFLICT DO NOTHING RETURNING`.** Ключи `payment_captured:{event_id}`, `delivery_recognized:{ext_id}:{generation}`, `payment_refunded:{ext_id}`; повтор возвращает `null` и не пишет ни одной проводки, поэтому 50 вебхуков дают ровно две записи. Отвергнуто: проверка «уже проводили?» отдельным `SELECT` — гонка между чтением и вставкой возвращала бы двойную выдачу денег.
- **`entry_seq` назначает база одной вставкой `unnest(...) WITH ORDINALITY`.** Порядок записей в проводке фиксирован, и `UNIQUE (txn_id, entry_seq)` не требует счётчика в приложении. Отвергнуто: вставка по одной записи в цикле — лишние round-trip'ы внутри самой горячей транзакции вебхука.
- **`postTxn` не открывает транзакцию, а принимает `QueryRunner` вызывающего.** Деньги, статус заказа и постановка джобы либо фиксируются вместе, либо не фиксируются вовсе. Отвергнуто: собственная транзакция внутри сервиса — оплата могла бы «сойтись» при откате заказа.

### 5.2 Exactly-once

- **Смена статуса заказа — одна охраняемая функция и один-единственный писатель.** `resolveTransition(from, event)` (`orders/order-state-machine.ts`) — единственное место, где решается допустимость перехода: таблица 7 статусов x 9 событий = 63 ячейки с четырьмя исходами (`apply` — сменить статус, `noop` — идемпотентный повтор, `conflict` — аномалия, которую фиксируем и показываем в сверке, `illegal` — ошибка программиста, `409 ILLEGAL_TRANSITION`). Записывает статус ровно один метод `OrdersRepository.transition` — CAS-`UPDATE ... WHERE id = $1 AND status = $2`: ноль изменённых строк означает «нас опередила другая транзакция», и обработчик перечитывает строку и заново спрашивает машину, а не затирает чужой результат. Отвергнуто: проверки статуса по месту в каждом сервисе — идемпотентность повторного вебхука и повторного запуска джобы зависела бы от того, что все ветки написаны одинаково; отвергнуто: `UPDATE orders SET status = ...` без условия на предыдущий статус — под гонкой 50 вебхуков это классическое потерянное обновление.
- **Шлюз идемпотентности — вставка события первым шагом транзакции.** `INSERT INTO payment_events (...) VALUES (...) ON CONFLICT (event_id) DO NOTHING RETURNING id`: ноль строк означает, что `event_id` уже видели, транзакция коммитится немедленно и возвращает `200 {result:"duplicate"}` без блокировки заказа, без проводки и без постановки джобы — «до и после» строго идентичны по `orders`, `ledger_entries`, `jobs`, `issued_deliveries`. Отвергнуто: `ON CONFLICT DO UPDATE` — переписал бы запись первого прихода события и испортил бы аудиторский след.
- **Именованная блокировка на строке заказа — единственная точка сериализации для гонки 50 вебхуков.** `SELECT * FROM orders WHERE ext_id = $1 FOR UPDATE` ставит конкурентные события одного заказа в очередь на уровне PostgreSQL; под READ COMMITTED ожидающая транзакция после снятия блокировки перечитывает **последнюю зафиксированную** версию строки, поэтому запрос №2 видит уже `status='paid'`, получает от машины состояний `noop` и не пишет ни проводки, ни джобы. Отвергнуто: блокировка на уровне приложения (мьютекс/Redis-lock) — требует внешнего компонента ради гарантии, которую база даёт бесплатно и с автоматическим снятием при коммите/откате.
- **Четыре независимых уровня защиты от двойной поставки — любого одного достаточно.**

  | Уровень | Механизм                                                                                                                                     |
  | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1       | `payment_events_event_uq` — дедуплицирует идентичные события                                                                                 |
  | 2       | `SELECT ... FROM orders WHERE ext_id = $1 FOR UPDATE` — именованная блокировка, сериализует разные события одного заказа                     |
  | 3       | `jobs_live_uq` (частичный уникальный индекс `(kind, dedupe_key) WHERE state IN ('pending','running')`) — не более одной живой джобы доставки |
  | 4       | `issued_deliveries_order_uq` — последний рубеж: вторая выдача физически невозможна                                                           |

  Дополнительно `ledger_txns_idem_uq` гарантирует ровно две проводки на захват платежа, а `delivery_attempts_open_uq` — не более одного живого вызова поставщика. Отвергнуто: полагаться на один уровень (например, только на блокировку заказа) — любой единичный механизм в изоляции можно обойти багом в другом месте кода; независимые уровни на разных объектах схемы страхуют друг друга.

- **В транзакции вебхука (TX-W) нет ни одного сетевого вызова.** Синхронно внутри неё — вставка события, блокировка заказа, переход статуса, проводка в книге, постановка джобы: пять коротких операций над индексированными строками, p99 существенно меньше 10 мс. Вся доставка (резервация ключа или `POST /issue` поставщику, ретраи, бэкофф, переключение A→B) выполняется асинхронно job-воркером. Отвергнуто: доставка инлайн в обработчике вебхука — держать блокировку строки `orders` через сетевой вызов с таймаутом 2 с и до четырёх попыток означает ~10-секундный вебхук, гарантированный таймаут у PSP и шторм повторной доставки поверх гонки 50 запросов; отвергнуто: инлайн-доставка с ответом `202` — блокировку всё равно держит, медленнее, ничего не выигрывает.

Статус-код возвращается по следующей политике (дословно из §9.4 контракта):

| Ситуация                                              | Код   | Почему                                                                                                               |
| ----------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| Любой бизнес-исход, включая duplicate/orphan/conflict | `200` | Событие принято и durably записано; повтор ничего не изменит                                                         |
| Некорректное тело (нарушение схемы)                   | `400` | Повтор не исправит плохой payload; PSP должен получить алерт, а не зациклиться                                       |
| Непредвиденная внутренняя ошибка (БД недоступна, баг) | `500` | Контракт предполагает, что `5xx` вызывает повторную доставку — именно это нужно, если мы не смогли сохранить событие |

### 5.3 Вебхуки вне порядка

- **Пять сценариев рассинхронизации порядка и по одной политике на каждый.**

  | Сценарий                                   | Политика                                                                                                                                                                                                                                                                                                                                                                                                       | Обоснование                                                                                                                                                                                                                                                                 |
  | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Вебхук приходит раньше заказа              | Событие сохраняется с `state='orphan'`, `order_id=NULL`, ответ `200`. Два дренажа: (а) `POST /orders` с `client_order_id` проверяет индекс orphan-событий в той же транзакции, что и вставку заказа, и немедленно проигрывает совпавшие; (б) фоновый sweeper пересканирует orphans каждый цикл. Orphans старше `ORPHAN_TTL_SECONDS` переходят в `state='abandoned'` и попадают в `GET /reconciliation/summary` | `404`/`5xx` заставили бы PSP слать вебхук вечно и рисковали бы потерять событие, если PSP всё же сдастся; хранение делает порядок прихода неважным — факт durable, применение факта отложено                                                                                |
  | `failed` после уже применённого `paid`     | `kind: 'conflict'`. Заказ **не** откатывается. Событие сохраняется с `state='conflict'`, ERROR-лог `payment.conflict`, видно в `GET /reconciliation/payment-conflicts`                                                                                                                                                                                                                                         | `paid` — это факт движения денег; откат требует флоу возврата (деньги уже покинули счёт плательщика), который задание явно исключает. Тихий откат в `payment_failed` после выдачи ключа — худший из возможных исходов, поэтому аномалия становится громкой, а не молчаливой |
  | `paid` после `payment_failed`              | `kind: 'conflict'`. Заказ остаётся в `payment_failed` (финальный по условию задания). Событие сохраняется с `state='conflict'`, ERROR-лог, видно в сверке. Оператор разрешает вручную через `POST /admin/orders/:id/force-paid`                                                                                                                                                                                | Соблюдает финальность статуса и одновременно даёт документированный аудируемый путь восстановления — деньги никогда не должны остаться без товара молча                                                                                                                     |
  | Два события с разным `occurred_at` в гонке | Проверка устаревания: если `event.occurred_at < orders.last_payment_event_at`, событие получает `ignored_stale` независимо от своего статуса; `last_payment_event_at` пишется на каждом применённом переходе                                                                                                                                                                                                   | Использует собственную временную метку PSP как ключ порядка вместо порядка прихода запроса — единственный корректный сигнал упорядочивания при at-least-once доставке без гарантии порядка                                                                                  |
  | `paid` дважды с разными суммами            | Второе событие ловит амаунт-гвард (см. ниже) как `rejected_amount` до перехода статуса                                                                                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                                                             |

- **Восемь значений `result` вебхука отражают ровно эти исходы.**

  | `result`               | Когда                                                           |
  | ---------------------- | --------------------------------------------------------------- |
  | `applied`              | Событие применило переход статуса (`paid`/`failed`)             |
  | `duplicate`            | `event_id` уже был обработан ранее                              |
  | `orphan`               | `order_id` из вебхука ещё не существует                         |
  | `ignored_stale`        | `occurred_at` события раньше `orders.last_payment_event_at`     |
  | `ignored_already_paid` | Заказ уже `paid`, повторный `paid` — идемпотентный noop         |
  | `ignored_terminal`     | Заказ в терминальном статусе, событие для него — noop           |
  | `conflict`             | Событие противоречит текущему статусу заказа (см. таблицу выше) |
  | `rejected_amount`      | Сумма/валюта `paid`-события не совпадают с заказом              |

- **Амаунт-гвард проверяется раньше гварда устаревания.** Если `event.status='paid'` и (`amount_minor <> orders.total_minor` или `currency <> orders.currency`) — событие сохраняется как `rejected_amount` с причиной, ERROR-лог `payment.amount_mismatch`, без перехода и без проводок, `200` (повтор не исправит несовпадение сумм). У `failed`-события сумма не проверяется — оно не двигает деньги. Порядок гвардов (сначала сумма, потом устаревание) означает, что искажённый по сумме, но при этом устаревший `paid` всегда получит `rejected_amount`, а не `ignored_stale` — приоритет у более информативной для сверки причины отказа.
- **Валидация тела вебхука — мягкая (lenient), а не строгая.** `PaymentWebhookRequestDto` помечен маркером `LENIENT_VALIDATION`, который `AppValidationPipe` читает через `Symbol`-ключ и отключает `forbidNonWhitelisted`: неизвестные поля в теле молча отбрасываются вместо `400`. Отвергнуто: строгая валидация (как у `POST /orders`) — PSP не наш контрагент по контракту в смысле версионирования, он может добавить новое поле в payload в любой момент, и падать `400` на каждый такой релиз провайдера значит терять реальные платежи там, где это дороже всего.
- **Дренаж orphan-событий из `POST /orders` — вне рамок этого шага.** Строка (а) из таблицы сценариев (немедленный дренаж orphan при создании заказа с `client_order_id`) описывает целевое поведение системы, но её реализация относится к шагу создания заказа, а не к шагу вебхука, и в этом шаге не затрагивалась.

### 5.4 Очередь и фоновые задачи

- **Очередь задач — таблица `jobs` в той же Postgres, без Redis/BullMQ.** Постановка джобы (`INSERT ... ON CONFLICT (kind, dedupe_key) WHERE state IN ('pending','running') DO NOTHING`) — часть той же транзакции, что и запись проводки и смена статуса заказа (TX-W из §5.2): либо коммитятся вместе, либо откатываются вместе. Claim — атомарный `UPDATE jobs SET state='running', attempts=attempts+1 ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING ...`: несколько воркеров не могут выхватить одну и ту же строку, и ни один не блокируется на чужой выборке. Частичный уникальный индекс `(kind, dedupe_key) WHERE state IN ('pending','running')` — та же дедупликация, что и у платёжных событий в §5.2: повторная постановка джобы для уже поставленного или выполняющегося заказа не создаёт вторую живую задачу, а завершённая/мёртвая джоба своего дедуп-ключа не блокирует. Отвергнуто: Redis/BullMQ — отдельная инфраструктура и отдельная точка отказа ради очереди на пару тысяч задач; главное теряемое свойство — джоба ставилась бы вторым, не гарантированно атомарным с бизнес-транзакцией шагом (либо через outbox, либо с риском поставить джобу для отката заказа).
- **Бэкофф — свои 20 строк (`backoff.util.ts`), не библиотека.** Экспоненциальный рост с равным джиттером (`computeBackoffMs`/`computeNextRunAt`) — чистая функция от `attempts`, `baseMs`, `maxMs` и инжектируемого `random()` для детерминированных юнит-тестов. Отвергнуто: библиотека вида `exponential-backoff`/`p-retry` — они рассчитаны на retry вокруг одного вызова в рамках процесса (`await retry(fn)`), а здесь нужно не выполнить повтор, а посчитать `run_at` и записать его в БД до следующего claim'а другим воркером или другим процессом; адаптация чужого API под «посчитай дату, не выполняй» не короче и не яснее собственной функции.
- **Планировщик тика — `@nestjs/schedule` (`@Interval` + `SchedulerRegistry`), не ручной `setInterval` в конструкторе.** `SchedulerRegistry` даёт именованный, отключаемый и переконфигурируемый интервал (`WORKER_ENABLED=false` снимает его в `onModuleInit`, нестандартный `JOB_POLL_INTERVAL_MS` пересоздаёт его с нужным периодом), и тот же механизм уже используется остальными фоновыми процессами приложения (sweeper) — единообразие вместо второго самодельного способа тикать. Реэнтерабельность тика — не через `clearInterval`, а через флаг `running`: следующий тик, пришедшийся на ещё не завершённый `runOnce()`, тихо выходит, а не встаёт в очередь и не запускает второй проход поверх первого. Отвергнуто: голый `setInterval` в `onModuleInit` — исправно работает, но останов/перенастройку периода в тестах (`envOverrides` в `startApi()`, `WORKER_ENABLED=false` в интеграционных тестах очереди) пришлось бы реализовывать вручную, а `SchedulerRegistry` даёт это готовым и по тому же контракту, что и у sweeper'а.
- **Клейм и постановка джобы — раздельные транзакции, а не единая транзакция на весь жизненный цикл джобы.** `claim()` коммитится сразу: `state='running'` и `attempts+1` должны быть видны другим воркерам и пережить падение обработчика или рестарт процесса, иначе долгий обработчик держал бы транзакцию открытой неопределённое время и блокировал бы claim других джоб той же строкой. `complete()`/`fail()` — тоже своя, отдельная транзакция, выполняемая после завершения обработчика. Отвергнуто: одна транзакция от claim до settle — helper-обработчик с сетевым вызовом (например, будущий `deliver_order`) держал бы транзакцию БД открытой на время сетевого таймаута, что для Postgres так же плохо, как инлайн-доставка в TX-W, которую §5.2 отвергает по той же причине.

### 5.5 Интеграции и таймауты

- **Таймаут ≠ отказ.** `SupplierClient.issue` бьёт запрос по `AbortSignal.timeout(SUPPLIER_REQUEST_TIMEOUT_MS)` (по умолчанию 2000мс) и на срабатывании таймера получает `TimeoutError`/`AbortError` — оба классифицируются как исход `unknown` (`error_kind: 'timeout'`), а не `unavailable`. Причина: сам факт таймаута ничего не говорит о том, успел ли поставщик обработать запрос и зачеканить код до истечения окна — HTTP-ответ мог не дойти по любой причине уже после того, как код выдан (это и есть сценарий 4.2). Трактовать таймаут как гарантированный отказ значило бы иногда выдавать код дважды. Отвергнуто: считать таймаут отказом и сразу идти на fallback — ровно так теряется гарантия «не более одной выдачи на заказ» в сценарии `issue_then_hang`.
- **Формула `request_id`: `req_{extId без "ord_"}-g{generation}-{supplierCode}{attemptNo}`.** Реализация — `buildSupplierRequestId` в `suppliers/suppliers.util.ts`; например `buildSupplierRequestId('ord_00123', 1, 'A', 1) === 'req_00123-g1-A1'`. Три компонента отвечают на три независимых вопроса: `extId` — какой заказ, `generation` — какая попытка доставки по счёту (см. §5.6/§4.3, `MAX_DELIVERY_GENERATIONS`), `supplierCode+attemptNo` — какой поставщик и какая по счёту попытка к нему. Составной ключ даёт бесплатную идемпотентность на стороне поставщика: повторный `POST /issue` с тем же `request_id` (ретрай после таймаута, повторный claim джобы) обязан вернуть тот же код, а не начеканить новый — контракт заглушки это и проверяет.
- **Таблица классификации исходов** (`classifySupplierNetworkError`/`classifySupplierHttpStatus`, `suppliers/suppliers.util.ts`):

  | Исход сети/HTTP                                                                         | `kind`         | `error_kind`         | Определённый (не требует дозвона)? |
  | --------------------------------------------------------------------------------------- | -------------- | -------------------- | ---------------------------------- |
  | `TimeoutError`/`AbortError` (клиентский таймаут)                                        | `unknown`      | `timeout`            | нет                                |
  | `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`/`EACCES` (порт закрыт, TCP-connect не состоялся) | `unavailable`  | `connection_refused` | да                                 |
  | `ECONNRESET`/`UND_ERR_SOCKET`/`EPIPE` (соединение разорвано уже после connect)          | `unknown`      | `connection_reset`   | нет                                |
  | неопознанная сетевая ошибка (нет `.code` ни на самой ошибке, ни на `.cause`)            | `unknown`      | `connection_reset`   | нет                                |
  | HTTP `2xx`, тело без `code`                                                             | `unknown`      | `bad_body`           | нет                                |
  | HTTP `2xx`, тело с `code`                                                               | `issued`       | —                    | да (успех)                         |
  | HTTP `4xx`                                                                              | `rejected`     | `http_4xx`           | да                                 |
  | HTTP `5xx`                                                                              | `unavailable`  | `http_5xx`           | да                                 |
  | HTTP-ответ с `reason: 'out_of_stock'` (любой статус)                                    | `out_of_stock` | `out_of_stock`       | да                                 |

  `EACCES` в списке «отказано в соединении» — не опечатка: это ОС отказала в `connect()` до того, как хоть один байт ушёл с машины (на Windows встречается под Hyper-V/WSL при исчерпании диапазона эфемерных портов), то есть даёт ту же гарантию «поставщик точно не видел запрос», что и `ECONNREFUSED`. `ECONNRESET`/`EPIPE` в эту корзину не идут: разрыв случается уже после установления соединения, когда часть запроса могла уйти, поэтому это `unknown`, а не `unavailable`. Отвергнуто: класть все сетевые ошибки в один `unavailable` bucket — стёрло бы именно то различие («дошло или нет»), ради которого таблица вообще нужна.

- **Запись попытки в БД строго до сетевого вызова (record-before-call).** `pickNextAttempt` вставляет строку `delivery_attempts` (`state='in_flight'`, уже с вычисленным `request_id`) в транзакции TX-S1 и коммитит её, и только после этого — вне всякой транзакции — уходит `POST /issue`. Если процесс упадёт между коммитом TX-S1 и HTTP-вызовом (или во время него), при следующем claim джобы `resumeOrAbandonOpenAttempt` найдёт уже существующую `in_flight`/`unknown` строку с тем же `request_id` и переиграет тот же запрос вместо того, чтобы завести новую попытку — стабильный `request_id` для повтора существует только потому, что он был закоммичен до того, как ушёл на сеть. Отвергнуто: писать попытку после ответа поставщика — тогда crash-before-write означал бы, что о состоявшемся (или зависшем) запросе к поставщику в базе вообще нет следа, и после рестарта заказ мог бы получить второй, независимый `request_id` поверх уже возможно выданного кода.
- **Разрешение `unknown`: тот же `request_id`, повторный `POST`, бюджет попыток дозвона.** Явного отдельного GET-канала (`GET /issue/:id`) `apps/api` не использует — заглушка его отдаёт (для ручной инспекции/curl), но канал разрешения неоднозначности здесь один: `settleUnknown` переводит попытку в `state='unknown'` с `resolve_attempts+1` и `next_resolve_at` (тот же `computeNextRunAt`, что и у джоб-бэкоффа), а `DeliveryRetryRequiredError` заставляет джобу переклеймиться и на следующей попытке `resumeOrAbandonOpenAttempt` находит эту же строку и реиспользует её `request_id` для нового `POST /issue`. Заглушка по контракту отвечает на повтор известного `request_id` уже сохранённым кодом (или тем же `out_of_stock`), поэтому реплей безопасен произвольное число раз. Если `resolve_attempts` достигает `SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS` (по умолчанию 5), попытка помечается `abandoned_unknown` и `pickNextAttempt` на следующей итерации того же прогона джобы переходит к следующему поставщику в `FALLBACK_CHAIN` — заказ не виснет навечно, но и не считается точно доставленным этим поставщиком: `abandoned_unknown` — это открытый вопрос для `GET /reconciliation/*` (шаг 14), а не факт. Отвергнуто: единственная попытка дозвона — один потерянный ответ на нестабильной сети превращал бы честный `issue_then_hang` в вечный `retry_required` без шанса когда-либо получить назад уже выданный код; отвергнуто: неограниченное число попыток дозвона — заказ не должен виснуть бесконечно, если поставщик действительно недоступен, а не просто медленно отвечает.
- **Правило fallback A→B и почему у B другой `request_id`.** `pickSupplier` (`suppliers/supplier-plan.util.ts`) идёт по `FALLBACK_CHAIN = [A, B]` и переходит к следующему поставщику только при **определённом** исходе текущего (см. столбец таблицы выше — `unavailable`/`rejected`/`out_of_stock`, но не `unknown`); внутри одного поставщика допускается до `SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER` (по умолчанию 2) повторов, и только на `http_5xx` — прочие определённые неудачи (4xx, `connection_refused`, `out_of_stock`) сразу двигают выбор дальше по цепочке, так как повтор к тому же поставщику ничего не изменит. Переход к B — это новая попытка (`attemptNo` считается заново от 1 для B), поэтому её `request_id` меняется автоматически по формуле выше (`supplierCode` — другая часть ключа): у A и B физически не может быть общего `request_id`, и это не отдельное правило, а прямое следствие того, что `request_id` кодирует, к какому поставщику обращаются. Практическое следствие — заглушка B никогда не увидит `request_id`, ранее посланный A, и не спутает две независимые попытки. Если оба поставщика вернули `out_of_stock`, `pickSupplier` возвращает `null` и `finalizeExhausted` переводит заказ в `out_of_stock` (см. §4.1/§4.2 сценарии, §5.6 модель остатков).
- **Исчерпание цепочки поставщиков без `out_of_stock` и исчерпание бюджета попыток джобы — оба ведут в `delivery_failed`, а не оставляют заказ висеть.** `finalizeExhausted` переводит `delivering → delivery_failed` (не только `→ out_of_stock`), когда `pickSupplier` вернул `null`, а хотя бы один из поставщиков определённо завершился не `out_of_stock` (`http_5xx`-бюджет, `abandoned_unknown`); `failureReason` — компактная сводка `buildSupplierFailureReason` (`"A=http_5xx, B=abandoned_unknown"`). Отдельно, `SupplierFulfilmentService.fulfil` знает номер попытки джобы (`IFulfilInput.attempts`/`maxAttempts`, проброшены из `job.attempts`/`job.max_attempts` в `deliver-order.handler.ts`): на последней попытке (`attempts >= maxAttempts`) оба места, где иначе бросился бы `DeliveryRetryRequiredError` (бюджет времени джобы исчерпан, `settleUnknown` просит повтор), вместо throw вызывают `forceDeliveryFailed` — принудительный `delivering → delivery_failed` в новой транзакции. Без этого второго механизма джоба, у которой кончились попытки воркера (`job.attempts >= job.max_attempts`) раньше, чем поставщики отдали терминальный исход, уходила бы в `dead`, а заказ так и оставался бы в `delivering` навсегда. Поля `attempts`/`maxAttempts` опциональны в `IFulfilInput` — их передаёт только `deliver-order.handler.ts`; отсутствие обоих (например, в существующих юнит-тестах) равносильно «не последняя попытка». Отвергнуто: бросать `DomainError(INTERNAL_ERROR)` при исчерпании цепочки без `out_of_stock` — заказ оставался бы в `delivering` без шанса когда-либо выйти из этого статуса, так как job.attempts тоже конечны.
- **Circuit breaker сознательно не реализован.** Оба поставщика — фиксированный список из двух элементов, каждый вызов уже ограничен собственным `AbortSignal.timeout`, а решение «пробовать ли A» принимается заново на каждой попытке доставки по факту предыдущих исходов **этого же заказа** (`pickSupplier` смотрит только на `delivery_attempts` этого `order_id`), а не по глобальной статистике отказов поставщика. Полноценный breaker (открыт/полуоткрыт/закрыт, скользящее окно ошибок) добавил бы разделяемое состояние между воркерами и параметры (порог, окно восстановления) ради выигрыша, которого при двух известных заранее поставщиках и таймауте 2с на вызов не видно: не давший ответ A всё равно стоит ровно `SUPPLIER_REQUEST_TIMEOUT_MS`, и это уже ограничено сверху `SUPPLIER_JOB_BUDGET_MS` (по умолчанию 10000мс) на весь прогон `fulfil()` одной джобы. Отвергнуто: breaker с состоянием в Postgres — лишняя таблица и синхронизация между воркерами ради оптимизации, которая может дать неверный сигнал (А мог упасть на одном заказе и быть здоровым для остальных — тестовое задание не даёт оснований предполагать иное).

### 5.6 Модель остатков

- **Два режима выдачи, один конвейер.** `products.fulfillment_mode`: `pool` — 3 SKU типа `key`, коды берутся из нашей таблицы `stock_keys` (50 ключей из `stock/keys.json`, раскладка 20/20/10 по порядку файла); `supplier` — остальные 9 SKU, код чеканит поставщик A с фолбэком на B. Соответствие закреплено ограничением `CHECK ((type = 'key') = (fulfillment_mode = 'pool'))`, то есть структурно, а не соглашением. Отвергнуто: «всё через поставщиков» — обесценивает пул ключей и его требование «один ключ — один заказ»; «всё из пула» — делает заглушки поставщиков декоративными, а ловушку таймаута ненастоящей.
- **«Один ключ не может уйти в два заказа» гарантируется базой, а не кодом.** Четыре независимых уровня: атомарная резервация `UPDATE stock_keys … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1)`, частичный уникальный индекс `stock_keys_order_uq` (один ключ — не более одного заказа), `issued_deliveries_stock_key_uq` (один ключ выдан не более одного раза) и `issued_deliveries_order_uq` (один заказ получил не более одной выдачи). Отвергнуто: проверять «свободен ли ключ» в приложении — корректность зависела бы от отсутствия гонки в коде, а не от ограничения в схеме.
- **Счётчик остатка вынесен в отдельную таблицу `sku_stock`, булев флаг `in_stock` остался на `products`.** Часто пишущийся `available_count` не пачкает страницы читающегося каталога, а редко меняющийся флаг служит предикатом частичного индекса витрины. Отвергнуто: колонка-счётчик прямо в `products` — каждая выдача инвалидировала бы горячие страницы каталога и раздувала его индексы.
- **Для режима `supplier` `available_count` — наша локальная оценка доступности поставщика,** засеваемая значением `SUPPLIER_VIRTUAL_STOCK` (по умолчанию 1000): уменьшается на успешной выдаче, обнуляется, когда оба поставщика ответили `out_of_stock`, и восстанавливается админ-эндпоинтом. Отвергнуто: спрашивать остаток у поставщика на каждый показ каталога — сетевой вызов в горячем пути витрины ради числа, которое всё равно устареет к моменту оплаты.
- **Сидер идемпотентен.** `npm run seed:catalog` можно запускать повторно: товары обновляются `ON CONFLICT (sku)`, ключи вставляются `ON CONFLICT DO NOTHING`, а `available_count` для пула пересчитывается из фактически свободных ключей, поэтому уже выданный ключ никогда не «воскресает». Отвергнуто: `TRUNCATE` перед засевом — стирал бы историю заказов и выдач вместе с каталогом.

### 5.7 Наблюдаемость и сверка

- **JSON-логи собственным `JsonLogger` поверх `LoggerService` Nest (~70 строк, ноль зависимостей).** Одна JSON-строка на запись со стабильным набором полей (`ts`, `level`, `event`, `ctx`, `trace_id`, `order_id`, `event_id`, `request_id`, `job_id`, `duration_ms`, `data`, `msg`; `err` — только для `warn`/`error`, стек — только при `LOG_STACK=true`); `msg` дублирует `event`, чтобы обычный `docker logs` читался без `jq`; коды выдачи в логи попадают только маскированными (`A7X1-****-**CD`), полный код живёт лишь в БД и в ответе `GET /orders/:id`. Отвергнуто: `pino`/`nestjs-pino` — три зависимости и решение про транспорт ради пропускной способности, которая на этом масштабе не нужна; требование звучит как «структурированные логи», то есть форма JSON, а не библиотека.
- **Сквозной `trace_id` через `AsyncLocalStorage` (`node:async_hooks`).** Middleware берёт `x-request-id` или генерирует `crypto.randomUUID()`, возвращает его в ответном заголовке и открывает контекст, из которого логгер сам достаёт корреляцию, — поэтому ни один вызов не тащит id параметром; фоновые задачи открывают новый контекст с `trace_id`, сохранённым в `jobs.trace_id` при постановке, так что трасса вебхука доходит до вызова поставщика. Отвергнуто: `nestjs-cls` — обёртка над тем же встроенным API; отвергнуто: ручной проброс `traceId` аргументом — засоряет каждую сигнатуру и молча теряется на первой же забытой передаче.

### 5.8 Каталог

<!-- TODO -->

### 5.9 Зависимости

`apps/api` — 10 продакшн-пакетов, каждый закрывает то, что нецелесообразно писать самому:

| Пакет                                                        | Зачем                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | каркас приложения, DI, HTTP-адаптер                             |
| `@nestjs/config`                                             | загрузка/валидация `.env`                                       |
| `@nestjs/schedule`                                           | периодические задачи воркера/sweeper/сверки в том же процессе   |
| `@nestjs/typeorm`, `typeorm`                                 | доступ к Postgres, миграции, транзакции                         |
| `pg`                                                         | драйвер PostgreSQL, нужен TypeORM                               |
| `class-validator`, `class-transformer`                       | DTO-валидация запросов, тесно завязаны на `ValidationPipe` Nest |
| `reflect-metadata`, `rxjs`                                   | обязательные peer-зависимости Nest                              |

Осознанно не добавлено (написано самостоятельно вместо пакета):

| Вместо                        | Почему свой код                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `axios`                       | глобальный `fetch` уже даёт всё нужное (таймаут через `AbortSignal.timeout`)                                                 |
| `uuid`                        | `crypto.randomUUID()` из стандартной библиотеки                                                                              |
| `pino`/`nestjs-pino`          | требование — «структурированные JSON-логи», не конкретная библиотека; свой `JsonLogger` — ~70 строк (§5.7)                   |
| `bullmq`/redis                | очередь задач — таблица `jobs` + `SELECT ... FOR UPDATE SKIP LOCKED` (§5.4), лишняя инфраструктура не нужна для этого объёма |
| `lodash`                      | стандартная библиотека ES2023 покрывает всё использованное                                                                   |
| `dayjs`/`moment`              | весь проект работает с `Date`/эпохой в миллисекундах, часовых зон нет                                                        |
| `joi`/`zod`                   | `class-validator` уже валидирует DTO; переменные окружения — свой `env.validation.ts`                                        |
| `p-retry`                     | свой `backoff.util.ts` — экспоненциальный бэкофф с джиттером, завязанный на `jobs.attempts`                                  |
| `nestjs-cls`                  | `AsyncLocalStorage` из `node:async_hooks` напрямую (§5.7)                                                                    |
| `@nestjs/terminus`            | `HealthController` — два простых эндпоинта, полноценный модуль здоровья избыточен                                            |
| `@nestjs/swagger`             | таблица эндпоинтов в README (§1.5) достаточна для объёма задания                                                             |
| `helmet`/`compression`/`cors` | нет браузерного клиента этого API                                                                                            |

Не добавлено и не требовалось: `@nestjs/cli` (сборка через голый `tsc`), `supertest`
(HTTP-тесты идут через собственный `app.harness.ts` на реальном `fetch`), `testcontainers`
(CI поднимает Postgres как service-контейнер напрямую), `ts-node` (`tsx` быстрее и уже
используется для watch-режима и CLI), `husky`/`lint-staged` (гейты живут в CI, не в
git-хуках). `apps/supplier-stub` и `tools/` не добавляют ни одной новой продакшн-зависимости
сверх уже перечисленных.

## 6. Масштабирование

- **Горизонтальное масштабирование `apps/api`.** Приложение не хранит состояние в процессе —
  вся координация идёт через Postgres (`SELECT ... FOR UPDATE SKIP LOCKED` для очереди задач
  и резервации ключей пула, уникальные индексы вместо блокировок в памяти), поэтому несколько
  реплик `apps/api` за балансировщиком уже сегодня безопасно делят одну очередь и один пул
  ключей без дополнительных изменений — конкурентные тесты (критерий 1) фактически уже проверяют
  этот сценарий на уровне одного процесса с параллельными запросами.
- **Узкое место — одна БД Postgres.** До появления второй реплики/шардирования единственная
  точка масштабирования — вертикальный рост БД и/или read-реплика для `GET /catalog`
  (частого, редко меняющегося запроса), с записью (заказы, вебхуки, доставки) по-прежнему
  на primary.
- **Очередь задач на таблице `jobs`** (§5.4) масштабируется горизонтально ростом числа воркеров
  ровно так же, как `apps/api` — `SKIP LOCKED` не даёт двум воркерам взять одну и ту же джобу.
  Предел этого подхода — конкуренция за строки таблицы `jobs` при очень большом числе воркеров;
  для объёма задания (единицы-десятки воркеров) это не проблема. При кратно большей нагрузке
  логичный следующий шаг — вынести очередь в `bullmq`/redis, но это сознательно отвергнуто
  сейчас как преждевременная инфраструктура (§5.9).
- **Circuit breaker для интеграции с поставщиками сознательно не реализован** — обоснование
  то же самое, что и в §5.5 (фиксированный список из двух поставщиков, decision по-заказно,
  а не по глобальной статистике, таймаут уже ограничен сверху `SUPPLIER_JOB_BUDGET_MS`): см.
  §5.5 «Circuit breaker сознательно не реализован» — при росте числа внешних поставщиков это
  первое, что стоит пересмотреть.

## 7. Каталог под нагрузкой: EXPLAIN ANALYZE

### 7.1 Стенд

<!-- TODO -->

### 7.2 Наивный запрос

<!-- TODO -->

### 7.3 Спроектированный запрос

<!-- TODO -->

### 7.4 Разбор

<!-- TODO -->

### 7.5 Как воспроизвести

<!-- TODO -->

## 8. Затраченное время

По меткам коммитов (`git log`), 14 коммитов с 2026-08-31 по 2026-09-03:

| Дата                    | Что сделано                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-31, 15:20–17:46 | bootstrap воркспейса, скелет API, схема БД и первые миграции                                                                               |
| 2026-09-01, 02:44–15:42 | каталог + сидер, заказы + машина состояний, бухгалтерская книга, разбивка `spec.md` на файлы, вебхук оплаты (TX-W), очередь задач и воркер |
| 2026-09-02, 11:32       | доставка из пула (TX-P, `SKIP LOCKED`), заглушка поставщика со сценариями                                                                  |
| 2026-09-03, 01:13–10:39 | фолбэк доставки A→B, CLI-инструменты в `tools/`                                                                                            |

Работа шла сессиями, растянутыми на 3 календарных дня; суммарное активное время — оценочно
12–15 часов чистой работы (без учёта времени на чтение спецификации между сессиями).

## 9. Что осталось за рамками

- **Этап 4 задания (sweeper-восстановление + admin-эндпоинты, §4.3) реализован не полностью,
  этап 5 (каталог под нагрузкой) — сознательно не реализован.** Из этапа 4 сделаны: все 6 проходов
  sweeper'а, `POST /admin/sweeper/run`, `POST /admin/products/:sku/restock`,
  `POST /admin/orders/:orderId/redeliver`, `AdminTokenGuard` (включая `ADMIN_API_ENABLED=false` и
  пустой `ADMIN_TOKEN`). Не сделаны: `POST /admin/force-paid`, `POST /admin/refund`,
  `POST /admin/jobs/drain`, `POST /admin/reconcile/stock`, `GET /reconciliation/*` (отдельный
  сервис/отчёт сверки остатков вне sweeper'а) — они были в исходном плане (`spec/12-
  implementation-plan.md`, шаг 15), но не вошли в согласованный скоуп восстановления. Раздел 7
  (`EXPLAIN ANALYZE`, этап 5) оставлен пустым `<!-- TODO -->`.
- **Проверка подписи вебхука** не реализована — задание не описывает конкретный механизм
  подписи платёжного провайдера, а без него любая имитация была бы произвольной.
- **Многопозиционные заказы** не поддерживаются — модель заказа рассчитана на один SKU
  и `quantity=1` (ограничение `CHECK` в схеме); задание описывает выдачу одного кода/ключа
  на заказ, расширение до корзины не требовалось.
- **Полнотекстовый/нечёткий поиск по каталогу** — `GET /catalog?q=` делает простой `ILIKE`,
  без `pg_trgm`/полнотекстовых индексов: для 12 SKU в каталоге это не бутылочное горлышко,
  а полноценный поиск относится к этапу 5 (каталог под нагрузкой), который вне скоупа.
