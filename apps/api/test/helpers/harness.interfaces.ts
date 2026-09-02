import type { Type } from '@nestjs/common';
import type { DataSource } from 'typeorm';

export interface IDbHarness {
  dataSource: DataSource;
  stop(): Promise<void>;
}

export interface IApiHarness extends IDbHarness {
  baseUrl: string;
  get<T>(token: Type<T>): T;
}

export interface IStubHarness {
  baseUrl: string;
  stop(): Promise<void>;
}

export interface ISeedProduct {
  sku: string;
  name: string;
  type: string;
  price: number;
  currency: string;
  image: string | null;
}

export interface ISeedKeySlice {
  sku: string;
  count: number;
}

export interface ISeedCliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
