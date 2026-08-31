import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import type { ICorrelation } from './logging.interfaces';

@Injectable()
export class CorrelationStore {
  private readonly storage = new AsyncLocalStorage<ICorrelation>();

  run<T>(correlation: ICorrelation, fn: () => T): T {
    return this.storage.run(correlation, fn);
  }

  get(): ICorrelation | undefined {
    return this.storage.getStore();
  }

  traceId(): string | null {
    return this.storage.getStore()?.trace_id ?? null;
  }
}
