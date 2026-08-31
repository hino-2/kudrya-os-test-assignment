// `pg` не публикует .d.ts и в проекте нет @types/pg (бюджет зависимостей §13 не допускает
// добавление пакета ради типов одной функции) — минимальное окружение объявлено вручную,
// только то, что реально используется в tools/src.
declare module 'pg' {
  export interface QueryResult<R> {
    rows: R[];
    rowCount: number | null;
  }

  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query<R = unknown>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
}
