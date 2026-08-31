// `pg` не публикует .d.ts и в проекте нет @types/pg (бюджет зависимостей §13 не допускает
// добавление пакета ради типов одной функции) — минимальное окружение объявлено вручную,
// только то, что реально используется (`pg-types.util.ts`).
declare module 'pg' {
  export const types: {
    setTypeParser(oid: number, parseFn: (value: string | null) => unknown): void;
  };
}
