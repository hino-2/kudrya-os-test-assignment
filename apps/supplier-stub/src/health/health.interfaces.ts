import type { SupplierId } from '../config/stub-config.type';

export interface IHealthResponse {
  status: 'ok';
  supplierId: SupplierId;
  remaining: number;
}
