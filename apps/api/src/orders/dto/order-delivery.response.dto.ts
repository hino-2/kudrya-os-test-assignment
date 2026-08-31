export class OrderDeliveryResponseDto {
  code!: string;
  source!: string;
  supplier!: string | null;
  delivered_at!: string;
}
