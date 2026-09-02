import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { DELIVERY_FULFILMENT_SERVICES } from './delivery.constants';
import { DeliverOrderHandler } from './deliver-order.handler';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import type { IFulfilmentService } from './delivery.interfaces';
import { PoolFulfilmentService } from './pool-fulfilment.service';

@Module({
  imports: [InventoryModule, OrdersModule, LedgerModule],
  providers: [
    DeliveryRepository,
    PoolFulfilmentService,
    {
      provide: DELIVERY_FULFILMENT_SERVICES,
      useFactory: (pool: PoolFulfilmentService): readonly IFulfilmentService[] => [pool],
      inject: [PoolFulfilmentService],
    },
    DeliveryService,
    DeliverOrderHandler,
  ],
  exports: [DeliveryService, DeliverOrderHandler],
})
export class DeliveryModule {}
