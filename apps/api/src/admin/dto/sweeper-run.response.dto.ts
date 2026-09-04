export class SweeperRunResponseDto {
  reclaimed_stale_jobs!: number;
  requeued_stuck_orders!: number;
  retried_out_of_stock!: number;
  retried_delivery_failed!: number;
  demoted_stale_inflight!: number;
  redriven_unknown_attempts!: number;
  replayed_orphans!: number;
  abandoned_orphans!: number;
}
