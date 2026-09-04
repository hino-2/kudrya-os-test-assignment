export interface ISweeperCycleResult {
  reclaimedStaleJobs: number;
  requeuedStuckOrders: number;
  retriedOutOfStock: number;
  retriedDeliveryFailed: number;
  demotedStaleInflight: number;
  redrivenUnknownAttempts: number;
  replayedOrphans: number;
  abandonedOrphans: number;
}
