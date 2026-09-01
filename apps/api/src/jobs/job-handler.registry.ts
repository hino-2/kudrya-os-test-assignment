import { Inject, Injectable } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { JOB_HANDLERS } from './jobs.constants';
import type { IJobHandler } from './jobs.interfaces';
import type { JobKind } from './jobs.type';
import { buildDuplicateHandlerMessage } from './jobs.util';

@Injectable()
export class JobHandlerRegistry {
  private readonly handlers: Map<JobKind, IJobHandler>;

  constructor(@Inject(JOB_HANDLERS) handlers: readonly IJobHandler[]) {
    this.handlers = new Map();

    for (const handler of handlers) {
      if (this.handlers.has(handler.kind)) {
        throw new DomainError(ERROR_CODE.INTERNAL_ERROR, buildDuplicateHandlerMessage(handler.kind));
      }

      this.handlers.set(handler.kind, handler);
    }
  }

  resolve(kind: JobKind): IJobHandler | null {
    return this.handlers.get(kind) ?? null;
  }

  kinds(): readonly JobKind[] {
    return [...this.handlers.keys()];
  }
}
