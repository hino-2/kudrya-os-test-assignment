import * as fs from 'node:fs';

import {
  CONSTANT_NOT_FOUND_MESSAGE,
  KEY_DISTRIBUTION_BLOCK_PATTERN,
  KEY_SLICE_PATTERN,
  SQL_WHITESPACE_PATTERN,
  TOOLS_SEED_CONSTANTS_FILE,
} from './harness.constants';
import type { ISeedKeySlice } from './harness.interfaces';
import type { SharedSeedSqlName } from './harness.type';

function readToolsSource(): string {
  return fs.readFileSync(TOOLS_SEED_CONSTANTS_FILE, 'utf8');
}

export function normalizeSql(sql: string): string {
  return sql.replace(SQL_WHITESPACE_PATTERN, ' ').trim();
}

export function readToolsSql(name: SharedSeedSqlName): string {
  const match = new RegExp(`export const ${name} = \`([^\`]*)\``).exec(readToolsSource());

  if (match === null) {
    throw new Error(`${CONSTANT_NOT_FOUND_MESSAGE}: ${name}`);
  }

  return normalizeSql(match[1]);
}

export function readToolsKeyDistribution(): ISeedKeySlice[] {
  const block = KEY_DISTRIBUTION_BLOCK_PATTERN.exec(readToolsSource());

  if (block === null) {
    throw new Error(`${CONSTANT_NOT_FOUND_MESSAGE}: KEY_DISTRIBUTION`);
  }

  return [...block[1].matchAll(KEY_SLICE_PATTERN)].map((match) => ({
    sku: match[1],
    count: Number(match[2]),
  }));
}
