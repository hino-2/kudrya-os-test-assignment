import { types } from 'pg';

import { BIGINT_OID } from './db.constants';

let registered = false;

export function registerPgTypeParsers(): void {
  if (registered) {
    return;
  }

  types.setTypeParser(BIGINT_OID, parseBigIntColumn);
  registered = true;
}

function parseBigIntColumn(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`BIGINT вне безопасного диапазона JS: ${value}`);
  }

  return parsed;
}
