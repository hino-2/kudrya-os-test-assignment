import { Client } from 'pg';

import { SAFE_INT_MESSAGE, TX_BEGIN, TX_COMMIT, TX_ROLLBACK } from './lib.constants';

export async function connectClient(databaseUrl: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  return client;
}

async function rollbackQuietly(client: Client): Promise<void> {
  try {
    await client.query(TX_ROLLBACK);
  } catch {
    // сбой отката не должен подменять исходную причину падения транзакции
  }
}

export async function withTransaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query(TX_BEGIN);

  try {
    const result = await work();

    await client.query(TX_COMMIT);

    return result;
  } catch (error) {
    await rollbackQuietly(client);

    throw error;
  }
}

export function toSafeInt(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${SAFE_INT_MESSAGE}: ${field}="${String(value)}"`);
  }

  return parsed;
}
