export class OrderDeliveryAttemptResponseDto {
  supplier!: string;
  attempt_no!: number;
  request_id!: string;
  state!: string;
  error_kind!: string | null;
  duration_ms!: number | null;
}
