export const REQUEST_ID_MAX_LENGTH = 128;

export const ISSUE_HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  OUT_OF_STOCK: 409,
  INTERNAL: 500,
} as const;

export const ISSUE_LOG_EVENT = {
  MINTED: 'stub.issue_minted',
  REPLAYED: 'stub.issue_replayed',
} as const;
