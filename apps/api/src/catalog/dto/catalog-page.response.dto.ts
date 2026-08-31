import type { CatalogItemResponseDto } from './catalog-item.response.dto';

export class CatalogPageResponseDto {
  items!: CatalogItemResponseDto[];
  next_cursor!: string | null;
  has_more!: boolean;
  limit!: number;
}
