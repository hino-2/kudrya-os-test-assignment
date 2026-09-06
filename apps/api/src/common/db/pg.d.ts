// `pg` не публикует .d.ts и в проекте нет @types/pg (бюджет зависимостей §13 не допускает
// добавление пакета ради типов одной функции) — минимальное окружение объявлено вручную,
// только то, что реально используется (`pg-types.util.ts`, `migrate.ts`).
declare module 'pg' {
  export const types: {
    setTypeParser(oid: number, parseFn: (value: string | null) => unknown): void;
  };

  export class Client {
    constructor(config: { connectionString: string; connectionTimeoutMillis?: number });
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
    // Client наследует EventEmitter: без подписки на 'error' любой FATAL на простаивающей
    // сессии превращается в Unhandled 'error' event и убивает процесс сырым стектрейсом
    on(event: 'error', listener: (error: Error) => void): void;
  }
}
