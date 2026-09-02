import { Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { STUB_ERROR_CODE } from '../config/stub-config.constants';
import { IssueRequestDto } from './dto/issue-request.dto';
import { IssueService } from './issue.service';
import type { IInventoryView, IIssueLookupResult } from './issue.interfaces';

@Controller()
export class IssueController {
  constructor(private readonly issueService: IssueService) {}

  @Post('issue')
  async issue(@Body() dto: IssueRequestDto, @Res() res: Response): Promise<void> {
    const outcome = await this.issueService.issue(dto);

    switch (outcome.action) {
      case 'respond':
        res.status(outcome.status).json(outcome.body);
        return;
      case 'respond_garbage':
        res.status(outcome.status).type('text/html').send(outcome.body);
        return;
      case 'hang':
        // Record already minted and persisted before this point; connection never responds.
        return;
      case 'refuse':
        res.socket?.destroy();
        return;
      default:
        return;
    }
  }

  @Get('issue/:requestId')
  lookup(@Param('requestId') requestId: string): IIssueLookupResult {
    const record = this.issueService.lookup(requestId);

    if (!record) {
      throw new NotFoundException({ status: 'error', reason: STUB_ERROR_CODE.NOT_FOUND });
    }

    return { status: 'ok', request_id: record.requestId, code: record.code };
  }

  @Get('inventory')
  inventory(): IInventoryView {
    return this.issueService.inventory();
  }
}
