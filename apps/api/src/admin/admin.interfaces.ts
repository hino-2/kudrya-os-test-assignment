export interface IRestockInput {
  sku: string;
  codes?: string[];
  count?: number;
}

export interface IRestockResult {
  added: number;
  availableCount: number;
}

export interface IRedeliverInput {
  orderId: string;
  reason?: string;
}

export interface IRedeliverResult {
  enqueued: boolean;
  generation: number;
}
