import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../common/config/app-config.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { toCatalogItem, toCatalogPage } from './catalog.mapper';
import { CatalogRepository } from './catalog.repository';
import { resolveListFilter } from './catalog.util';
import type { CatalogItemResponseDto } from './dto/catalog-item.response.dto';
import type { CatalogPageResponseDto } from './dto/catalog-page.response.dto';
import type { ListCatalogQueryDto } from './dto/list-catalog.query.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly config: AppConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('CatalogService');
  }

  async list(query: ListCatalogQueryDto): Promise<CatalogPageResponseDto> {
    const filter = resolveListFilter(query, this.config.catalog);
    const page = await this.repository.findPage(filter);

    this.logger.event(LOG_EVENT.CATALOG_QUERY, {
      type: filter.type,
      in_stock: filter.inStockOnly,
      limit: filter.limit,
      q: query.q ?? null,
    });

    return toCatalogPage(page, filter.limit);
  }

  async getBySku(sku: string): Promise<CatalogItemResponseDto> {
    const row = await this.repository.findBySku(sku);

    if (row === null) {
      throw new DomainError(ERROR_CODE.PRODUCT_NOT_FOUND, undefined, { sku });
    }

    this.logger.event(LOG_EVENT.CATALOG_QUERY, { sku });

    return toCatalogItem(row);
  }
}
