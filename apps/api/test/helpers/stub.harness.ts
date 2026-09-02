import 'reflect-metadata';

import type { Server } from 'node:http';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

// глубокий подпуть импорта: apps/supplier-stub/package.json не задаёт main/exports —
// пакет резолвится только по подпути через npm workspaces симлинк @store/supplier-stub
import { AppModule } from '@store/supplier-stub/src/app.module';
import { TEST_HOST } from './harness.constants';
import type { IStubHarness } from './harness.interfaces';

function resolvePort(server: Server): number {
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Не удалось определить порт тестового HTTP-сервера supplier-stub');
  }

  return address.port;
}

// StubConfigService/StubStateStore читают process.env заново в конструкторе при каждом
// compile() — в отличие от AppModule апи, здесь нет кэша NestConfigModule.forRoot(), поэтому
// envOverrides применяются независимо для каждого вызова startStub() в одном процессе
// port=0 отдаёт ОС свободный эфемерный порт (обычный случай); воркерные сьюты передают
// фиксированный порт, т.к. их SUPPLIER_A_BASE_URL/SUPPLIER_B_BASE_URL уже зафиксированы
// в env.setup.worker-enabled.ts до импорта AppModule (см. комментарий в harness.constants.ts)
export async function startStub(envOverrides: Record<string, string>, port = 0): Promise<IStubHarness> {
  Object.assign(process.env, envOverrides);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  // main.ts подключает ValidationPipe вручную (не через APP_PIPE в AppModule) — харнес
  // повторяет это здесь, иначе DTO-валидация _control/* и /issue в тестах не сработает
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(port, TEST_HOST);

  const server: Server = app.getHttpServer();
  const boundPort = resolvePort(server);

  return {
    baseUrl: `http://${TEST_HOST}:${boundPort}`,
    stop: () => app.close(),
  };
}
