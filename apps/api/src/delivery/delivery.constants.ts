export const ATTEMPT_STATE = {
  PENDING: 'pending',
  IN_FLIGHT: 'in_flight',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  ABANDONED_UNKNOWN: 'abandoned_unknown',
} as const;

export const DELIVERY_SOURCE = {
  POOL: 'pool',
  SUPPLIER: 'supplier',
} as const;

export const DELIVERY_OUTCOME = {
  DELIVERED: 'delivered',
  OUT_OF_STOCK: 'out_of_stock',
  ALREADY_DELIVERED: 'already_delivered',
  SKIPPED: 'skipped',
  DELIVERY_FAILED: 'delivery_failed',
} as const;

export const DELIVERY_OUT_OF_STOCK_REASON = 'out_of_stock';

// через что settleStep пришёл к исходу: слепой POST /issue или авторитетный GET /issue/:request_id
export const SETTLE_VIA = {
  ISSUE: 'issue',
  RESOLVE: 'resolve',
} as const;

// error_reason попытки, которую поставщик на resolve-шаге отрицает сам (404 на чтении)
export const DELIVERY_LOOKUP_NOT_ISSUED_REASON = 'lookup_not_found';

export const DELIVERY_ATTEMPT_RESOLVE_CONFLICT_MESSAGE = 'Состояние попытки изменилось во время дозвона к поставщику — требуется повтор задачи';

export const SUPPLIER_JOB_LAST_ATTEMPT_MESSAGE_TEMPLATE = 'Последняя попытка задачи выдачи через поставщика исчерпана без терминального исхода: %s';

export const DELIVERY_TRANSACTION_REQUIRED_MESSAGE = 'Операция доставки требует открытой транзакции';

export const ISSUED_DELIVERY_LOST_MESSAGE = 'Строка выданного товара потеряна после вставки';

export const DELIVERY_ATTEMPT_LOST_MESSAGE = 'Строка попытки выдачи потеряна после вставки';

export const SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE = 'Бюджет времени на выдачу через поставщика в рамках задачи исчерпан';

export const SUPPLIER_ISSUED_WITHOUT_CODE_MESSAGE = 'Поставщик вернул исход issued без кода — нарушение контракта supplier.client';

export const DELIVERY_ATTEMPT_UNKNOWN_RETRY_MESSAGE_TEMPLATE = 'Статус попытки %s остаётся неизвестным — требуется повтор задачи для дозвона к поставщику';

export const ALL_SUPPLIERS_FAILED_MESSAGE_TEMPLATE = 'Не удалось выдать заказ ни у одного поставщика: %s';

export const DELIVERY_FULFILMENT_SERVICES = 'DELIVERY_FULFILMENT_SERVICES';

export const INVALID_DELIVER_ORDER_PAYLOAD_MESSAGE = 'Некорректный payload задачи deliver_order';

export const ORDER_NOT_FOUND_FOR_DELIVERY_MESSAGE_TEMPLATE = 'Заказ %s не найден при попытке выдачи';

export const UNKNOWN_FULFILLMENT_MODE_MESSAGE_TEMPLATE = 'Неизвестный режим выдачи товара: %s';

export const LOCK_ORDER_FOR_DELIVERY_SQL = `
  SELECT o.id, o.ext_id, o.status, o.delivery_generation AS generation, o.product_id,
         o.sku, o.total_minor AS amount_minor, o.currency, p.fulfillment_mode
  FROM orders o
  JOIN products p ON p.id = o.product_id
  WHERE o.id = $1
  FOR UPDATE OF o
`;

export const FIND_FULFILLMENT_MODE_SQL = `
  SELECT p.fulfillment_mode
  FROM orders o
  JOIN products p ON p.id = o.product_id
  WHERE o.id = $1
`;

export const FIND_ISSUED_DELIVERY_SQL = `
  SELECT id, code FROM issued_deliveries WHERE order_id = $1
`;

export const INSERT_ISSUED_DELIVERY_SQL = `
  INSERT INTO issued_deliveries (order_id, product_id, sku, code, source, stock_key_id)
  VALUES ($1, $2, $3, $4, 'pool', $5)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id, code
`;

export const INSERT_SUPPLIER_ISSUED_DELIVERY_SQL = `
  INSERT INTO issued_deliveries (order_id, product_id, sku, code, source, supplier_code, delivery_attempt_id)
  VALUES ($1, $2, $3, $4, 'supplier', $5, $6)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id, code
`;

const DELIVERY_ATTEMPT_COLUMNS = `
  id, order_id, supplier_code, attempt_no, request_id, sku, delivery_generation, state, http_status,
  response_code, error_kind, error_reason, resolve_attempts, next_resolve_at, started_at, finished_at,
  duration_ms, created_at, updated_at
`;

// намеренно БЕЗ фильтра по поколению: с ним зависшая открытая попытка поколения N-1 стала бы
// невидимой для resume-пути — pickNextAttempt вставил бы новую, получил бы ON CONFLICT DO NOTHING
// (частичный delivery_attempts_open_uq действует на весь заказ), перечитал бы тем же запросом
// и снова получил null ⇒ DELIVERY_ATTEMPT_LOST_MESSAGE на каждом прогоне. Порядок в prepareStep
// (сначала resume/abandon, потом pick) как раз и рассчитан на межпоколенческий случай.
export const FIND_OPEN_ATTEMPT_SQL = `
  SELECT ${DELIVERY_ATTEMPT_COLUMNS}
  FROM delivery_attempts
  WHERE order_id = $1 AND state IN ('pending','in_flight','unknown')
  LIMIT 1
`;

// план фолбэка считается в границах одного поколения — иначе исчерпанная цепочка A→B из
// прошлого поколения навсегда запрещает новый звонок поставщику после restock/redeliver.
// Отдельный индекс не нужен: переформованный delivery_attempts_slot_uq
// (order_id, delivery_generation, …) покрывает этот запрос ведущим префиксом.
export const FIND_ATTEMPTS_BY_ORDER_SQL = `
  SELECT ${DELIVERY_ATTEMPT_COLUMNS}
  FROM delivery_attempts
  WHERE order_id = $1 AND delivery_generation = $2
  ORDER BY id
`;

// TX-S1: durable-маркер 'in_flight' должен закоммититься до HTTP-вызова поставщику — без него
// таймаут/сбой воркера после отправки запроса неотличим от того, что запрос вообще не уходил.
export const INSERT_DELIVERY_ATTEMPT_SQL = `
  INSERT INTO delivery_attempts (order_id, supplier_code, attempt_no, request_id, sku, delivery_generation, state, started_at)
  VALUES ($1,$2,$3,$4,$5,$6,'in_flight', now())
  -- предикат WHERE обязателен: без него Postgres не свяжет ON CONFLICT с частичным уникальным индексом
  -- цель конфликта намеренно остаётся по order_id, без поколения: инвариант — "не более одной
  -- открытой заявки к поставщику на заказ по всем поколениям". С поколением в индексе стали бы
  -- легальны одновременно открытая попытка поколения 1 и поколения 2, то есть два живых
  -- POST /issue по одному оплаченному заказу — ровно то окно двойной выдачи, которое закрывает вся схема.
  ON CONFLICT (order_id) WHERE state IN ('pending','in_flight','unknown') DO NOTHING
  RETURNING ${DELIVERY_ATTEMPT_COLUMNS}
`;

// возобновление уже открытой попытки (in_flight после сбоя воркера, unknown в ожидании
// дозвона) — request_id не меняется, повторный POST /issue с тем же request_id идемпотентен
// на стороне поставщика
export const RESUME_DELIVERY_ATTEMPT_SQL = `
  UPDATE delivery_attempts
  SET state = 'in_flight', started_at = now(), updated_at = now()
  WHERE id = $1 AND state IN ('in_flight','unknown')
  RETURNING ${DELIVERY_ATTEMPT_COLUMNS}
`;

export const FINALIZE_ATTEMPT_SUCCEEDED_SQL = `
  UPDATE delivery_attempts
  SET state = 'succeeded', http_status = $2, response_code = $3, finished_at = now(),
      duration_ms = $4, updated_at = now()
  WHERE id = $1 AND state = 'in_flight'
  RETURNING id
`;

export const FINALIZE_ATTEMPT_FAILED_SQL = `
  UPDATE delivery_attempts
  SET state = 'failed', http_status = $2, error_kind = $3, error_reason = $4, finished_at = now(),
      duration_ms = $5, updated_at = now()
  WHERE id = $1 AND state = 'in_flight'
  RETURNING id
`;

// resolve_attempts считает каждый переход попытки в unknown (включая первый) — бюджет
// дозвонов до поставщика перед тем, как считать попытку abandoned_unknown (см. supplier-plan.util)
export const PROMOTE_ATTEMPT_TO_UNKNOWN_SQL = `
  UPDATE delivery_attempts
  SET state = 'unknown', http_status = $2, error_kind = $3, error_reason = $4,
      resolve_attempts = resolve_attempts + 1, next_resolve_at = $5, updated_at = now()
  WHERE id = $1 AND state = 'in_flight'
  RETURNING resolve_attempts
`;

// abandoned_unknown выходит из-под partial unique index delivery_attempts_open_uq — освобождает
// заказ для попытки со следующим поставщиком, не дожидаясь ручного разрешения (см. README §6).
// in_flight в предикате обязателен: единственный вызывающий (resolve-ветка settleStep) работает
// с попыткой, уже возобновлённой в in_flight в TX-S1, — без этого CAS не совпал бы и попытка
// осталась бы открытой навсегда. 'unknown' оставлен для попыток, которые никто не возобновлял.
//
// started_at фенсит расширенный предикат: бросить in_flight-попытку разрешено только тому, кто
// сам её и возобновил. Без фенса два воркера на одной попытке (RESUME_DELIVERY_ATTEMPT_SQL
// допускает in_flight → in_flight) могли бы разойтись: один бросает попытку и минтит у B, второй
// в это же время получает код от A. Сравнение идёт через date_trunc: драйвер отдаёт timestamptz
// уже усечённым до миллисекунд, поэтому точное равенство с сохранённым микросекундным значением
// не совпало бы никогда.
//
// Известный потолок: now() в RESUME_DELIVERY_ATTEMPT_SQL — это transaction_timestamp(), и он
// фиксируется до ожидания блокировки заказа, поэтому две транзакции, начавшиеся в одну
// миллисекунду, записали бы одинаковый started_at и фенс выродился бы. Для этого нужны два живых
// прогона одной джобы (их и так не даёт jobs_live_uq вместе с JOB_LOCK_TTL_MS >>
// SUPPLIER_JOB_BUDGET_MS), поэтому оставлено как есть. Герметичный вариант — отдельная колонка
// resume_seq со точным сравнением, но это миграция.
export const MARK_ATTEMPT_ABANDONED_SQL = `
  UPDATE delivery_attempts
  SET state = 'abandoned_unknown', finished_at = now(), updated_at = now()
  WHERE id = $1 AND state IN ('unknown','in_flight')
    AND date_trunc('milliseconds', started_at) = $2
  RETURNING id
`;

// sweeper pass 5a: попытки, зависшие в in_flight дольше attemptInflightTimeoutMs — воркер,
// скорее всего, умер после TX-S1 коммита, не успев дождаться ответа поставщика. Нет
// специализированного индекса под этот скан (см. README §4.3, осознанный компромисс).
export const DEMOTE_STALE_INFLIGHT_SQL = `
  UPDATE delivery_attempts a
  SET state = 'unknown', error_kind = 'inflight_expired', error_reason = $2,
      resolve_attempts = resolve_attempts + 1, next_resolve_at = now(), updated_at = now()
  FROM (
    SELECT id FROM delivery_attempts
    WHERE state = 'in_flight' AND started_at < now() - ($1 || ' milliseconds')::interval
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT $3
  ) stale
  WHERE a.id = stale.id
  RETURNING a.id, a.order_id, a.supplier_code, a.attempt_no
`;

// sweeper pass 5b: unknown-попытки, готовые к передозвону поставщику. Выборка самопродвигающаяся
// (claim, а не read): раньше pass 5b не двигал ни resolve_attempts, ни next_resolve_at, поэтому
// заказ, чью попытку джоба уже не трогает (delivery_failed/out_of_stock/delivered), ставился в
// очередь на каждом тике вечно.
//
// Разделение владения (см. spec 07): pass 5b владеет ПЛАНИРОВАНИЕМ строго ниже потолка
// (resolve_attempts < $2), джоба доставки — РАЗРЕШЕНИЕМ и отказом строго на потолке и выше
// (см. resumeOpenAttempt/settleStep). Одновременный доступ к одной строке исключает не счётчик,
// а фильтр по state: строку, которой занята джоба, resumeOpenAttempt держит в in_flight, а
// pass 5b выбирает только state='unknown'. Счётчик задаёт лишь момент переключения канала —
// pass 5a, например, демотирует in_flight в unknown вообще независимо от resolve_attempts.
// Завершаемость: на тике, где счётчик доходит до потолка−1, pass 5b ставит джобу, и та доводит
// попытку до решения; на потолке pass 5b выбирает ноль строк и ноль джоб. Если джоба умрёт
// совсем — её пересоздаст pass 2.
//
// Бэкофф задан плоским retryMaxMs прямо в SQL, а не через computeNextRunAt: per-row
// resolve_attempts до выборки неизвестен, а плоское значение монотонно, ограничено сверху, и
// реальным полом всё равно остаётся интервал тика свипера.
//
// Идёт через idx_delivery_attempts_resolvable (next_resolve_at) WHERE state = 'unknown' —
// он же обслуживает и предикат, и ORDER BY; resolve_attempts и o.status отбираются по heap/join.
export const CLAIM_RESOLVABLE_UNKNOWN_ATTEMPTS_SQL = `
  UPDATE delivery_attempts a
  SET resolve_attempts = a.resolve_attempts + 1,
      next_resolve_at = now() + ($1 || ' milliseconds')::interval,
      updated_at = now()
  FROM (
    SELECT a2.id, a2.order_id, o.ext_id, o.delivery_generation
    FROM delivery_attempts a2
    JOIN orders o ON o.id = a2.order_id
    WHERE a2.state = 'unknown'
      AND a2.next_resolve_at <= now()
      AND a2.resolve_attempts < $2
      AND o.status IN ('paid','delivering')
    ORDER BY a2.next_resolve_at
    FOR UPDATE OF a2 SKIP LOCKED
    LIMIT $3
  ) claimed
  WHERE a.id = claimed.id
  RETURNING a.id, claimed.order_id, claimed.ext_id, claimed.delivery_generation
`;
