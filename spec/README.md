# Спецификация — постатейно

`spec.md` разбит на файлы по §, чтобы не читать весь документ на каждом шаге. Читать
только файл(ы) нужного раздела для текущего шага реализации (см. `12-implementation-plan.md`).

| Файл | § | Тема |
|---|---|---|
| `00-intro.md` | — | Заголовок, ссылки на requirements.md / stock/*.json |
| `01-solution-overview.md` | §1 | Процессы, порты, диаграмма, happy path |
| `02-repository-layout.md` | §2 | Структура репозитория, стиль кода, README.md как deliverable |
| `03-data-model.md` | §3 | Таблицы: products, sku_stock, stock_keys, orders, payment_events, delivery_attempts, ... |
| `04-order-state-machine.md` | §4 | Машина состояний заказа |
| `05-exactly-once-design.md` | §5 | Exactly-once вебхуки (stage 2) |
| `06-supplier-integration.md` | §6 | Интеграция с поставщиком, ловушка таймаута (stage 3) |
| `07-reconciliation-observability.md` | §7 | Сверка, наблюдаемость, восстановление (stage 4) |
| `08-catalog-under-load.md` | §8 | Каталог под нагрузкой (stage 5) |
| `09-http-api-surface.md` | §9 | HTTP API — все эндпоинты |
| `10-configuration.md` | §10 | Конфигурация, переменные окружения |
| `11-test-plan.md` | §11 | План тестов |
| `12-implementation-plan.md` | §12 | План шагов для агентов-разработчиков (главный ориентир) |
| `13-dependency-budget.md` | §13 | Бюджет зависимостей |
| `14-risks-open-questions.md` | §14 | Риски и открытые вопросы |

`spec.md` в корне репозитория оставлен как есть (источник истины при конфликте/регенерации
этих файлов); эти файлы — его расфасовка для точечного чтения.
