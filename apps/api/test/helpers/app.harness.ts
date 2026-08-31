import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { TEST_HOST } from './harness.constants';
import type { IApiHarness } from './harness.interfaces';

function resolvePort(server: Server): number {
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Не удалось определить порт тестового HTTP-сервера');
  }

  return address.port;
}

export async function startApi(): Promise<IApiHarness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  await app.listen(0, TEST_HOST);

  const server: Server = app.getHttpServer();
  const port = resolvePort(server);
  const dataSource = app.get(DataSource);

  return {
    baseUrl: `http://${TEST_HOST}:${port}`,
    dataSource,
    stop: () => app.close(),
  };
}
