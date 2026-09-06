import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PG_ERROR_CODE } from '../../src/common/db/db.constants';
import { startDb } from '../helpers/db.harness';
import type { IDbHarness } from '../helpers/harness.interfaces';

const INSERT_PRODUCT_SQL = `
  INSERT INTO products (sku, name, type, price_minor, currency, fulfillment_mode, is_active, in_stock)
  VALUES ($1, 'Проба гранулярности цены', 'topup', $2, 'RUB', 'supplier', TRUE, TRUE)
`;

const DELETE_PRODUCT_SQL = 'DELETE FROM products WHERE sku = $1';

const PROBE_SKU = 'ZZ-PRICE-GRANULARITY';

let harness: IDbHarness;

beforeAll(async () => {
  harness = await startDb();
});

afterAll(async () => {
  await harness?.dataSource.query(DELETE_PRODUCT_SQL, [PROBE_SKU]);
  await harness?.stop();
});

// M10: вебхук принимает только целые major-суммы (@IsInt amount ⇒ amountMinor кратен 100), а
// guardAmount сверяет их с total_minor = price_minor. Товар с ценой 49999 поэтому неоплачиваем
// навсегда: любой платёж уходит в rejected_amount, а витрина бодро показывает 499.99
describe('products price granularity', () => {
  it('rejects a price that is not a whole major unit', async () => {
    let caught: unknown = null;

    try {
      await harness.dataSource.query(INSERT_PRODUCT_SQL, [PROBE_SKU, 49999]);
    } catch (error) {
      caught = error;
    }

    expect((caught as { code?: string } | null)?.code).toBe(PG_ERROR_CODE.CHECK_VIOLATION);
    expect((caught as { constraint?: string } | null)?.constraint).toBe('products_price_granularity_ck');
  });

  it('accepts a whole major price', async () => {
    await harness.dataSource.query(INSERT_PRODUCT_SQL, [PROBE_SKU, 49900]);
    await harness.dataSource.query(DELETE_PRODUCT_SQL, [PROBE_SKU]);
  });
});
