import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { AppModule } from './app.module';
import { StubConfigService } from './config/stub-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const config = app.get(StubConfigService);

  await app.listen(config.get().port);
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
