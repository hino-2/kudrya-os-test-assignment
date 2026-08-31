import { describe, expect, it } from 'vitest';

import { toCatalogItem, toCatalogPage } from '../../src/catalog/catalog.mapper';
import type { ICatalogRow } from '../../src/catalog/catalog.interfaces';

function row(overrides: Partial<ICatalogRow> = {}): ICatalogRow {
  return {
    id: 5,
    sku: 'KEY-GTA5',
    name: 'GTA V ключ активации',
    type: 'key',
    price_minor: 199000,
    currency: 'RUB',
    image_url: 'assets/gta5.png',
    available_count: 20,
    ...overrides,
  };
}

describe('catalog.mapper', () => {
  describe('toCatalogItem', () => {
    it('exposes both the authoritative minor amount and the display amount', () => {
      const item = toCatalogItem(row());

      expect(item.amount_minor).toBe(199000);
      expect(item.amount).toBe(1990);
      expect(item.currency).toBe('RUB');
    });

    it('renames image_url to image and keeps null', () => {
      expect(toCatalogItem(row()).image).toBe('assets/gta5.png');
      expect(toCatalogItem(row({ image_url: null })).image).toBeNull();
    });

    it('derives in_stock from the counter', () => {
      expect(toCatalogItem(row({ available_count: 1 })).in_stock).toBe(true);
      expect(toCatalogItem(row({ available_count: 0 })).in_stock).toBe(false);
    });

    it('does not leak the internal row id', () => {
      expect(Object.keys(toCatalogItem(row()))).not.toContain('id');
    });
  });

  describe('toCatalogPage', () => {
    it('maps every row and echoes the effective limit', () => {
      const page = toCatalogPage({ rows: [row(), row({ sku: 'KEY-EFT' })], hasMore: true }, 5);

      expect(page.items).toHaveLength(2);
      expect(page.items[1].sku).toBe('KEY-EFT');
      expect(page.has_more).toBe(true);
      expect(page.limit).toBe(5);
    });

    it('reports no cursor until keyset pagination exists', () => {
      expect(toCatalogPage({ rows: [], hasMore: false }, 24).next_cursor).toBeNull();
    });
  });
});
