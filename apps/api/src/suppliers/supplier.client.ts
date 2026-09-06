import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../common/config/app-config.service';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import {
  HTTP_STATUS_CLIENT_ERROR_MIN,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_SERVER_ERROR_MIN,
  SUPPLIER_CODE,
  SUPPLIER_CONTENT_TYPE,
  SUPPLIER_CONTROL_RESTOCK_PATH,
  SUPPLIER_ERROR_KIND,
  SUPPLIER_ISSUE_PATH,
  SUPPLIER_LOOKUP_PATH_TEMPLATE,
  SUPPLIER_OUTCOME,
  SUPPLIER_REQUEST_ID_MISMATCH_REASON,
} from './suppliers.constants';
import type {
  ISupplierIssueInput,
  ISupplierIssueRequestBody,
  ISupplierIssueResult,
  ISupplierRestockOutcome,
  ISupplierRestockRequestBody,
} from './suppliers.interfaces';
import type { IssueOutcomeShape, SupplierCode } from './suppliers.type';
import {
  classifySupplierHttpStatus,
  classifySupplierNetworkError,
  extractSupplierReason,
  formatTemplate,
  isSupplierSuccessBody,
  matchesRequestId,
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
      return this.networkFailure(input.supplierCode, input.requestId, error, startedAt);
    }
  }

  // resolve-шаг (см. spec 05 §5.6): авторитетное чтение статуса заявки, когда бюджет слепых
  // POST-реплеев с тем же request_id исчерпан. Вызывается ровно из одного места —
  // SupplierFulfilmentService при решении «сдаться или нет» по неоднозначной попытке
  async lookup(supplierCode: SupplierCode, requestId: string): Promise<ISupplierIssueResult> {
    const path = formatTemplate(SUPPLIER_LOOKUP_PATH_TEMPLATE, encodeURIComponent(requestId));
    const url = `${this.baseUrlFor(supplierCode)}${path}`;

    this.logger.event(LOG_EVENT.SUPPLIER_REQUEST, {
      supplier_code: supplierCode,
      request_id: requestId,
      path,
    });

    const startedAt = performance.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.supplier.requestTimeoutMs),
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const text = await response.text();
      const parsedBody = this.tryParseJson(text);
      const outcome = this.classifyLookupResponse(response.status, parsedBody, requestId);

      this.logger.event(LOG_EVENT.SUPPLIER_RESPONSE, {
        supplier_code: supplierCode,
        request_id: requestId,
        http_status: response.status,
        outcome: outcome.kind,
        error_kind: outcome.errorKind,
        duration_ms: durationMs,
      });

      return { ...outcome, durationMs };
    } catch (error) {
      return this.networkFailure(supplierCode, requestId, error, startedAt);
    }
  }

  // исход по каждому поставщику возвращается наружу: счётчик sku_stock уже увеличен, и если
  // ни один поставщик не принял пополнение, админ обязан это увидеть, а не получить голое 200
  async restock(count: number): Promise<ISupplierRestockOutcome[]> {
    return Promise.all(Object.values(SUPPLIER_CODE).map((code) => this.restockOne(code, count)));
  }

  private async restockOne(code: SupplierCode, count: number): Promise<ISupplierRestockOutcome> {
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

      // supplier.response замаплен на debug, поэтому при LOG_LEVEL=info провал пополнения
      // был бы не виден вообще — отдельное событие уровня error
      if (!response.ok) {
        this.logger.event(LOG_EVENT.SUPPLIER_RESTOCK_FAILED, {
          supplier_code: code,
          http_status: response.status,
          count,
        });
      }

      return {
        supplierCode: code,
        ok: response.ok,
        httpStatus: response.status,
        errorReason: null,
      };
    } catch (error) {
      const errorReason = error instanceof Error ? error.message : String(error);

      this.logger.event(LOG_EVENT.SUPPLIER_RESTOCK_FAILED, {
        supplier_code: code,
        http_status: null,
        count,
        error: errorReason,
      });

      return { supplierCode: code, ok: false, httpStatus: null, errorReason };
    }
  }

  private networkFailure(
    supplierCode: SupplierCode,
    requestId: string,
    error: unknown,
    startedAt: number,
  ): ISupplierIssueResult {
    const durationMs = Math.round(performance.now() - startedAt);
    const classification = classifySupplierNetworkError(error);

    this.logger.event(LOG_EVENT.SUPPLIER_RESPONSE, {
      supplier_code: supplierCode,
      request_id: requestId,
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

  // единственный определённый исход чтения — 404: поставщик отрицает сам request_id. Любой
  // другой 4xx/5xx означает, что чтение не удалось, а неудавшееся чтение ничего не говорит
  // о выдаче — карве-аута для тела {"status":"error"}, как в classifySupplierHttpStatus, здесь нет
  private classifyLookupResponse(status: number, body: unknown, requestId: string): IssueOutcomeShape {
    if (status < HTTP_STATUS_CLIENT_ERROR_MIN) {
      if (isSupplierSuccessBody(body) && matchesRequestId(body, requestId)) {
        return { kind: SUPPLIER_OUTCOME.ISSUED, code: body.code, httpStatus: status, errorKind: null, errorReason: null };
      }

      return {
        kind: SUPPLIER_OUTCOME.UNKNOWN,
        code: null,
        httpStatus: status,
        errorKind: SUPPLIER_ERROR_KIND.BAD_BODY,
        errorReason: SUPPLIER_REQUEST_ID_MISMATCH_REASON,
      };
    }

    if (status === HTTP_STATUS_NOT_FOUND) {
      return {
        kind: SUPPLIER_OUTCOME.REJECTED,
        code: null,
        httpStatus: status,
        errorKind: SUPPLIER_ERROR_KIND.NOT_ISSUED,
        errorReason: extractSupplierReason(body),
      };
    }

    return {
      kind: SUPPLIER_OUTCOME.UNKNOWN,
      code: null,
      httpStatus: status,
      errorKind:
        status >= HTTP_STATUS_SERVER_ERROR_MIN ? SUPPLIER_ERROR_KIND.HTTP_5XX : SUPPLIER_ERROR_KIND.BAD_BODY,
      errorReason: extractSupplierReason(body),
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
