import type { Type } from '@nestjs/common';

export interface IStubHarness {
  baseUrl: string;
  get<T>(token: Type<T>): T;
  stop(): Promise<void>;
}
