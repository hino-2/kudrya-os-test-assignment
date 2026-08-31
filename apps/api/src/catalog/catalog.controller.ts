import { Controller, Get, Param, Query } from '@nestjs/common';

import { CATALOG_ROUTE, CATALOG_SKU_ROUTE } from './catalog.constants';
import { CatalogService } from './catalog.service';
import type { CatalogItemResponseDto } from './dto/catalog-item.response.dto';
import type { CatalogPageResponseDto } from './dto/catalog-page.response.dto';
import { CatalogSkuParamDto } from './dto/catalog-sku.param.dto';
import { ListCatalogQueryDto } from './dto/list-catalog.query.dto';

@Controller(CATALOG_ROUTE)
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  list(@Query() query: ListCatalogQueryDto): Promise<CatalogPageResponseDto> {
    return this.service.list(query);
  }

  @Get(CATALOG_SKU_ROUTE)
  getOne(@Param() params: CatalogSkuParamDto): Promise<CatalogItemResponseDto> {
    return this.service.getBySku(params.sku);
  }
}
