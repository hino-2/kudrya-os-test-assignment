import { assertInt } from '../common/money/money.util';
import { ORDER_DEFAULT_QUANTITY } from './orders.constants';
import type { IOrderDraft, IProductSnapshotRow } from './orders.interfaces';
import type { CreateOrderRequestDto } from './dto/create-order.request.dto';

export function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function buildOrderDraft(
  product: IProductSnapshotRow,
  dto: CreateOrderRequestDto,
  extId: string,
): IOrderDraft {
  const quantity = dto.quantity ?? ORDER_DEFAULT_QUANTITY;
  const unitPriceMinor = assertInt(product.price_minor, 'price_minor');
  const totalMinor = assertInt(unitPriceMinor * quantity, 'total_minor');

  return {
    extId,
    productId: product.id,
    sku: product.sku,
    quantity,
    unitPriceMinor,
    totalMinor,
    currency: product.currency,
    buyerEmail: dto.buyer_email ?? null,
  };
}
