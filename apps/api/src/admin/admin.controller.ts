import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import {
  ADMIN_REDELIVER_ROUTE,
  ADMIN_REDELIVER_STATUS,
  ADMIN_RESTOCK_ROUTE,
  ADMIN_RESTOCK_STATUS,
  ADMIN_ROUTE,
  ADMIN_SWEEPER_RUN_ROUTE,
  ADMIN_SWEEPER_RUN_STATUS,
} from './admin.constants';
import { AdminTokenGuard } from './admin-token.guard';
import { AdminService } from './admin.service';
import { AdminOrderIdParamDto } from './dto/admin-order-id.param.dto';
import { RedeliverRequestDto } from './dto/redeliver.request.dto';
import type { RedeliverResponseDto } from './dto/redeliver.response.dto';
import { RestockRequestDto } from './dto/restock.request.dto';
import type { RestockResponseDto } from './dto/restock.response.dto';
import { RestockSkuParamDto } from './dto/restock-sku.param.dto';
import type { SweeperRunResponseDto } from './dto/sweeper-run.response.dto';

@Controller(ADMIN_ROUTE)
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Post(ADMIN_SWEEPER_RUN_ROUTE)
  @HttpCode(ADMIN_SWEEPER_RUN_STATUS)
  async runSweeper(): Promise<SweeperRunResponseDto> {
    const result = await this.service.runSweeperCycle();

    return {
      reclaimed_stale_jobs: result.reclaimedStaleJobs,
      requeued_stuck_orders: result.requeuedStuckOrders,
      retried_out_of_stock: result.retriedOutOfStock,
      retried_delivery_failed: result.retriedDeliveryFailed,
      demoted_stale_inflight: result.demotedStaleInflight,
      redriven_unknown_attempts: result.redrivenUnknownAttempts,
      replayed_orphans: result.replayedOrphans,
      abandoned_orphans: result.abandonedOrphans,
    };
  }

  @Post(ADMIN_RESTOCK_ROUTE)
  @HttpCode(ADMIN_RESTOCK_STATUS)
  async restock(
    @Param() params: RestockSkuParamDto,
    @Body() dto: RestockRequestDto,
  ): Promise<RestockResponseDto> {
    const result = await this.service.restock({ sku: params.sku, codes: dto.codes, count: dto.count });

    return { added: result.added, available_count: result.availableCount };
  }

  @Post(ADMIN_REDELIVER_ROUTE)
  @HttpCode(ADMIN_REDELIVER_STATUS)
  async redeliver(
    @Param() params: AdminOrderIdParamDto,
    @Body() dto: RedeliverRequestDto,
  ): Promise<RedeliverResponseDto> {
    const result = await this.service.redeliver({ orderId: params.orderId, reason: dto.reason });

    return { enqueued: result.enqueued, generation: result.generation };
  }
}
