import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../common/config/app-config.service';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import {
  HTTP_STATUS_CLIENT_ERROR_MIN,
  SUPPLIER_CODE,
  SUPPLIER_CONTENT_TYPE,
  SUPPLIER_CONTROL_RESTOCK_PATH,
  SUPPLIER_ERROR_KIND,
  SUPPLIER_ISSUE_PATH,
  SUPPLIER_OUTCOME,
} from './suppliers.constants';
import type {
  ISupplierIssueInput,
  ISupplierIssueRequestBody,
  ISupplierIssueResult,
  ISupplierRestockRequestBody,
} from './suppliers.interfaces';
import type { IssueOutcomeShape, SupplierCode } from './suppliers.type';
import {
  classifySupplierHttpStatus,
  classifySupplierNetworkError,
  isSupplierSuccessBody,
} from './suppliers.util';

@Injectable()
export class SupplierClient {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SupplierClient');
  }

  async issue(input: ISupplierIssueInput): Promise<ISupplierIssueResult> {
    const url = `${this.baseUrlFor(input.supplierCode)}${SUPPLIER_ISSUE_PATH}`;
    const requestBody: ISupplierIssueRequestBody = {
      request_id: input.requestId,
      sku: input.sku,
      order_id: input.orderExtId,
    };

    this.logger.event(LOG_EVENT.SUPPLIER_REQUEST, {
      supplier_code: input.supplierCode,
      request_id: input.requestId,
      sku: input.sku,
    });

    const startedAt = performance.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': SUPPLIER_CONTENT_TYPE },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.supplier.requestTimeoutMs),
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const text = await response.text();
      const parsedBody = this.tryParseJson(text);
      const outcome = this.classifyResponse(response.status, parsedBody);

      this.logger.event(LOG_EVENT.SUPPLIER_RESPONSE, {
        supplier_code: input.supplierCode,
        request_id: input.requestId,
        http_status: response.status,
        outcome: outcome.kind,
        error_kind: outcome.errorKind,
        duration_ms: durationMs,
      });

      return { ...outcome, durationMs };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const classification = classifySupplierNetworkError(error);

      this.logger.event(LOG_EVENT.SUPPLIER_RESPONSE, {
        supplier_code: input.supplierCode,
        request_id: input.requestId,
        http_status: null,
        outcome: classification.kind,
        error_kind: classification.errorKind,
        duration_ms: durationMs,
      });

      return {
        kind: classification.kind,
        code: null,
        httpStatus: null,
        errorKind: classification.errorKind,
        errorReason: null,
        durationMs,
      };
    }
  }

  async restock(count: number): Promise<void> {
    await Promise.all(
      Object.values(SUPPLIER_CODE).map((code) => this.restockOne(code, count)),
    );
  }

  private async restockOne(code: SupplierCode, count: number): Promise<void> {
    const url = `${this.baseUrlFor(code)}${SUPPLIER_CONTROL_RESTOCK_PATH}`;
    const requestBody: ISupplierRestockRequestBody = { count };

    this.logger.event(LOG_EVENT.SUPPLIER_REQUEST, { supplier_code: code, path: SUPPLIER_CONTROL_RESTOCK_PATH });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': SUPPLIER_CONTENT_TYPE },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.supplier.requestTimeoutMs),
      });

      this.logger.event(LOG_EVENT.SUPPLIER_RESPONSE, {
        supplier_code: code,
        http_status: response.status,
        outcome: response.ok ? SUPPLIER_OUTCOME.ISSUED : SUPPLIER_OUTCOME.UNKNOWN,
      });
    } catch (error) {
      this.logger.event(LOG_EVENT.SUPPLIER_RESPONSE, {
        supplier_code: code,
        http_status: null,
        outcome: SUPPLIER_OUTCOME.UNKNOWN,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private classifyResponse(status: number, body: unknown): IssueOutcomeShape {
    if (status < HTTP_STATUS_CLIENT_ERROR_MIN) {
      if (isSupplierSuccessBody(body)) {
        return { kind: SUPPLIER_OUTCOME.ISSUED, code: body.code, httpStatus: status, errorKind: null, errorReason: null };
      }

      return {
        kind: SUPPLIER_OUTCOME.UNKNOWN,
        code: null,
        httpStatus: status,
        errorKind: SUPPLIER_ERROR_KIND.BAD_BODY,
        errorReason: null,
      };
    }

    const classification = classifySupplierHttpStatus(status, body);

    return {
      kind: classification.kind,
      code: null,
      httpStatus: status,
      errorKind: classification.errorKind,
      errorReason: classification.reason,
    };
  }

  private tryParseJson(text: string): unknown {
    if (text.length === 0) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private baseUrlFor(code: SupplierCode): string {
    return code === SUPPLIER_CODE.A ? this.config.supplier.aBaseUrl : this.config.supplier.bBaseUrl;
  }
}
