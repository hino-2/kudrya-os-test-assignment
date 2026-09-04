import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { DELIVERY_FULFILMENT_SERVICES } from './delivery.constants';
import { DeliverOrderHandler } from './deliver-order.handler';
import { DeliveryAttemptRepository } from './delivery-attempt.repository';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import type { IFulfilmentService } from './delivery.interfaces';
import { PoolFulfilmentService } from './pool-fulfilment.service';
import { SupplierFulfilmentService } from './supplier-fulfilment.service';

@Module({
  imports: [InventoryModule, OrdersModule, LedgerModule, SuppliersModule],
  providers: [
    DeliveryRepository,
    DeliveryAttemptRepository,
    PoolFulfilmentService,
    SupplierFulfilmentService,
    {
      provide: DELIVERY_FULFILMENT_SERVICES,
      useFactory: (pool: PoolFulfilmentService, supplier: SupplierFulfilmentService): readonly IFulfilmentService[] => [
        pool,
        supplier,
      ],
      inject: [PoolFulfilmentService, SupplierFulfilmentService],
    },
    DeliveryService,
    DeliverOrderHandler,
  ],
  exports: [DeliveryService, DeliverOrderHandler, DeliveryAttemptRepository],
})
export class DeliveryModule {}
