import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { CATALOG_ITEM_SQL, CATALOG_LIST_SQL } from './catalog.constants';
import type { ICatalogFilter, ICatalogPage, ICatalogRow } from './catalog.interfaces';

@Injectable()
export class CatalogRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findPage(filter: ICatalogFilter): Promise<ICatalogPage> {
    const rows = await this.dataSource.query<ICatalogRow[]>(CATALOG_LIST_SQL, [
      filter.type,
      filter.inStockOnly,
      filter.skuPrefix,
      filter.after?.sku ?? null,
      filter.after?.id ?? null,
      filter.limit + 1,
    ]);
    const hasMore = rows.length > filter.limit;

    return { rows: hasMore ? rows.slice(0, filter.limit) : rows, hasMore };
  }

  async findBySku(sku: string): Promise<ICatalogRow | null> {
    const rows = await this.dataSource.query<ICatalogRow[]>(CATALOG_ITEM_SQL, [sku]);

    return rows[0] ?? null;
  }
}
