import type { QueryRunner } from 'typeorm';

import type { PG_ERROR_CODE } from './db.constants';

export type TransactionWork<T> = (queryRunner: QueryRunner) => Promise<T>;

export type PgErrorCode = (typeof PG_ERROR_CODE)[keyof typeof PG_ERROR_CODE];
