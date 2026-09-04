import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module';
import { JobsModule } from '../jobs/jobs.module';
import { OrdersModule } from '../orders/orders.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminTokenGuard } from './admin-token.guard';

@Module({
  imports: [InventoryModule, OrdersModule, JobsModule, SuppliersModule, ReconciliationModule],
  controllers: [AdminController],
  providers: [AdminService, AdminTokenGuard],
})
export class AdminModule {}
