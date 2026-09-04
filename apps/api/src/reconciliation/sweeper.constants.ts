export const SWEEPER_INTERVAL_NAME = 'sweeper-tick';

export const SWEEPER_TICK_INTERVAL_MS = 200;

export const SWEEPER_SHUTDOWN_DRAIN_TIMEOUT_MS = 10000;

// error_reason записанный в demoteStaleInFlight (pass 5a) — попытка провисела в in_flight
// дольше attemptInflightTimeoutMs, воркер, скорее всего, умер после TX-S1 коммита
export const SWEEPER_INFLIGHT_DEMOTED_REASON =
  'sweeper: in_flight attempt exceeded ATTEMPT_INFLIGHT_TIMEOUT_MS, demoted to unknown';
