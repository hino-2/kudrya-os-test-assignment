import type { MixedList } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

export interface IPgError {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

export interface IUnitOfWorkOptions {
  retryAttempts?: number;
  isolationLevel?: IsolationLevel;
}

export interface IDataSourceSeams {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- зеркалит сигнатуру MixedList<Function> из typeorm
  entities?: MixedList<Function>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- зеркалит сигнатуру MixedList<Function> из typeorm
  migrations?: MixedList<Function>;
}
