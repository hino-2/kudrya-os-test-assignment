import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogItemResponseDto } from '../../src/catalog/dto/catalog-item.response.dto';
import type { CatalogPageResponseDto } from '../../src/catalog/dto/catalog-page.response.dto';
import type { IErrorEnvelope } from '../../src/common/errors/errors.interfaces';
import { startApi } from '../helpers/app.harness';
import {
  COLLATION_PROBE_SKUS,
  COLLATION_PROBE_SQL,
  EXPECTED_SKU_COLLATION,
  SEEDED_SKUS_IN_BYTE_ORDER,
  SKU_COLLATION_SQL,
  TEST_CATALOG_DEFAULT_LIMIT,
  TEST_CATALOG_MAX_LIMIT,
} from '../helpers/harness.constants';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { seedCatalog } from '../helpers/seed.helper';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface ICollationRow {
  collname: string;
}

let harness: IApiHarness;

async function get<T>(pathAndQuery: string): Promise<IHttpResult<T>> {
  const response = await fetch(`${harness.baseUrl}${pathAndQuery}`);
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

function itemBySku(page: CatalogPageResponseDto, sku: string): CatalogItemResponseDto {
  const item = page.items.find((candidate) => candidate.sku === sku);

  if (item === undefined) {
    throw new Error(`Товар ${sku} отсутствует в выдаче каталога`);
  }

  return item;
}

beforeAll(async () => {
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
  await seedCatalog(harness.dataSource);
});

describe('GET /catalog', () => {
  it('returns the whole seeded catalog with the default page size', async () => {
    const { status, body } = await get<CatalogPageResponseDto>('/catalog');

    expect(status).toBe(200);
    expect(body.items).toHaveLength(12);
    expect(body.limit).toBe(TEST_CATALOG_DEFAULT_LIMIT);
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();

    expect(itemBySku(body, 'STEAM-TOPUP-500')).toMatchObject({
      name: 'Пополнение Steam 500 ₽',
      type: 'topup',
      amount_minor: 50000,
      amount: 500,
      currency: 'RUB',
      image: 'assets/steam.png',
      available_count: 1000,
      in_stock: true,
    });
  });

  it('orders items by sku in byte order', async () => {
    const { body } = await get<CatalogPageResponseDto>('/catalog');

    expect(body.items.map((item) => item.sku)).toEqual([...SEEDED_SKUS_IN_BYTE_ORDER]);
  });

  it('declares the C collation on products.sku', async () => {
    const rows = await harness.dataSource.query<ICollationRow[]>(SKU_COLLATION_SQL);

    expect(rows.map((row) => row.collname)).toEqual([EXPECTED_SKU_COLLATION]);
  });

  it('orders the probe skus by byte value', async () => {
    await harness.dataSource.query(COLLATION_PROBE_SQL);

    const { body } = await get<CatalogPageResponseDto>('/catalog');
    const probes = body.items
      .map((item) => item.sku)
      .filter((sku) => (COLLATION_PROBE_SKUS as readonly string[]).includes(sku));

    expect(probes).toEqual([...COLLATION_PROBE_SKUS]);
  });

  it('filters by type and exposes the pool key counts', async () => {
    const { status, body } = await get<CatalogPageResponseDto>('/catalog?type=key');

    expect(status).toBe(200);
    expect(body.items).toHaveLength(3);
    expect(itemBySku(body, 'KEY-CS2-PRIME').available_count).toBe(20);
    expect(itemBySku(body, 'KEY-GTA5').available_count).toBe(20);
    expect(itemBySku(body, 'KEY-EFT').available_count).toBe(10);
    expect(body.items.every((item) => item.in_stock)).toBe(true);
  });

  it('honours limit and reports that more rows exist', async () => {
    const { body } = await get<CatalogPageResponseDto>('/catalog?limit=5');

    expect(body.items).toHaveLength(5);
    expect(body.limit).toBe(5);
    expect(body.has_more).toBe(true);
  });

  it('clamps the requested limit to CATALOG_MAX_LIMIT', async () => {
    const { status, body } = await get<CatalogPageResponseDto>('/catalog?limit=100');

    expect(status).toBe(200);
    expect(body.limit).toBe(TEST_CATALOG_MAX_LIMIT);
    expect(body.items).toHaveLength(12);
    expect(body.has_more).toBe(false);
  });

  it('filters by sku prefix', async () => {
    const matching = await get<CatalogPageResponseDto>('/catalog?q=STEAM');
    const empty = await get<CatalogPageResponseDto>('/catalog?q=NOPREFIX');

    expect(matching.body.items).toHaveLength(3);
    expect(empty.body.items).toHaveLength(0);
    expect(empty.body.has_more).toBe(false);
  });

  it('escapes LIKE metacharacters in the sku prefix', async () => {
    const wildcard = await get<CatalogPageResponseDto>('/catalog?q=KEY_');
    const literal = await get<CatalogPageResponseDto>('/catalog?q=KEY-');

    expect(wildcard.status).toBe(200);
    expect(wildcard.body.items).toHaveLength(0);
    expect(literal.body.items).toHaveLength(3);
  });

  it('rejects malformed query parameters', async () => {
    const cases = [
      '/catalog?limit=0',
      '/catalog?limit=101',
      '/catalog?type=bogus',
      '/catalog?in_stock=maybe',
      '/catalog?unknown=1',
    ];

    for (const path of cases) {
      const { status, body } = await get<IErrorEnvelope>(path);

      expect(status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('hides out-of-stock items by default and shows them on demand', async () => {
    await harness.dataSource.query(
      "UPDATE sku_stock SET available_count = 0 WHERE product_id = (SELECT id FROM products WHERE sku = 'KEY-GTA5')",
    );
    await harness.dataSource.query("UPDATE products SET in_stock = FALSE WHERE sku = 'KEY-GTA5'");

    const defaultPage = await get<CatalogPageResponseDto>('/catalog');

    expect(defaultPage.body.items).toHaveLength(11);
    expect(defaultPage.body.items.some((item) => item.sku === 'KEY-GTA5')).toBe(false);

    const everything = await get<CatalogPageResponseDto>('/catalog?in_stock=false');

    expect(everything.body.items).toHaveLength(12);
    expect(itemBySku(everything.body, 'KEY-GTA5')).toMatchObject({ available_count: 0, in_stock: false });
  });

  it('never lists an inactive product, even with in_stock=false', async () => {
    await harness.dataSource.query("UPDATE products SET is_active = FALSE WHERE sku = 'KEY-GTA5'");

    const defaultPage = await get<CatalogPageResponseDto>('/catalog');
    const everything = await get<CatalogPageResponseDto>('/catalog?in_stock=false');

    expect(defaultPage.body.items).toHaveLength(11);
    expect(everything.body.items).toHaveLength(11);
    expect(everything.body.items.some((item) => item.sku === 'KEY-GTA5')).toBe(false);
  });
});

describe('GET /catalog/:sku', () => {
  it('returns a single item', async () => {
    const { status, body } = await get<CatalogItemResponseDto>('/catalog/KEY-GTA5');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      sku: 'KEY-GTA5',
      type: 'key',
      amount_minor: 199000,
      amount: 1990,
      currency: 'RUB',
      image: 'assets/gta5.png',
      available_count: 20,
      in_stock: true,
    });
  });

  it('returns the PRODUCT_NOT_FOUND envelope for an unknown sku', async () => {
    const { status, body } = await get<IErrorEnvelope>('/catalog/NOPE');

    expect(status).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(body.error.message).toBe('Товар не найден');
    expect(body.error.details).toEqual({ sku: 'NOPE' });
    expect(body.error.trace_id).toBeTruthy();
  });

  it('returns PRODUCT_NOT_FOUND for an inactive product', async () => {
    await harness.dataSource.query("UPDATE products SET is_active = FALSE WHERE sku = 'KEY-GTA5'");

    const { status, body } = await get<IErrorEnvelope>('/catalog/KEY-GTA5');

    expect(status).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(body.error.details).toEqual({ sku: 'KEY-GTA5' });
  });

  it('rejects a syntactically invalid sku', async () => {
    const { status, body } = await get<IErrorEnvelope>('/catalog/bad%20sku');

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
