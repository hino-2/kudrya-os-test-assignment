import { describe, expect, it } from 'vitest';

import { SEED_KEY_DISTRIBUTION, SHARED_SEED_SQL, SHARED_SEED_SQL_NAMES } from '../helpers/harness.constants';
import { normalizeSql, readToolsKeyDistribution, readToolsSql } from '../helpers/parity.helper';

describe('seed sql parity between tools/ and the test helper', () => {
  it.each(SHARED_SEED_SQL_NAMES)('%s matches the tools constant', (name) => {
    expect(normalizeSql(SHARED_SEED_SQL[name])).toBe(readToolsSql(name));
  });

  it('uses the same 20/20/10 key distribution as the tools constant', () => {
    expect(readToolsKeyDistribution()).toEqual([...SEED_KEY_DISTRIBUTION]);
  });
});
