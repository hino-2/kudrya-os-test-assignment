import { Client } from 'pg';
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

import dataSource from './data-source';
import {
  DB_CONNECTION_TIMEOUT_MS,
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_DB_URL_MISSING_MESSAGE,
  MIGRATION_FAILED_MESSAGE,
  MIGRATION_LOCK_SESSION_LOST_MESSAGE,
  MIGRATION_LOCK_SQL,
  MIGRATION_SET_LOCK_TIMEOUT_SQL,
  MIGRATION_SET_STATEMENT_TIMEOUT_SQL,
} from './db.constants';

async function runMigrations(): Promise<void> {
  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

// Session-level advisory-лок держит отдельный pg.Client, а не соединение из пула DataSource:
// две реплики api на пустой таблице migrations иначе применяют один и тот же набор
// одновременно, а взять соединение пула под лок нельзя — при DB_POOL_SIZE=1 (значение
// разрешённое, min: 1) runMigrations не получил бы второе соединение и процесс завис бы
// навсегда, удерживая лок и запирая за собой все остальные реплики.
async function migrate(): Promise<void> {
  const { url } = dataSource.options as PostgresDataSourceOptions;

  if (url === undefined) {
    throw new Error(MIGRATION_DB_URL_MISSING_MESSAGE);
  }

  const lockClient = new Client({
    connectionString: url,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  });

  // сессия лока всё время простаивает, и любой FATAL на ней (рестарт Postgres,
  // idle_session_timeout, pg_terminate_backend) приходит событием 'error'. Без подписчика
  // Node падает с Unhandled 'error' event: миграция всё равно обрывается, но причина
  // теряется в сыром стектрейсе вместо внятного сообщения.
  lockClient.on('error', (error: Error) => {
    console.error(MIGRATION_LOCK_SESSION_LOST_MESSAGE, error.message);
  });

  // connect внутри try, а не перед ним: так гарантия «соединение закрыто на любом пути выхода»
  // структурная, а не выведенная из того, что pg сам рвёт поток на своих путях отказа подключения.
  // end() после неудачного connect не no-op (его быстрая ветка проверяет connection._connecting,
  // а тот выставлен с самого начала подключения и не сбрасывается) — он закрывает уже мёртвый
  // сокет и завершается сразу, а отвергнуться не может: Client.end только resolve'ит.
  try {
    await lockClient.connect();
    await lockClient.query(MIGRATION_SET_LOCK_TIMEOUT_SQL);
    await lockClient.query(MIGRATION_SET_STATEMENT_TIMEOUT_SQL);
    await lockClient.query(MIGRATION_LOCK_SQL, [MIGRATION_ADVISORY_LOCK_KEY]);

    await runMigrations();
  } finally {
    // pg_advisory_unlock не нужен: session-level лок снимается закрытием сессии, а end()
    // отсюда выполняется на любом пути выхода
    await lockClient.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(MIGRATION_FAILED_MESSAGE, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
