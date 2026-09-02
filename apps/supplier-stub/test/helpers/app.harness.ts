import 'reflect-metadata';

import type { Server } from 'node:http';

import { ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { applyEnvOverrides } from '../../src/config/env-access.config';
import { TEST_HOST } from './harness.constants';
import type { IStubHarness } from './harness.interfaces';

function resolvePort(server: Server): number {
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Не удалось определить порт тестового HTTP-сервера');
  }

  return address.port;
}

export async function startStub(envOverrides?: Record<string, string>): Promise<IStubHarness> {
  if (envOverrides !== undefined) {
    applyEnvOverrides(envOverrides);
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(0, TEST_HOST);

  const server: Server = app.getHttpServer();
  const port = resolvePort(server);

  return {
    baseUrl: `http://${TEST_HOST}:${port}`,
    get: <T>(token: Type<T>): T => app.get(token),
    stop: () => app.close(),
  };
}
