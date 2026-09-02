export const SCENARIO_MODE = {
  NORMAL: 'normal',
  OK: 'ok',
  SLOW: 'slow',
  TIMEOUT: 'timeout',
  ISSUE_THEN_HANG: 'issue_then_hang',
  ERROR_5XX: 'error_5xx',
  ERROR_5XX_GARBAGE: 'error_5xx_garbage',
  OUT_OF_STOCK: 'out_of_stock',
  BAD_REQUEST: 'bad_request',
  REFUSE: 'refuse',
} as const;

export const DEFAULT_SCENARIO_MODE = SCENARIO_MODE.NORMAL;
