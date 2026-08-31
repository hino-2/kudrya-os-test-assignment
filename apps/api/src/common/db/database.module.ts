import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { AppConfigService } from '../config/app-config.service';
import { DB_CONNECT_RETRY_ATTEMPTS, DB_CONNECT_RETRY_DELAY_MS } from './db.constants';
import { buildDataSourceOptions } from './data-source.options';
import { registerPgTypeParsers } from './pg-types.util';
import { UnitOfWorkService } from './unit-of-work.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): TypeOrmModuleOptions => {
        registerPgTypeParsers();

        return {
          ...buildDataSourceOptions(config.db),
          autoLoadEntities: true,
          retryAttempts: DB_CONNECT_RETRY_ATTEMPTS,
          retryDelay: DB_CONNECT_RETRY_DELAY_MS,
        };
      },
    }),
  ],
  providers: [UnitOfWorkService],
  exports: [TypeOrmModule, UnitOfWorkService],
})
export class DatabaseModule {}
