import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import {
  ORDERS_ROUTE,
  ORDER_CREATED_STATUS,
  ORDER_ID_ROUTE,
  ORDER_REPLAY_STATUS,
} from './orders.constants';
import { OrdersService } from './orders.service';
import { CreateOrderRequestDto } from './dto/create-order.request.dto';
import type { CreateOrderResponseDto } from './dto/create-order.response.dto';
import { OrderIdParamDto } from './dto/order-id.param.dto';
import type { OrderResponseDto } from './dto/order.response.dto';

@Controller(ORDERS_ROUTE)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post()
  async create(
    @Body() dto: CreateOrderRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateOrderResponseDto> {
    const outcome = await this.service.create(dto);

    res.status(outcome.created ? ORDER_CREATED_STATUS : ORDER_REPLAY_STATUS);

    return outcome.order;
  }

  @Get(ORDER_ID_ROUTE)
  getOne(@Param() params: OrderIdParamDto): Promise<OrderResponseDto> {
    return this.service.getByExtId(params.orderId);
  }
}
