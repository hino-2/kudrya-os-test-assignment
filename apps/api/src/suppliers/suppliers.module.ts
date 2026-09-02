import { Module } from '@nestjs/common';

import { SupplierClient } from './supplier.client';

@Module({
  providers: [SupplierClient],
  exports: [SupplierClient],
})
export class SuppliersModule {}
