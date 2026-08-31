import { describe, expect, it } from 'vitest';

import { CATALOG_IN_STOCK_DEFAULT } from '../../src/catalog/catalog.constants';
import { escapeLikePrefix, parseBooleanFlag, resolveListFilter } from '../../src/catalog/catalog.util';
import type { ICatalogConfig } from '../../src/common/config/config.interfaces';

const config: ICatalogConfig = { defaultLimit: 24, maxLimit: 100 };

describe('catalog.util', () => {
  describe('parseBooleanFlag', () => {
    it('falls back when the flag is absent', () => {
      expect(parseBooleanFlag(undefined, true)).toBe(true);
      expect(parseBooleanFlag(undefined, false)).toBe(false);
    });

    it('maps the accepted truthy strings to true', () => {
      expect(parseBooleanFlag('true', false)).toBe(true);
      expect(parseBooleanFlag('1', false)).toBe(true);
    });

    it('maps anything else to false', () => {
      expect(parseBooleanFlag('false', true)).toBe(false);
      expect(parseBooleanFlag('0', true)).toBe(false);
    });
  });

  describe('escapeLikePrefix', () => {
    it('escapes the LIKE wildcards', () => {
      expect(escapeLikePrefix('A_B')).toBe('A\\_B');
      expect(escapeLikePrefix('A%B')).toBe('A\\%B');
      expect(escapeLikePrefix('A\\B')).toBe('A\\\\B');
    });

    it('leaves a plain prefix untouched', () => {
      expect(escapeLikePrefix('STEAM')).toBe('STEAM');
    });
  });

  describe('resolveListFilter', () => {
    it('applies the configured default limit', () => {
      expect(resolveListFilter({}, config).limit).toBe(24);
    });

    it('keeps a requested limit below the configured cap', () => {
      expect(resolveListFilter({ limit: 5 }, config).limit).toBe(5);
    });

    it('clamps a requested limit to the configured cap', () => {
      expect(resolveListFilter({ limit: 100 }, { defaultLimit: 24, maxLimit: 10 }).limit).toBe(10);
    });

    it('clamps the default limit to the configured cap', () => {
      expect(resolveListFilter({}, { defaultLimit: 24, maxLimit: 10 }).limit).toBe(10);
    });

    it('defaults in_stock to the storefront default', () => {
      expect(resolveListFilter({}, config).inStockOnly).toBe(CATALOG_IN_STOCK_DEFAULT);
    });

    it('honours an explicit in_stock=false', () => {
      expect(resolveListFilter({ in_stock: 'false' }, config).inStockOnly).toBe(false);
    });

    it('passes the type filter through and defaults it to null', () => {
      expect(resolveListFilter({ type: 'key' }, config).type).toBe('key');
      expect(resolveListFilter({}, config).type).toBeNull();
    });

    it('escapes the sku prefix and defaults it to null', () => {
      expect(resolveListFilter({ q: 'KEY_' }, config).skuPrefix).toBe('KEY\\_');
      expect(resolveListFilter({}, config).skuPrefix).toBeNull();
    });

    it('never produces a cursor position before keyset pagination exists', () => {
      expect(resolveListFilter({ limit: 5, q: 'KEY' }, config).after).toBeNull();
    });
  });
});
