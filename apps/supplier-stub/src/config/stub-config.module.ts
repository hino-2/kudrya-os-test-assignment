import { Global, Module } from '@nestjs/common';

import { StubConfigService } from './stub-config.service';

@Global()
@Module({
  providers: [StubConfigService],
  exports: [StubConfigService],
})
export class StubConfigModule {}
