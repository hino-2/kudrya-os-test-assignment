export interface IRacePayload {
  event_id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
}

export interface IRaceHttpResult<T> {
  status: number;
  body: T;
}

export interface IRaceSummary {
  total: number;
  applied: number;
  ignoredAlreadyPaid: number;
  ignoredStale: number;
  other: number;
}
