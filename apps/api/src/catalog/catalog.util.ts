import type { ICatalogConfig } from '../common/config/config.interfaces';
import {
  BOOLEAN_TRUE_PARAMS,
  CATALOG_IN_STOCK_DEFAULT,
  LIKE_ESCAPE_PATTERN,
  LIKE_ESCAPE_REPLACEMENT,
} from './catalog.constants';
import type { ICatalogFilter } from './catalog.interfaces';
import type { ListCatalogQueryDto } from './dto/list-catalog.query.dto';

export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }

  return (BOOLEAN_TRUE_PARAMS as readonly string[]).includes(raw);
}

export function escapeLikePrefix(value: string): string {
  return value.replace(LIKE_ESCAPE_PATTERN, LIKE_ESCAPE_REPLACEMENT);
}

export function resolveListFilter(query: ListCatalogQueryDto, config: ICatalogConfig): ICatalogFilter {
  return {
    type: query.type ?? null,
    inStockOnly: parseBooleanFlag(query.in_stock, CATALOG_IN_STOCK_DEFAULT),
    skuPrefix: query.q === undefined ? null : escapeLikePrefix(query.q),
    after: null,
    limit: Math.min(query.limit ?? config.defaultLimit, config.maxLimit),
  };
}
