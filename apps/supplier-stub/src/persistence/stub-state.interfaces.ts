export interface IIssueRecord {
  requestId: string;
  sku: string;
  orderId: string;
  code: string;
  issuedAt: string;
}

export interface IStubState {
  version: number;
  issued: IIssueRecord[];
  consumed: number;
  inventorySize: number;
}
