import type { CatalogItemResponseDto } from './catalog-item.response.dto';

export class CatalogPageResponseDto {
  items!: CatalogItemResponseDto[];
  limit!: number;
}
