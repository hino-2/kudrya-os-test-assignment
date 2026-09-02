import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import type { IBackoffOptions, IJobRetryHint } from '../jobs/jobs.interfaces';

// сигнал воркеру: доставку через поставщика нужно повторить целиком на следующем прогоне джобы
// (например, попытка ушла в unknown и ждёт дозвона) — readJobBackoffHint подхватывает
// retryBackoff автоматически, без дополнительной привязки к job-worker'у
export class DeliveryRetryRequiredError extends DomainError implements IJobRetryHint {
  readonly retryBackoff: IBackoffOptions;

  constructor(message: string, retryBackoff: IBackoffOptions) {
    super(ERROR_CODE.INTERNAL_ERROR, message);
    this.retryBackoff = retryBackoff;
  }
}
