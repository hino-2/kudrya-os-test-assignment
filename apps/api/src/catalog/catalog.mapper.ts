import { toMajor } from '../common/money/money.util';
import type { ICatalogPage, ICatalogRow } from './catalog.interfaces';
import type { CatalogItemResponseDto } from './dto/catalog-item.response.dto';
import type { CatalogPageResponseDto } from './dto/catalog-page.response.dto';

export function toCatalogItem(row: ICatalogRow): CatalogItemResponseDto {
  return {
    sku: row.sku,
    name: row.name,
    type: row.type,
    amount_minor: row.price_minor,
    amount: toMajor(row.price_minor),
    currency: row.currency,
    image: row.image_url,
    available_count: row.available_count,
    in_stock: row.available_count > 0,
  };
}

export function toCatalogPage(page: ICatalogPage, limit: number): CatalogPageResponseDto {
  return {
    items: page.rows.map((row) => toCatalogItem(row)),
    next_cursor: null,
    has_more: page.hasMore,
    limit,
  };
}
